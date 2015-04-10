/*
File: hyper-file-server.js
Description: HyperReload local file server.
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
/***     Imported modules      ***/
/*********************************/

var OS = require('os')
var FS = require('fs')
var PATH = require('path')
var SOCKETIO_CLIENT = require('socket.io-client')
var FILEUTIL = require('./fileutil.js')
var SETTINGS = require('../settings/settings.js')
var LOADER = require('./resource-loader.js')
var LOGGER = require('./log.js')

/*********************************/
/***     Server variables      ***/
/*********************************/

var mUserKey = 'DefaultUserKey'
var mRemoteServerURL = 'http://localhost:4044'
var mSocket
var mAppPath
var mAppFile
var mMessageCallback
var mClientConnectedCallback
var mReloadCallback
var mStatusCallback

// The current base directory. Must NOT end with a slash.
var mBasePath = ''

/*********************************/
/***     Server functions      ***/
/*********************************/

function connectToRemoteServer()
{
	LOGGER.log('Connecting to remote server')

	// Create socket.
	var socket = SOCKETIO_CLIENT(mRemoteServerURL)

	// Global reference
	mSocket = socket

	// Connect function.
	socket.on('connect', function()
	{
		// Send key to server to join room.
		socket.emit(
			'hyper.workbench-connected',
			{
				key: mUserKey
			})

		mStatusCallback && mStatusCallback('Connected')
	})

	socket.on('disconnect', function ()
	{
		mStatusCallback && mStatusCallback('Disconnected')
	})

	// Get resource function.
	socket.on('hyper.resource-request', function(data)
	{
		//LOGGER.log('hyper.resource-request: ' + data.path)
		var response = serveResource(data.platform, data.path)
		socket.emit(
			'hyper.resource-response',
			{
				id: data.id,
				key: mUserKey,
				response: response
			})
	})

	socket.on('hyper.client-connected', function(data)
	{
		// Notify UI callback that a client has connected.
		mClientConnectedCallback && mClientConnectedCallback()
	})

	socket.on('hyper.log', function(data)
	{
		mMessageCallback && mMessageCallback(
			{ message: 'hyper.log', logMessage: data })
	})

	socket.on('hyper.result', function(data)
	{
		// Functions cause a cloning error, just send the type.
		if (typeof data == 'function')
		{
			data = typeof data
		}
		mMessageCallback && mMessageCallback(
			{ message: 'hyper.result', result: data })
	})
}

/**
 * Internal.
 */
function serveResource(platform, path)
{
	//LOGGER.log('serveResource: ' + path)

	if (path == '/')
	{
		// Serve the root request (Connect page).
		return serveRootRequest()
	}
	else if (path == '/hyper.reloader')
	{
		return serveReloaderScript()
	}
	else if (SETTINGS.getServeCordovaJsFiles() &&
		(path == '/cordova.js' ||
		path == '/cordova_plugins.js' ||
		path.indexOf('/plugins/') == 0))
	{
		return serveCordovaFile(platform, path)
	}
	else if (mBasePath && FILEUTIL.fileIsHTML(path))
	{
		return serveHtmlFileWithScriptInjection(mBasePath + path.substr(1))
	}
	else if (mBasePath)
	{
		return LOADER.readResource(mBasePath + path.substr(1))
	}
	else
	{
		// If base path is not set, serve the Connect page.
		return serveRootRequest()
	}
}

/**
 * Internal.
 *
 * Serve root file.
 */
function serveRootRequest()
{
	// Set the app path so that the server/ui directory can be accessed.
	setAppPath(process.cwd() + '/hyper/server/hyper-connect.html')

	// Always serve the connect page for the root url.
	return serveHtmlFile('./hyper/server/hyper-connect.html')
}

/**
 * Internal.
 *
 * Serve reloader script.
 */
function serveReloaderScript()
{
	var script = FILEUTIL.readFileSync('./hyper/server/hyper-reloader.js')
	script = script.replace(
		'__USER_KEY_INSERTED_BY_SERVER__',
		mUserKey)
	return LOADER.createResponse(script, 'application/javascript')
}

/**
 * Internal.
 *
 * Serve HTML file. Will insert reloader script.
 */
function serveHtmlFileWithScriptInjection(filePath)
{
	return serveHtmlFile(filePath)
}

/**
 * Internal.
 *
 * If file exists, serve it and return true, otherwise return false.
 * Insert the reloader script if file exists.
 */
function serveHtmlFile(path)
{
	var html = FILEUTIL.readFileSync(path)
	if (html)
	{
		var data = insertReloaderScript(html)
		return LOADER.createResponse(data, 'text/html')
	}
	else
	{
		return LOADER.createErrorResponse('File not found: ' + path)
	}
}

/**
 * Internal.
 *
 * Returns null if file is not found.
 */
function serveFileOrNull(path)
{
	var result = LOADER.readResource(path)
	if (200 == result.resultCode)
	{
		return result
	}
	else
	{
		return null
	}
}

/**
 * Internal.
 *
 * Serve Cordova JavaScript file for the platform making the request.
 */
function serveCordovaFile(platform, path)
{
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
	//
	// Set path to Cordova files in current project.
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
	var cordovaJsFile = null
	if ('android' == platform)
	{
		cordovaJsFile =
			serveFileOrNull(androidCordovaAppPath) ||
			serveFileOrNull(androidCordovaLibPath)
	}
	else if ('ios' == platform)
	{
		cordovaJsFile =
			serveFileOrNull(iosCordovaAppPath) ||
			serveFileOrNull(iosCordovaLibPath)
	}
	else if ('wp' == platform)
	{
		cordovaJsFile =
			serveFileOrNull(wpCordovaAppPath) ||
			serveFileOrNull(wpCordovaLibPath)
	}

	return cordovaJsFile ||
		LOADER.createErrorResponse('File not found: ' + path)
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
		+ '<script src="/hyper/' + mUserKey + '/hyper.reloader"></script>'
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
function insertReloaderScript(html)
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
function setAppPath(appPath)
{
	if (appPath != mAppPath)
	{
		mAppPath = appPath.replace(new RegExp('\\' + PATH.sep, 'g'), '/')
		var pos = mAppPath.lastIndexOf('/') + 1
		mBasePath = mAppPath.substr(0, pos)
		mAppFile = mAppPath.substr(pos)
	}
}

/**
 * External.
 *
 * Return the name of the main HTML file of the application.
 */
function getAppFileName()
{
	return mAppFile
}

/**
 * External.
 */
function getAppPath()
{
	return mAppPath
}

/**
 * External.
 */
function getBasePath()
{
	return mBasePath
}

/**
 * External.
 */
function getAppServerURL()
{
	return mRemoteServerURL + '/hyper/' + mUserKey + '/' + mAppFile
}

/**
 * External.
 */
function getServerBaseURL()
{
	return mRemoteServerURL + '/hyper/' + mUserKey + '/'
}

/**
 * External.
 *
 * Reloads the main HTML file of the current app.
 */
function runApp()
{
	mSocket.emit('hyper.run', { key: mUserKey, url: getAppFileURL() })
}

/**
 * External.
 *
 * Reloads the currently visible page of the browser.
 */
function reloadApp()
{
	mSocket.emit('hyper.reload', { key: mUserKey })
	mReloadCallback && mReloadCallback()
}

/**
 * External.
 */
function evalJS(code)
{
	LOGGER.log('emit eval: ' + code)
	mSocket.emit('hyper.eval', { key: mUserKey, code: code })
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
 *
 * Callback form: fun()
 */
function setReloadCallbackFun(fun)
{
	mReloadCallback = fun
}

/**
 * External.
 *
 * Callback form: fun(message)
 */
function setStatusCallbackFun(fun)
{
	mStatusCallback = fun
}

/**
 * External.
 */
function setUserKey(key)
{
	mUserKey = key
}

/**
 * External.
 */
function setRemoteServerURL(url)
{
	mRemoteServerURL = url
}

/*********************************/
/***	  Module exports	   ***/
/*********************************/

exports.setAppPath = setAppPath
exports.getAppPath = getAppPath
exports.getBasePath = getBasePath
exports.getAppFileName = getAppFileName
exports.getAppServerURL = getAppServerURL
exports.getServerBaseURL = getServerBaseURL
exports.runApp = runApp
exports.reloadApp = reloadApp
exports.evalJS = evalJS
exports.setMessageCallbackFun = setMessageCallbackFun
exports.setClientConnenctedCallbackFun = setClientConnenctedCallbackFun
exports.setStatusCallbackFun = setStatusCallbackFun
exports.setReloadCallbackFun = setReloadCallbackFun
exports.serveResource = serveResource
exports.connectToRemoteServer = connectToRemoteServer
exports.setUserKey = setUserKey
exports.setRemoteServerURL = setRemoteServerURL
