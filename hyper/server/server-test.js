var ASSERT = require('assert')

// ------------------------------------------------

var LOADER = require('./resource-loader.js')
var result = LOADER.readResource('./server-test.js')
ASSERT.equal(result.resultCode, 200)

// ------------------------------------------------

var SERVER = require('./hyper-file-server.js')

SERVER.setAppPath('/Users/miki/code/evo-demos/Demos2015/cordova-ibeacon/www/index.html')

ASSERT.equal(SERVER.getAppFileName(), 'index.html')

//console.log(SERVER.getAppFileName())
//console.log(SERVER.getAppPath())
//console.log(SERVER.getBasePath())

var result = SERVER.serveResource('ios', '/index.html')
ASSERT.equal(result.resultCode, 200)

var result = SERVER.serveResource('ios', '/cordova.js')
ASSERT.equal(result.resultCode, 200)

SERVER.connectToRemoteServer('http://localhost:4044')

