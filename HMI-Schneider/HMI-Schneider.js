
module.exports = function (RED) {
  "use strict";
  var moment = require("moment");
  var fs = require("fs");

  function HmiSchneider(config) {

    RED.nodes.createNode(this, config);
    this.dataObject = {};
    this.connected = false;
    this.hmiCom = RED.nodes.getNode(config.HmiSchneiderCom);

    // Nodeステータスを、preparingにする。
    this.status({ fill: "blue", shape: "ring", text: "runtime.preparing" });

    // プロパティを読み込んでオブジェクトを生成
    this.dataObject = { ObjectContent: {} };
    this.dataObject.storeInterval = config.storeInterval;
    if (config.storeInterval < 1) { this.dataObject.storeInterval = 1; }  //  min 1 sec
    this.dataObject.objectName = config.objectName;
    this.dataObject.objectKey = config.objectKey;
    this.dataObject.objectDescription = config.objectDescription;
    this.dataObject.ObjectContent.contentType = config.contentType;
    this.dataObject.ObjectContent.contentData = [];
    for (let i = 0, len = config.dataItems.length; i < len; i++) {
      this.dataObject.ObjectContent.contentData.push(Object.assign({}, config.dataItems[i]));
    }

    // configObjから通信する変数情報を取り出し、HmiSchneiderCom Nodeに追加
    let linkObj = { Items: [] };
    linkObj.nodeId = this.id;
    linkObj.kind = "variable";

    this.dataObject.lastCheck = null;

    this.dataObject.ObjectContent.contentData.forEach(function (dataItem, index) {
      linkObj.Items.push(dataItem.varName);
      dataItem.value = null;
      dataItem.prev = null;
    });

    //HmiSchneiderCom nodeのデータ追加メソッドを呼ぶ
    this.hmiCom.emit("addLinkData", linkObj);

    // Nodeステータスを変更
    this.setWebSocketStatus = function () {
      if (this.connected)
        this.status({ fill: "green", shape: "dot", text: "runtime.connected" });
      else
        this.status({ fill: "red", shape: "dot", text: "runtime.disconnected" });
    };
    this.setWebSocketStatus();

    this.on("valueUpdated", function (variables) {
      this.dataObject.ObjectContent.contentData.forEach(function (dataItem, index) {
        for (let i = 0; i < variables.length; i++) {
          if (dataItem.varName == variables[i].name) {
            let value = (variables[i].quality != "good") ? null : variables[i].value;
            //if (dataItem.value != value) {
            //  this.log("valueUpdated "+variables[i].name+ "/" +  variables[i].quality + "/" + variables[i].value);
            //}
            dataItem.value = value;
            break;
          }
        }
      });
    });

    this.on("alarmUpdated", function (alarms) {
    });

    this.on("statusChanged", function (connected) {
      this.connected = connected;
      this.setWebSocketStatus();
    });

    this.haveVarsUpdated = function (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].value != items[i].prev) {
          return true;
        }
      }
      return false;
    };

    this.IntervalFunc = function () {
      let current = Date.now();

      if ((this.dataObject.lastCheck != null) &&
        (current - (this.dataObject.lastCheck) < (this.dataObject.storeInterval * 1000))) {
        return;
      }
      this.dataObject.lastCheck = current;

      let items = this.dataObject.ObjectContent.contentData;

      if (this.haveVarsUpdated(items) == false) {
        return;
      }

      let dataItems = [];
      for (let i = 0; i < items.length; i++) {
        items[i].prev = items[i].value;

        let item = {};
        item.name = items[i].dataName;
        item.value = items[i].value;
        item.unit = items[i].unit;
        dataItems.push(item);
      }

      this.iaCloudObjectSend(this.dataObject, dataItems);
    };

    this.sendObjectId = setInterval(this.IntervalFunc.bind(this), (1000));

    this.iaCloudObjectSend = function (iaObject, dataItems) {

      this.status({ fill: "blue", shape: "ring", text: "runtime.preparing" });

      let msg = { request: "store", dataObject: { ObjectContent: {} } };
      let contentData = [];

      msg.dataObject.objectKey = iaObject.objectKey;
      msg.dataObject.timeStamp = moment().format();
      msg.dataObject.objectType = "iaCloudObject";
      msg.dataObject.objectDescription = iaObject.objectDescription;
      msg.dataObject.ObjectContent.contentType = iaObject.ObjectContent.contentType;

      for (let i = 0; i < dataItems.length; i++) {
        let dItem = {};

        dItem.dataName = dataItems[i].name;
        dItem.dataValue = dataItems[i].value;
        if ((dataItems[i].unit != null) && (dataItems[i].unit != "")) {
          dItem.unit = dataItems[i].unit;
        }

        contentData.push(dItem);
      }

      msg.dataObject.ObjectContent.contentData = contentData;
      msg.payload = contentData;

      //this.log("send message to iaCloud node : " + JSON.stringify(msg));
      this.send(msg);
      this.status({ fill: "blue", shape: "dot", text: "runtime.sent" });

      this.setWebSocketStatus();
    }

    this.on("input", function (msg) {
      //何もしない
    });

    this.on("close", function () {
      clearInterval(this.sendObjectId);
      this.hmiCom.emit("delinkData", this.id);
    });
  }

  RED.nodes.registerType("HMI-Schneider", HmiSchneider);

}
