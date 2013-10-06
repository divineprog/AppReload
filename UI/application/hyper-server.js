/*
File: hyper-server.js
Description: HyperReload server functionality.
Author: Mikael Kindborg
Copyright (c) 2013 Mikael Kindborg
*/

/*** Modules used ***/

var WEBSERVER = require('./webserver')
var SOCKETIO = require('socket.io')
var FS = require('fs')
var PATH = require('path')
var FILEUTIL = require('./fileutil.js')

/*********************************/
/***       Server code         ***/
/*********************************/

/*** Server variables ***/

var mWebServer
var mIO
var mBasePath
var mAppPath
var mAppFile
var mIpAddress
var mWebServerPort = 4042    
var mSocketIoPort = 4043
var mMessageCallback = null
var mNumberOfConnectedClients = 0

/*** Server functions ***/

/**
 * Internal.
 */
function startWebServer(basePath, port, fun)
{
    var server = WEBSERVER.create()
    server.setBasePath(basePath)
    server.start(port)
    fun(server)
}

/**
 * Internal.
 */
function webServerHookFun(request, response, path)
{
	//console.log('webServerHookFun path: ' + path)
	if (path == '/')
	{
		//console.log('client connection request')
		var page = FS.readFileSync('./application/connect.html', {encoding: 'utf8'})
		mWebServer.writeRespose(response, page, 'text/html')
		return true
	}
	else if (path == '/reloader')
	{
		var script = FS.readFileSync('./application/reloader-template.js', {encoding: 'utf8'})
		script += '("' + mIpAddress + '", true)'
		mWebServer.writeRespose(response, script, 'application/javascript')
		return true
	}
	else if (FILEUTIL.fileIsHTML(path))
	{
		// Here we insert the realoader script in all HTML files requested.
		var script = FS.readFileSync('./application/reloader-template.js', {encoding: 'utf8'})
		var scriptBegin = '<' + 'script' + '>\n'
		var scriptBeginSrc = '<' + 'script src='
		var scriptEnd = '</' + 'script' + '>\n'
		script =
			scriptBeginSrc +
			'"http://' + mIpAddress + ':4043/socket.io/socket.io.js">' +
			scriptEnd +
			scriptBegin +
			script + '("' + mIpAddress + '", false)' +
			scriptEnd
		var filePath = mBasePath + path.substr(1)
		console.log('Requested file: ' + filePath)
		var file = FS.readFileSync(filePath, {encoding: 'utf8'})
		file = insertReloaderScript(file, script)
		mWebServer.writeRespose(response, file, 'text/html')
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
 * Insert the script at the template tag, if no template tag is
 * found, insert at alternative locations in the document.
 * TODO: Experimental and non-general code, improve and clean up.
 */
function insertReloaderScript(file, script)
{
	// Is there a template tag?
	var hasTemplateTag = (-1 != file.indexOf('<!--hyper.reloader-->'))
	if (hasTemplateTag)
	{
		return file.replace('<!--hyper.reloader-->', script)
	}
	
	// Fallback: Insert after title tag.
	// TODO: Rewrite to use regular expressions to capture more cases.
	var pos = file.indexOf('</title>')
	if (pos > -1)
	{
		return file.replace('</title>', '</title>' + script)
	}
	
	// Fallback: Insert last in head.
	// TODO: Rewrite to use regular expressions to capture more cases.
	var pos = file.indexOf('</head>')
	if (pos > -1)
	{
		return file.replace('</head>', script + '</head>')
	}
	
	// Fallback: Insert first in body.
	// TODO: Rewrite to use regular expressions to capture more cases.
	pos = file.indexOf('<body>')
	if (pos > -1)
	{
		return file.replace('<body>', '<body>' + script)
	}
	
	// Fallback: Insert last in body.
	// TODO: Rewrite to use regular expressions to capture more cases.
	pos = file.indexOf('</body>')
	if (pos > -1)
	{
		return file.replace('</body>', script + '</body>')
	}
}

/**
 * External.
 */
function startServers()
{
	//mIO = SOCKETIO.listen(mSocketIoPort, {log: false})
	mIO = SOCKETIO.listen(mSocketIoPort)

	mIO.set('log level', 1)
	
	// Handle socket connections.
	mIO.sockets.on('connection', function(socket) 
	{
		++mNumberOfConnectedClients
	
		// Debug logging.
		console.log('Client connected')
		console.log('mNumberOfConnectedClients: ' + mNumberOfConnectedClients)
		
		socket.on('disconnect', function ()
		{
			--mNumberOfConnectedClients
			
			// Debug logging.
			console.log('Client disconnected')
			console.log('mNumberOfConnectedClients: ' + mNumberOfConnectedClients)
        })
    
		socket.on('log', function(data)
		{
			console.log('got log message: ' + data)
			displayLogMessage(data)
		})
		
		socket.on('jsResult', function(data)
		{
			displayJsResult(data)
		})
		
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

	// Start web server.
	startWebServer(mBasePath, mWebServerPort, function(server)
	{
		mWebServer = server
		mWebServer.getIpAddress(function(address) {
			mIpAddress = address
		})
		mWebServer.setHookFun(webServerHookFun)
	})
}

/**
 * External.
 */
function getWebServerIpAndPort(fun)
{
	mWebServer.getIpAddress(function(address) {
		fun(address, mWebServerPort)
	})
}

/**
 * External.
 */
function setAppPath(appPath)
{
	if (appPath != mAppPath)
	{
		mAppPath = appPath
		var pos = mAppPath.lastIndexOf(PATH.sep) + 1
		mBasePath = mAppPath.substr(0, pos)
		mAppFile = mAppPath.substr(pos)
		mWebServer.setBasePath(mBasePath)
	}
}

/**
 * External.
 * Reloads the main HTML file of the current app.
 */
function sendReload()
{
	mIO.sockets.emit('reload', {url: getMainAppFileURL()})
}

/**
 * External.
 * Reloads the currently visible page of the browser.
 */
function sendReloadCurrentPage()
{
	mIO.sockets.emit('reloadCurrentPage', {})
}

/**
 * External.
 */
function getMainAppFileURL()
{
	return 'http://' + mIpAddress + ':4042/' + mAppFile
}

/**
 * External.
 */
function sendEvalJS(code)
{
	mIO.sockets.emit('evaljs', code)
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
 */
function getNumberOfConnectedClients()
{
	return mNumberOfConnectedClients
}

function displayLogMessage(message)
{
	if (mMessageCallback)
	{
		mMessageCallback({ message: 'log', logMessage: message })
	}
}

function displayJsResult(result)
{
	if (mMessageCallback)
	{
		mMessageCallback({ message: 'jsResult', result: result })
	}
}

// Display version info.
//document.querySelector('#info').innerHTML = 'node.js ' + process.version


/*********************************/
/*** Hot reload on file update ***/
/*********************************/

/*** File traversal variables ***/

var mLastReloadTime = Date.now()
var mTraverseNumDirecoryLevels = 0

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
function fileSystemMonitor()
{
	var filesUpdated = fileSystemMonitorWorker(
		mBasePath,
		mTraverseNumDirecoryLevels)
	if (filesUpdated)
	{
		sendReloadCurrentPage()
		setTimeout(fileSystemMonitor, 1000)
	}
	else
	{
		setTimeout(fileSystemMonitor, 500)
	}
}

/**
 * Internal.
 * Return true if a file ahs been updated, otherwise false.
 */
function fileSystemMonitorWorker(path, level)
{
	//console.log('fileSystemMonitorWorker path:level: ' + path + ':' + level)
	if (!path) { return false }
	try
	{
		/*var files = FS.readdirSync(path)
		for (var i in files)
		{
			console.log(path + files[i])
		}
		return false*/
		
		var files = FS.readdirSync(path)
		for (var i in files)
		{
			try
			{
				var stat = FS.statSync(path + files[i])
				var t = stat.mtime.getTime()
				//console.log('Checking file: ' + files[i] + ': ' + stat.mtime)
				if (stat.isFile() && t > mLastReloadTime)
				{
					console.log('***** File has changed ***** ' + files[i])
					mLastReloadTime = Date.now()
					return true
				}
				else if (stat.isDirectory() && level > 0)
				{
					//console.log('Decending into: ' + path + files[i])
					var changed = fileSystemMonitorWorker(
						path + files[i] + PATH.sep,
						level - 1)
					if (changed) { return true }
				}
			}
			catch(err2)
			{
				console.log('***** ERROR2 fileSystemMonitorWorker ****** ' + err2)
			}
		}
	}
	catch(err1)
	{
		console.log('***** ERROR1 fileSystemMonitorWorker ****** ' + err1)
	}
	return false
}

/*console.log(mBasePath)
var files = FS.readdirSync(mBasePath)
for (var i in files)
{
	console.log(files[i])
}*/

/*********************************/
/***      Module exports       ***/
/*********************************/

exports.startServers = startServers
exports.getWebServerIpAndPort = getWebServerIpAndPort
exports.setAppPath = setAppPath
exports.sendReload = sendReload
exports.sendReloadCurrentPage = sendReloadCurrentPage
exports.getMainAppFileURL = getMainAppFileURL
exports.sendEvalJS = sendEvalJS
exports.setMessageCallbackFun = setMessageCallbackFun
exports.getNumberOfConnectedClients = getNumberOfConnectedClients

exports.setTraverseNumDirectoryLevels = setTraverseNumDirectoryLevels
exports.fileSystemMonitor = fileSystemMonitor
