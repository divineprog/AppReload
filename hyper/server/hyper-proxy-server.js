/*
File: hyper-proxy-server.js

License:

Copyright (c) 2013-2015 Mikael Kindborg

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/*********************************/
/***       Modules used        ***/
/*********************************/

var OS = require('os')
var FS = require('fs')
var PATH = require('path')
var SOCKETIO = require('socket.io')
var FILEUTIL = require('./fileutil.js')
var WEBSERVER = require('./webserver')

/*********************************/
/***     Global variables      ***/
/*********************************/

var mWebServerPort = 4044
var mWebServer = null
var mBasePath = ''
var mIO = null
var mIO_ClientSockets = []
var mIO_WorkbenchSockets = []

/*********************************/
/***       Main function       ***/
/*********************************/

function main()
{
	// Start webserver and socket.io server.
	startServers()
}

/*********************************/
/***     Server functions      ***/
/*********************************/

function startServers()
{
	console.log('Start servers')

	console.log('Start web server')
	startWebServer(mBasePath, mWebServerPort, function(server)
	{
		console.log('Web server started')
		mWebServer = server
		mWebServer.setHookFun(webServerHookFunction)
	})
}

function startWebServer(basePath, port, fun)
{
	var server = WEBSERVER.create()
	server.setBasePath(basePath)
	server.create()
	createSocketIoServer(server.getHTTPServer())
	server.start(port)
	fun(server)
}

/*
Use rooms for client/workbench

Use namespace for keys

var nsp = io.of('/my-namespace');
nsp.on('connection', function(socket){
  console.log('someone connected'):
});
nsp.emit('hi', 'everyone!');
*/

function createSocketIoServer(httpServer)
{
	console.log('Start socket.io server')

	mIO = SOCKETIO(httpServer)

	// Handle socket connections.
	mIO.on('connection', function(socket)
	{
		// Debug logging.
		console.log('socket.io client connected')

		socket.on('disconnect', function ()
		{
			// Debug logging.
			console.log('socket.io client disconnected')
		})

		socket.on('hyper.workbench-connected', function(data)
		{
			// Debug logging.
			console.log('hyper.workbench-connected')
			console.log(data)

			// TODO: Join room?
			//var room = data['room']
			//socket.join(room)
		})

		socket.on('hyper.resource-response', function(data)
		{
			// Debug logging.
			console.log('hyper.resource-response')
			console.log(data)
		})

		socket.on('hyper.client-connected', function(data)
		{
			// Debug logging.
			console.log('hyper.client-connected')

			// TODO: Join room?
		})

		socket.on('hyper.log', function(data)
		{
			displayLogMessage(data)
		})

		socket.on('hyper.result', function(data)
		{
			//window.console.log('data result type: ' + (typeof data))
			//window.console.log('data result : ' + data)

			// Functions cause a cloning error.
			if (typeof data == 'function')
			{
				data = typeof data
			}
			displayJsResult(data)
		})

		// TODO: This code is not used, remove it eventually.
		// Closure that holds socket connection.
		/*(function(socket)
		{
			//mSockets.push_back(socket)
			//socket.emit('news', { hello: 'world' });
			socket.on('unregister', function(data)
			{
				mSockets.remove(socket)
			})
		})(socket)*/
	})
}

// Format: /hyper/<key>/request
function webServerHookFunction(request, response, path)
{
	//console.log('Request Object')
	//printObject(getRequestElements(path))

	// Platform flags (boolean values).
	var userAgent = request['headers']['user-agent']
	var isAndroid = userAgent.indexOf('Android') > 0
	var isIOS =
		(userAgent.indexOf('iPhone') > 0) ||
		(userAgent.indexOf('iPad') > 0) ||
		(userAgent.indexOf('iPod') > 0)
	var isWP = userAgent.indexOf('Windows Phone') > 0

	// Set platform string value.
	var platform = 'unknown'
	platform = isAndroid && 'android'
	platform = isIOS && 'ios'
	platform = isWP && 'wp'

	var requestElements = getRequestElements(path)

	if (requestElements && isHyperRequest(requestElements.hyper))
	{
		// Send request to the client.
		requestResourse(
			requestElements.request,
			platform,
			requestElements.key,
			response)

		// Test
		/*
		mWebServer.writeRespose(
			response,
			'Hyper Request: ' + requestElements['request']
				+ ' Key: ' + requestElements['key'],
			'text/html')
		*/
	}
	else
	{
		mWebServer.writeRespose(
			response,
			'Other Request: ' + path,
			'text/html')
	}

	// Tell web server no further processing should be done.
	return true
}

function isHyperRequest(token)
{
	return 'hyper' == token
}

// Return request elements: /hyper/key/request
function getRequestElements(path)
{
	var slash1 = path.indexOf('/')
	var slash2 = path.indexOf('/', slash1 + 1)
	var slash3 = path.indexOf('/', slash2 + 1)

	if (slash1 != 0 || slash2 == -1 || slash3 == -1)
	{
		return null
	}

	var part1 = path.substring(1, slash2)
	var part2 = path.substring(slash2 + 1, slash3)
	var part3 = path.substring(slash3 + 1)

	return { hyper: part1, key: part2, request: part3 }
}

function requestResourse(path, platform, key, response)
{
	// Get socket.io connection for key.

	// Send request and wait for result.
	var data = { key: key, platform: platform, path: path }
	mIO.emit('hyper.resource-request', data)
	console.log('sent hyper.resource-request')
	console.log(data)

	// Send result to client.
	/*
		mWebServer.writeRespose(
			response,
			'Hyper Request: ' + requestElements['request']
				+ ' Key: ' + requestElements['key'],
			'text/html')
	*/
}

/*
function getRequestKey(path)
{
	var token = '/hyper/'
	var tokenLength = token.length
	var nextSlash = path.indexOf('/', tokenLength)
	var key = path.substr(tokenLength, nextSlash - 1)
	return key
}
*/

/*
function printObject(obj, printFun)
{
	printFun = printFun || console.log;
	function print(obj, level)
	{
		var indent = new Array(level + 1).join('  ')
		for (var prop in obj)
		{
			if (obj.hasOwnProperty(prop))
			{
				var value = obj[prop]
				if (typeof value == 'object')
				{
					printFun(indent + prop + ':')
					print(value, level + 1)
				}
				else
				{
					printFun(indent + prop + ': ' + value)
				}
			}
		}
	}
	print(obj, 0)
}
*/

main()
