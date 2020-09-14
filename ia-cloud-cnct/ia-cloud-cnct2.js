
"use strict";

module.exports = function(RED) {

    const iaCloudConnection = require("./util/ia-cloud-connection.js");

    function iaCloudCnct2(config) {
        RED.nodes.createNode(this,config);

        let node = this;
        let cnctRtryId;     // connect retry timer ID
        let tappTimerId;    // tapping CCS (getStatus()) interval timer ID
        
        // ia-cloud connection config node instance
        const ccsConnectionConfigNode = RED.nodes.getNode(config.ccsConnectionConfig);

        // 接続情報を保持するオブジェクト
        let info = {
            status: "Disconnected",
            serviceID: "",
            url: ccsConnectionConfigNode.url,
        //    userID: ccsConnectionConfigNode.credentials.userId,
            FDSKey: config.FDSKey,
            FDSType: "iaCloudFDS",
            cnctTs:"",
            lastReqTs: "",
            comment: config.comment,
            cnctRetryInterval: config.cnctRetryInterval * 60 * 1000,
            tappingInterval: config.tappingInterval * 60 * 60 * 1000,

            proxy: null,
            reqTimeout: 12000
        };

        let auth = {
            user: ccsConnectionConfigNode.credentials.userId,
            pass: ccsConnectionConfigNode.credentials.password,
        };

        // proxy設定を取得
        let prox;
        let noprox;
        if (process.env.http_proxy != null) { prox = process.env.http_proxy; }
        if (process.env.HTTP_PROXY != null) { prox = process.env.HTTP_PROXY; }
        if (process.env.no_proxy != null) { noprox = process.env.no_proxy.split(","); }
        if (process.env.NO_PROXY != null) { noprox = process.env.NO_PROXY.split(","); }

        let noproxy;

        if (noprox) {
            for (let i in noprox) {
                if (info.url.indexOf(noprox[i]) !== -1) { noproxy=true; }
            }
        }
        if (prox && !noproxy) {
            let match = prox.match(/^(http:\/\/)?(.+)?:([0-9]+)?/i);
            if (match) {
                info.proxy = prox;
            } else {
                node.warn("Bad proxy url: "+ prox);
                info.proxy = null;
            }
        }

        // このタイムアウトの設定の詳細を調査する必要あり
        if (RED.settings.httpRequestTimeout) {
            info.reqTimeout = parseInt(RED.settings.httpRequestTimeout) || 120000;
        }
        else { info.reqTimeout = 120000; }

        let cnctInfoName = "ia-cloud-connection-" + info.FDSKey;
        let fContext = this.context().flow;
        fContext.set(cnctInfoName, info);

        const iaC = new iaCloudConnection(fContext, cnctInfoName);

        //connect request を送出（接続状態にないときは最大cnctRetryIntervalで繰り返し）

        let rInt = 3 * 60 * 1000;   //リトライ間隔の初期値3分
        // connectリクエストのトライループ
        (function cnctTry() {

            //非接続状態なら接続トライ
            if (info.status === "Disconnected") {

                // node status をconnecting に
                node.status({fill:"blue",shape:"dot",text:"runtime.connecting"});

                // nodeの出力メッセージ（CCS接続状態）
                let msg = {};
                (async () => {
                    // connect リクエスト
                    try {
                        let res = await iaC.connect(auth);
                        node.status({fill:"green", shape:"dot", text:"runtime.connected"});
                        msg.payload = res;
                    } catch (error) {
                        node.status({fill:"yellow", shape:"ring", text:error.message});
                        msg.payload = error.message;
                    } finally {
                        node.send(msg);
                    }
                })();
            }
            //retryの設定。倍々で間隔を伸ばし最大はcnctRetryInterval、
            if (info.cnctRetryInterval !== 0) {
                cnctRtryId = setTimeout(cnctTry, rInt);
                rInt *= 2;
                rInt = (rInt < info.cnctRetryInterval)? rInt: info.cnctRetryInterval;
            }
        }());

        if (info.tappingInterval !== 0) {
            tappTimerId = setInterval(function(){

                //非接続状態の時は、何もしない。
                if (info.status === "Disconnected") return;

                // node status をconnecting に
                node.status({fill:"blue",shape:"dot",text:"runtime.connecting"});
                info.status = "requesting";
                let msg = {};
                (async () => {
                    // getStatus リクエスト
                    try {
                        let res = await iaC.getStatus(auth);
                        node.status({fill:"green", shape:"dot", text:"runtime.connected"});
                        msg.payload = res;
                    } catch (error) {
                        node.status({fill:"yellow", shape:"ring", text:error.message});
                        msg.payload = error.message;
                    } finally {
                        node.send(msg);
                    }
                })();
            }, info.tappingInterval) ;
        }

        this.on("input",function(msg) {

            info = fContext.get(cnctInfoName);

            //非接続状態の時は、何もしない。
            if (info.status === "Disconnected") return;
            
            if (msg.request === "store"
                || msg.request === "retrieve" || msg.request === "convey"){

                // node status をReqesting に
                node.status({fill:"blue", shape:"dot", text:"runtime.requesting"});
                info.status = "requesting";

                let dataObject = msg.dataObject;
                (async () => {
                    // リクエスト
                    try {
                        let res;
                        if (msg.request === "store") res = await iaC.store(auth, dataObject);
                        if (msg.request === "retrieve") res = await iaC.retrieve(auth);
                        if (msg.request === "convey") res = await iaC.convey(auth);
                        node.status({fill:"green", shape:"dot", text:"runtime.request-done"});
                        msg.payload = res;
                    } catch (error) {
                        node.status({fill:"yellow", shape:"ring", text:error.message});
                        msg.payload = error.message;
                    } finally {
                        node.send(msg);
                    }
                })();
            }
        });

        this.on("close",function(done) {

            // stop timers for the retry and the tapping
            clearTimeout(cnctRtryId);
            clearInterval(tappTimerId);

            //非接続状態の時は、何もしない。
            if (info.status === "Disconnected") return;
            
            (async () => {
                // terminate request
                try {
                    let res = await iaC.terminate(auth);
                    node.status({fill:"green", shape:"dot", text:"runtime.connected"});

                } catch (error) {
                    node.status({fill:"yellow", shape:"ring", text:error.message});

                } finally {
                    done();
                }
            })();
        });
    }
    
    RED.nodes.registerType("ia-cloud-cnct2",iaCloudCnct2,{
        credentials: {
            userID: {type:"text"},
            password: {type: "password"}
        }
    });
}
