/*
File: hyper-server.js
Description: HyperReload remote server functionality.
Author: Mikael Kindborg

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
var LOGGER = require('./log.js')

/*********************************/
/***     Global variables      ***/
/*********************************/

var mWebServerPort = 4044
var mWebServer = null
var mBasePath = ''
var mIO = null
var mIO_ClientSockets = []
var mIO_WorkbenchSockets = []
var mResourseRequestCounter = 1
var mResourseRequestCallbacks = {}
var mUserKeys = {}

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
	LOGGER.log('Start servers')

	mWebServer = createWebServer()
	LOGGER.log('Web server started')

	createSocketIoServer(mWebServer.getHTTPServer())
	LOGGER.log('Socket.io server started')
}

function createWebServer()
{
	var server = WEBSERVER.create()
	server.setBasePath(mBasePath)
	server.create()
	server.setHookFun(webServerHookFunction)
	server.start(mWebServerPort)
	return server
}

function createSocketIoServer(httpServer)
{
	LOGGER.log('Start socket.io server')

	mIO = SOCKETIO(httpServer)

	// Handle socket connections.
	mIO.on('connection', function(socket)
	{
		// Debug logging.
		//LOGGER.log('socket.io client connected')

		// ****** Disconnect ******

		socket.on('disconnect', function()
		{
			// Debug logging.
			LOGGER.log('Disconnected ' + socket.__agent_type__)
		})

		// ****** Messages from the workbench client ******

		socket.on('hyper.workbench-connected', function(data)
		{
			// Debug logging.
			LOGGER.log('Workbench connected')

			socket.__agent_type__ = 'workbench'

			// Generate key (session lifetime).
			var key = generateUserKey()

			// Join room.
			var room = 'workbench-' + key
			socket.join(room)

			// Send key to workbench.
			mIO.to(room).emit('hyper.user-key', { key: key })
		})

		socket.on('hyper.resource-response', function(data)
		{
			// Got data from the workbench, pass it on
			// to the client using the callback function,
			// then delete the callback.
			mResourseRequestCallbacks[data.id](data)
			delete mResourseRequestCallbacks[data.id]
		})

		socket.on('hyper.run', function(data)
		{
			// Pass URL to run to mobile clients.
			var room = 'client-' + data.key
			//LOGGER.log('hyper.run url: ' + data.url)
			mIO.to(room).emit('hyper.run', data.url)
		})

		socket.on('hyper.reload', function(data)
		{
			// Pass reload command to mobile clients.
			var room = 'client-' + data.key
			mIO.to(room).emit('hyper.reload', {})
		})

		socket.on('hyper.eval', function(data)
		{
			// Pass code to eval to mobile clients.
			var room = 'client-' + data.key
			mIO.to(room).emit('hyper.eval', data.code)
		})

		// ****** Messages from the mobile client ******

		socket.on('hyper.client-connected', function(data)
		{
			// Debug logging.
			LOGGER.log('Mobile client connected')

			socket.__agent_type__ = 'mobile client'

			// Join room.
			var key = data.key
			var room = 'client-' + key
			socket.join(room)

			// Tell the workbench that a client has connected.
			var room = 'workbench-' + key
			mIO.to(room).emit('hyper.client-connected', data.key)
		})

		socket.on('hyper.log', function(data)
		{
			// Pass log message to the workbench.
			var room = 'workbench-' + data.key
			mIO.to(room).emit('hyper.log', data.message)
		})

		socket.on('hyper.result', function(data)
		{
			// Pass result message to the workbench.
			var room = 'workbench-' + data.key
			mIO.to(room).emit('hyper.log', data.result)
		})
	})
}

// Path format: /hyper/<key>/<request>
function webServerHookFunction(request, response, path)
{
	//LOGGER.log('webServerHookFunction: ' + path)

	// Get platform string value.
	var platform = getPlatformFromRequest(request)

	// Get the key and request element.
	var requestElements = getRequestElements(path)

	if (requestElements && isHyperRequest(requestElements.hyper))
	{
		// Send request for file to workbench.
		requestResourse(
			requestElements.request,
			platform,
			requestElements.key,
			response)
	}
	else
	{
		// TODO: This should be an error (404)?
		LOGGER.log('*** Other Request: ' + path)
		mWebServer.writeRespose(
			response,
			'Other Request: ' + path,
			'text/html')
	}

	// Return true to tell web server no further processing should be done.
	return true
}

function getPlatformFromRequest(request)
{
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

	return platform
}

function requestResourse(path, platform, key, response)
{
	// Get socket.io connection for key.

	// Send request and wait for result.
	// TODO: Use room or namespace for key.
	++mResourseRequestCounter
	var data = {
		id: mResourseRequestCounter,
		key: key,
		platform: platform,
		path: path
		}
	var room = 'workbench-' + key
	//LOGGER.log('sent hyper.resource-request to ' + room + ' : ' + path)
	mIO.to(room).emit('hyper.resource-request', data)

	mResourseRequestCallbacks[mResourseRequestCounter] =
		function(data)
		{
			//LOGGER.log('writing response for hyper.resource-request' + ' : ' + path)
			// Send result to client.
			// TODO: Handle error pages.
			mWebServer.writeRespose(
				response,
				data.response.content,
				data.response.contentType)
		}
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
	var part3 = path.substring(slash3)

	return { hyper: part1, key: part2, request: part3 }
}

// TODO: Make safe key generation/exchange.
function generateUserKey()
{
	var chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
	var key = ''
	for (var i = 0; i < 4; ++i)
	{
		var index = Math.floor(Math.random() * chars.length)
		key += chars[index]
	}
	return key
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

main()
