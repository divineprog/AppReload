/*
File: hyper-server.js
Description: HyperReload server functionality.
Author: Mikael Kindborg

License:

Copyright (c) 2013 Mikael Kindborg

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

/*** Modules used ***/

var OS = require('os')
var SOCKETIO_CLIENT = require('socket.io-client')
var FS = require('fs')
var PATH = require('path')
var FILEUTIL = require('./fileutil.js')
var SETTINGS = require('../settings/settings.js')
var LOADER = require('./resource-loader.js')

/**
 * Internal.
 *
 * Serve HTML file without inserting reloader script.
 */
function serveHtmlFilePlainlyWithoutReloaderScript(request, response, path)
{
	var content = FILEUTIL.readFileSync(path)
	if (content)
	{
		file.replace('<!--hyper.reloader-->', script)
		mWebServer.writeRespose(response, content, 'text/html')
		return true
	}
	else
	{
		return false
	}
}

/*********************************/
/***	   Server code		   ***/
/*********************************/

/*** Server variables ***/

var mWebServer = null
var mIO
var mBasePath
var mAppPath
var mAppFile
var mIpAddress
var mMessageCallback = null
var mClientConnectedCallback = null
var mReloadCallback = null

// The current base directory. Must NOT end with a slash.
var mBasePath = ''

function setBasePath(path)
{
	mBasePath = path
}

function getBasePath(path)
{
	return mBasePath
}

/*** Server functions ***/

/**
 * Internal.
 *
 * Version of the webserver hook function that inserts the reloader
 * script on each HTML page requested.
 */
function webServerHookFunForScriptInjection(request, response, path)
{
	// Check whitelist.
	if (!authorizeRequest(request, response))
	{
		// Request was not allowed, but has been processed.
		return true
	}

	// Update the server address on every request (overkill but simple).
	// TODO: If connecting using 'localhost' or '127.0.0.1' this
	// will break existing wifi connections! This should be fixed and/or
	// documented.
	mIpAddress = request.socket.address().address

	if (path == '/')
	{
		// Serve the root request.
		return serveRootRequest(request, response)
	}

	// If other request than the root request, check for white listing.
	if (false)//!mWhiteList[request.socket.remoteAddress])
	{
		return serveUnauthorizedRequest(request, response)
	}

	// Proceed serving requests.
	if (path == '/hyper.reloader')
	{
		return serveReloaderScript(response)
	}
	else if (SETTINGS.ServeCordovaJsFiles &&
		(path == '/cordova.js' ||
		path == '/cordova_plugins.js' ||
		path.indexOf('/plugins/') == 0))
	{
		return serveCordovaFile(request, response, path)
	}
	else if (mBasePath && FILEUTIL.fileIsHTML(path))
	{
		return serveHtmlFileWithScriptInjection(request, response, path)
	}
	else
	{
		// Use default processing for all other pages.
		return false
	}
}

/**
 * Internal.
 *
 * Serve root file.
 */
function serveRootRequest(request, response)
{
	// Set the app path so that the server/ui directory can be accessed.
	setAppPath(process.cwd() + '/hyper/server/hyper-connect.html')

	// Always serve the connect page for the root url.
	return serveHtmlFile(
		request,
		response,
		'./hyper/server/hyper-connect.html')

	/* UNUSED
	// Root path is requested, send the current page if set.
	if (mAppPath)
	{
		window.console.log('@@@ serving mAppPath: ' + mAppPath)
		return serveHtmlFile(
			request,
			response,
			mAppPath)
	}
	// Otherwise send the connect page.
	else
	{
		return serveHtmlFile(
			request,
			response,
			'./hyper/server/hyper-connect.html')
	}
	*/
}

/**
 * Internal.
 *
 * Serve reloader script.
 */
function serveReloaderScript(response)
{
	var script = FILEUTIL.readFileSync('./hyper/server/hyper-reloader.js')
	if (script)
	{
		script = script.replace(
			'__SOCKET_IO_PORT_INSERTED_BY_SERVER__',
			SETTINGS.WebServerPort)
		mWebServer.writeRespose(response, script, 'application/javascript')
		return true
	}
	else
	{
		return false
	}
}

/**
 * Internal.
 *
 * Serve HTML file. Will insert reloader script.
 */
function serveHtmlFileWithScriptInjection(request, response, path)
{
	var filePath = mBasePath + path.substr(1)
	return serveHtmlFile(
		request,
		response,
		filePath)
}

/**
 * Internal.
 *
 * Serve Cordova JavaScript file for the platform making the request.
 */
function serveCordovaFile(request, response, path)
{
	// Platform flags (boolean values).
	var userAgent = request['headers']['user-agent']
	var isAndroid = userAgent.indexOf('Android') > 0
	var isIOS =
		(userAgent.indexOf('iPhone') > 0) ||
		(userAgent.indexOf('iPad') > 0) ||
		(userAgent.indexOf('iPod') > 0)
	var isWP = userAgent.indexOf('Windows Phone') > 0

	// Two methods are used to find cordova files for the
	// platform making the request.

	// Method 1:
	// If we are inside a cordova project, we use the
	// files in that project.
	// Folder structure:
	//   www <-- mBasePath (root of running app)
	//     index.html
	//   platforms
	//     android
	//       assets
	//         www
	//           cordova.js
	//           cordova_plugins.js
	//           plugins
	//     ios
	//       www
	//         cordova.js
	//         cordova_plugins.js
	//         plugins

	// Search path to Cordova files in current project.
	// Note that mBasePath ends with path separator.
	var androidCordovaAppPath =
		mBasePath +
		'../platforms/android/assets/' +
		'www' + path
	var iosCordovaAppPath =
		mBasePath +
		'../platforms/ios/' +
		'www' + path
	var wpCordovaAppPath =
		mBasePath +
		'../platforms/wp8/' +
		'www' + path

	// Method 2:
	// Paths to Cordova files in the HyperReload library.
	// This is used if the application is not a Cordova project.
	var androidCordovaLibPath = './hyper/libs-cordova/android' + path
	var iosCordovaLibPath = './hyper/libs-cordova/ios' + path
	var wpCordovaLibPath = './hyper/libs-cordova/wp' + path

	// Get the file, first try the path for a Cordova project, next
	// get the file from the HyperReload Cordova library folder.
	if (isAndroid)
	{
		if (serveJsFile(response, androidCordovaAppPath)) { return true }
		if (serveJsFile(response, androidCordovaLibPath)) { return true }
		return false
	}

	if (isIOS)
	{
		if (serveJsFile(response, iosCordovaAppPath)) { return true }
		if (serveJsFile(response, iosCordovaLibPath)) { return true }
		return false
	}

	if (isWP)
	{
		if (serveJsFile(response, wpCordovaAppPath)) { return true }
		if (serveJsFile(response, wpCordovaLibPath)) { return true }
		return false
	}

	return false
}

/**
 * Internal.
 *
 * If file exists, serve it and return true, otherwise return false.
 * Insert the reloader script if file exists.
 */
function serveHtmlFile(request, response, path)
{
	var document = FILEUTIL.readFileSync(path)
	if (document)
	{
		mWebServer.writeRespose(
			response,
			insertReloaderScript(document, request),
			'text/html')
		return true
	}
	else
	{
		return false
	}
}

/**
 * Internal.
 *
 * Serve HTML file without inserting reloader script.
 * An optional modification function allows the caller
 * to update the content of the file being served.
 */
function serveHtmlFilePlainlyWithoutReloaderScript(request, response, path, modFun)
{
	var content = FILEUTIL.readFileSync(path)
	if (content)
	{
		if (modFun)
		{
			content = modFun(content)
		}
		mWebServer.writeRespose(response, content, 'text/html')
		return true
	}
	else
	{
		return false
	}
}

/**
 * Internal.
 *
 * If file exists, serve it and return true, otherwise return false.
 */
function serveJsFile(response, path)
{
	var content = FILEUTIL.readFileSync(path)
	if (content)
	{
		mWebServer.writeRespose(response, content, 'application/javascript')
		return true
	}
	else
	{
		return false
	}
}

/**
 * Internal.
 *
 * Return script tags for reload functionality.
 */
function createReloaderScriptTags()
{
	return ''
		+ '<script src="/socket.io/socket.io.js"></script>'
		+ '<script src="/hyper.reloader"></script>'
}

/**
 * Internal.
 *
 * Insert the script at the template tag, if no template tag is
 * found, insert at alternative locations in the document.
 *
 * It is desirable to have script tags inserted as early as possible,
 * to enable hyper.log and error reporting during document loading.
 *
 * Applications can use the tag <!--hyper.reloader--> to specify
 * where to insert the reloader script, in case of reload problems.
 */
function insertReloaderScript(html, request)
{
	// Create HTML tags for the reloader script.
	var script = createReloaderScriptTags()

	// Is there a template tag? In that case, insert script there.
	var hasTemplateTag = (-1 != html.indexOf('<!--hyper.reloader-->'))
	if (hasTemplateTag)
	{
		return html.replace('<!--hyper.reloader-->', script)
	}

	// Insert after title tag.
	var pos = html.indexOf('</title>')
	if (pos > -1)
	{
		return html.replace('</title>', '</title>' + script)
	}

	// Insert last in head.
	var pos = html.indexOf('</head>')
	if (pos > -1)
	{
		return html.replace('</head>', script + '</head>')
	}

	// Fallback: Insert first in body.
	// TODO: Rewrite to use regular expressions to capture more cases.
	pos = html.indexOf('<body>')
	if (pos > -1)
	{
		return html.replace('<body>', '<body>' + script)
	}

	// Insert last in body.
	pos = html.indexOf('</body>')
	if (pos > -1)
	{
		return html.replace('</body>', script + '</body>')
	}

	// If no place to insert the reload script, just return the HTML unmodified.
	// TODO: We could insert the script tag last in the document,
	// as a last resort.
	return html
}

/**
 * External.
 */
function getIpAddress(fun)
{
	fun(ensureIpAddress(mIpAddress))
}

/**
 * External.
 */
function getIpAddresses(fun)
{
	mWebServer.getIpAddresses(function(addresses)
	{
		fun(addresses)
	})
}

/**
 * External.
 */
function setAppPath(appPath)
{
	if (appPath != mAppPath)
	{
		mAppPath = appPath.replace(new RegExp("\\"+PATH.sep, 'g'), '/')
		var pos = mAppPath.lastIndexOf('/') + 1
		mBasePath = mAppPath.substr(0, pos)
		mAppFile = mAppPath.substr(pos)
		mWebServer.setBasePath(mBasePath)
	}
}

/**
 * External.
 * Return the name of the main HTML file of the application.
 */
function getAppFileName()
{
	return mAppFile
}

/**
 * External.
 */
function getAppFileURL()
{
	return 'http://' + mIpAddress + ':' + SETTINGS.WebServerPort + '/' + mAppFile
}

/**
 * External.
 */
function getServerBaseURL()
{
	return 'http://' + mIpAddress + ':' + SETTINGS.WebServerPort + '/'
}

/**
 * External.
 * Reloads the main HTML file of the current app.
 */
function runApp()
{
	mIO.emit('hyper.run', {url: getAppFileURL()})
}

/**
 * External.
 * Reloads the currently visible page of the browser.
 */
function reloadApp()
{
	mIO.emit('hyper.reload', {})
	mReloadCallback && mReloadCallback()
}

/**
 * External.
 */
function evalJS(code)
{
	mIO.emit('hyper.eval', code)
}

/**
 * External.
 *
 * Callback form: fun(object)
 */
function setMessageCallbackFun(fun)
{
	mMessageCallback = fun
}

/**
 * External.
 *
 * Callback form: fun()
 */
function setClientConnenctedCallbackFun(fun)
{
	mClientConnectedCallback = fun
}

/**
 * External.
 */
function startServers()
{
	window.console.log('Start servers')

	if (SETTINGS.ServerDiscoveryEnabled)
	{
		window.console.log('Start UDP server')
		startUDPServer(SETTINGS.ServerDiscoveryPort || 4088)
	}

	window.console.log('Start web server')
	startWebServer(mBasePath, SETTINGS.WebServerPort, function(server)
	{
		window.console.log('Web server started')
		mWebServer = server
		mWebServer.getIpAddress(function(address)
		{
			mIpAddress = ensureIpAddress(address)
		})
		mWebServer.setHookFun(webServerHookFunForScriptInjection)
	})
}

/**
 * External.
 */
function stopServers(callback)
{
	window.console.log('Stop servers')
	try
	{
		if (mWebServer)
		{
			mWebServer.stop(function()
			{
				window.console.log('Web server stopped.')
				if (mUDPServer)
				{
					try
					{
						window.console.log('Stop UDP server.')
						mUDPServer.close()
						window.console.log('UDP server stopped.')
						callback && callback()
					}
					catch (error)
					{
						window.console.log('Error when stopping UDP server: ' + error)
					}
				}
			})
		}
	}
	catch (error)
	{
		window.console.log('Error in stopServers: ' + error)
	}
}

/**
 * External.
 */
function restartServers()
{
	window.console.log('Restart servers')

	// Callback passed to stop servers is not always reliable.
	stopServers()

	// Using time out instead to start servers.
	setTimeout(startServers, 5000)
}

/**
 * External.
 *
 * Callback form: fun()
 */
function setReloadCallbackFun(fun)
{
	mReloadCallback = fun
}

/**
 * Internal.
 */
function ensureIpAddress(address)
{
	return address || '127.0.0.1'
}

/**
 * Internal.
 */
function displayLogMessage(message)
{
	if (mMessageCallback)
	{
		mMessageCallback({ message: 'hyper.log', logMessage: message })
	}
}

/**
 * Internal.
 */
function displayJsResult(result)
{
	if (mMessageCallback)
	{
		mMessageCallback({ message: 'hyper.result', result: result })
	}
}

/**
 * Internal.
 */
function startWebServer(basePath, port, fun)
{
	var server = WEBSERVER.create()
	server.setBasePath(basePath)
	server.create()
	createSocketIoServer(server.getHTTPServer())
	server.start(port)
	fun(server)
}

//http://socket.io/blog/introducing-socket-io-1-0/#binary

function connectToProxyServer(url)
{
	// Create socket.
	var socket = SOCKETIO_CLIENT(url)

	// Connect function.
	socket.on('connect', function()
	{
		socket.emit(
			'hyper.workbench-connected',
			{ key: mKey }
			)
	})

	// Get resource function.
	socket.on('hyper.resource-request', function(data)
	{
		serveResource(data.path)

		socket.emit(
			'hyper.resource-response',
			{ image: true, buffer: buf })

		socket.emit(
			'hyper.resource-response',
			{ key: mKey }
			)
	})
}

/**
 * Internal.
 TODO: Delete
 */
function createSocketIoServer(httpServer)
{
	mIO = SOCKETIO(httpServer)

	// Handle socket connections.
	mIO.on('connection', function(socket)
	{
		// Debug logging.
		window.console.log('Client connected')
/*
		if (!isWhiteListed(socket.ip))
		{
			socket.disconnect()
			return
		}
*/
		socket.on('disconnect', function ()
		{
			// Debug logging.
			window.console.log('Client disconnected')
		})

		socket.on('hyper.client-connected', function(data)
		{
			// Debug logging.
			window.console.log('hyper.client-connected')

			mClientConnectedCallback && mClientConnectedCallback()
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

/*********************************/
/*** Hot reload on file update ***/
/*********************************/

/*** File traversal variables ***/

var mLastReloadTime = Date.now()
var mTraverseNumDirecoryLevels = 0
var mFileCounter = 0
var mNumberOfMonitoredFiles = 0

/*** File traversal functions ***/

/**
 * External.
 */
function setTraverseNumDirectoryLevels(levels)
{
	mTraverseNumDirecoryLevels = levels
}

/**
 * External.
 */
function getNumberOfMonitoredFiles()
{
	return mNumberOfMonitoredFiles
}

/**
 * External.
 */
function fileSystemMonitor()
{
	mFileCounter = 0
	var filesUpdated = fileSystemMonitorWorker(
		mBasePath,
		mTraverseNumDirecoryLevels)
	if (filesUpdated)
	{
		reloadApp()
		setTimeout(fileSystemMonitor, 1000)
	}
	else
	{
		mNumberOfMonitoredFiles = mFileCounter
		setTimeout(fileSystemMonitor, 500)
	}
}

/**
 * Internal.
 * Return true if a file ahs been updated, otherwise false.
 */
function fileSystemMonitorWorker(path, level)
{
	//window.console.log('fileSystemMonitorWorker path:level: ' + path + ':' + level)
	if (!path) { return false }
	try
	{
		/*var files = FS.readdirSync(path)
		for (var i in files)
		{
			window.console.log(path + files[i])
		}
		return false*/

		var files = FS.readdirSync(path)
		for (var i in files)
		{
			try
			{
				var stat = FS.statSync(path + files[i])
				var t = stat.mtime.getTime()

				if (stat.isFile())
				{
					++mFileCounter
				}

				//window.console.log('Checking file: ' + files[i] + ': ' + stat.mtime)
				if (stat.isFile() && t > mLastReloadTime)
				{
					//window.console.log('***** File has changed ***** ' + files[i])
					mLastReloadTime = Date.now()
					return true
				}
				else if (stat.isDirectory() && level > 0)
				{
					//window.console.log('Decending into: ' + path + files[i])
					var changed = fileSystemMonitorWorker(
						path + files[i] + '/',
						level - 1)
					if (changed) { return true }
				}
			}
			catch (err2)
			{
				window.console.log('***** ERROR2 fileSystemMonitorWorker ****** ' + err2)
			}
		}
	}
	catch(err1)
	{
		window.console.log('***** ERROR1 fileSystemMonitorWorker ****** ' + err1)
	}
	return false
}

/*********************************/
/***	  Module exports	   ***/
/*********************************/

exports.startServers = startServers
exports.stopServers = stopServers
exports.restartServers = restartServers
exports.getIpAddress = getIpAddress
exports.getIpAddresses = getIpAddresses
exports.setAppPath = setAppPath
exports.getAppFileName = getAppFileName
exports.getAppFileURL = getAppFileURL
exports.getServerBaseURL = getServerBaseURL
exports.runApp = runApp
exports.reloadApp = reloadApp
exports.evalJS = evalJS
exports.setMessageCallbackFun = setMessageCallbackFun
exports.setClientConnenctedCallbackFun = setClientConnenctedCallbackFun
exports.setReloadCallbackFun = setReloadCallbackFun
exports.setTraverseNumDirectoryLevels = setTraverseNumDirectoryLevels
exports.getNumberOfMonitoredFiles = getNumberOfMonitoredFiles
exports.fileSystemMonitor = fileSystemMonitor
