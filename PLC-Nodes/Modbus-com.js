
"use strict";
const path = require("path");
const fs = require("fs");
const serialp = require("serialport");
const ModbusRTU = require('modbus-serial');
const PLCCom = require('./util/PLC-Com');
const COMMUNICATION_TIMEOUT = 2000;

class ModbusCom extends PLCCom {
    constructor(config, MBObject){
        super(config, MBObject);
    }
    // PLCCom のreadItemFromPLC()をModbus仕様にオーバーライド
    async readItemsFromPLC(config, params) {

        let mbObj = this.comObj;
        let values = [];
        let resp;

        if (!mbObj.isOpen) {
            if (config.comType == "TCP") {
                await mbObj.connectTCP(config.IPAdd, {port: Number(config.TCPport)})
                .then(mbObj.setID(Number(config.unitID)));
            }
            else {
                let stopB;
                (config.parity === "none") ? stopB = 2: stopB = 1;
                let portConfig = {
                    baudRate: Number(config.baud),
                    dataBits: 8,
                    parity: config.parity,
                    stopBits: stopB
                };
                if (config.comType == "RTU") {
                    await mbObj.connectRTUBuffered(config.serialPort, portConfig);
                }
                if (config.comType == "ASCII") {
                    portConfig.dataBits = 7;
                    await mbObj.connectAsciiSerial(config.serialPort, portConfig);
                }
            }
        }
        for (let param of params){
            switch(param.dev){
                case "Coil": // FC:1
                    resp = await mbObj.readCoils(param.addr, param.qty);
                    break;
                case "IS": // FC:2
                    resp = await mbObj.readDiscreteInputs(param.addr, param.qty);
                    break;
                case "HR": // FC:3
                    resp = await mbObj.readHoldingRegisters(param.addr, param.qty);
                    break;
                case "IR": // FC:4
                    resp = await mbObj.readInputRegisters(param.addr, param.qty);
                    break;
                default:
                    break;
            }
            values.push({dev: param.dev, addr: param.addr, qty: param.qty, value: resp.data});
        }
//        await mbObj.close();
        return values;
    }

    // LinkObject形式へのデータ変換。Modbus仕様にオーバーライドする。
    toLinkObjectValue(value) {
        let type = typeof value;
        if (type == "boolean")
            return (value ? "1" : "0");
        else if (type == "number")
            return '0x' + (('0000' + value.toString(16).toUpperCase()).substr(-4));
    }

    // 通信リンクオブジェクトを登録するメソッド
    // Modbusの特有デバイス名でフィルタリングし、Baseクラスのメソッドコール
    addLinkData(lObj) {   
        //デバイス名が不正でないかチェック（error,Coil,IS,HR,IR）
        for(let dev of Object.keys(lObj)) {
            if (!(dev == "error") && !(dev == "Coil") && !(dev == "IS") && !(dev == "HR") && !(dev == "IR"))
                delete lObj[dev];
        }
        if (Object.keys(lObj).length)  super.addLinkData(lObj);
    }
    // 通信エラーのハンドラーメソッド
    comError(err) {
        this.linkObj.error = "Modbus com error!";
    }
}

module.exports = function(RED) {

    function modbusCom(config) {
        RED.nodes.createNode(this, config);

        const node = this;
        const mbObj = new ModbusRTU();
        mbObj._timeout = COMMUNICATION_TIMEOUT;
        const mbcom = new ModbusCom(config, mbObj);

        let cycleId, cycleFlag = true;

        // 設定周期でのサイクリック通信を実施
        if (config.refreshCycle > 0) {

            (function cycle(){
                mbcom.CyclicRead(RED)
                .then(() => {
                    if (cycleFlag) cycleId = setTimeout(cycle, config.refreshCycle * 1000);
                });
            }());

        }
        // クローズ時にサイクリック通信を停止
        // このNodeがクローズされる時は、新たなDeployが行われたとき
        node.on("close",function(done) {
            clearTimeout(cycleId);
            cycleFlag = false;
            mbObj.close(done);
        });

        // linkObjにlinkDtataを追加するイベントリスナーを登録
        node.on("addLinkData", function(lObj) {
            if (Object.keys(lObj).length)  mbcom.addLinkData(lObj);
        });

        // register the event listener that remove linkData of the specific nodeId
        node.on("removeLinkData", function(nodeId) {
            if (nodeId)  mbcom.removeLinkData(nodeId);
        });
    }

    RED.nodes.registerType("Modbus-com",modbusCom);

    RED.httpAdmin.get("/serialports", RED.auth.needsPermission('serial.read'), function(req,res) {
        serialp.list().then(
            ports => {
                const a = ports.map(p => p.path);    // comName は 次のVersion で path にrenameされる。
                res.json(a);
            },
            err => {
                res.json([RED._("serial.errors.list")]);
            }
        )
    });
}
