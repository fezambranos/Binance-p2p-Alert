const functions = require("firebase-functions");

exports.binanceP2PProxy = functions.https.onRequest(require("./binanceP2PProxy").binanceP2PProxy);
