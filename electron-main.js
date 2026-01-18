import { app, BrowserWindow, Menu, ipcMain } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Check if running in development mode
const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev')

let SocketServer = null
let mainWindow
let socketServer

async function initializeSocketServer() {
	try {
		const module = await import('./source/server/socket-server.js')
		SocketServer = module.default
	} catch (e) {
		console.warn('Socket server module not available:', e.message)
	}
}

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1400,
		height: 900,
		minWidth: 800,
		minHeight: 600,
		webPreferences: {
			preload: path.join(__dirname, 'electron-preload.js'),
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
			webSecurity: true,
			enableRemoteModule: false
		},
		icon: path.join(__dirname, 'public/favicon.ico')
	})

	// Always try dev server first, fall back to production
	const startUrl = 'http://localhost:5174'
	mainWindow.loadURL(startUrl)

	// Enable dev tools if dev mode
	if (isDev || process.env.NODE_ENV !== 'production') {
		mainWindow.webContents.openDevTools()
	}

	// Retry loading if connection fails (server not ready yet)
	mainWindow.webContents.on('did-fail-load', () => {
		console.log('Dev server not ready, retrying in 1s...')
		setTimeout(() => {
			mainWindow?.loadURL(startUrl)
		}, 1000)
	})

	mainWindow.on('closed', () => {
		mainWindow = null
	})
}

app.on('ready', async () => {
	await initializeSocketServer()
	createWindow()
	// Start socket server if available
	if (SocketServer) {
		try {
			socketServer = new SocketServer({ port: 3000 })
			socketServer.start()
		} catch (error) {
			console.warn('Failed to start socket server:', error.message)
		}
	}
})

app.on('window-all-closed', () => {
	if (socketServer) {
		socketServer.stop()
	}
	if (process.platform !== 'darwin') {
		app.quit()
	}
})

app.on('activate', () => {
	if (mainWindow === null) {
		createWindow()
	}
})

// Menu
const template = [
	{
		label: 'File',
		submenu: [
			{
				label: 'Exit',
				accelerator: 'CmdOrCtrl+Q',
				click: () => {
					app.quit()
				}
			}
		]
	},
	{
		label: 'Edit',
		submenu: [
			{ role: 'undo' },
			{ role: 'redo' },
			{ type: 'separator' },
			{ role: 'cut' },
			{ role: 'copy' },
			{ role: 'paste' }
		]
	},
	{
		label: 'View',
		submenu: [
			{ role: 'reload' },
			{ role: 'forceReload' },
			{ role: 'toggleDevTools' },
			{ type: 'separator' },
			{ role: 'resetZoom' },
			{ role: 'zoomIn' },
			{ role: 'zoomOut' },
			{ type: 'separator' },
			{ role: 'togglefullscreen' }
		]
	},
	{
		label: 'Help',
		submenu: [
			{
				label: 'About',
				click: () => {
					// TODO: Show about dialog
				}
			}
		]
	}
]

const menu = Menu.buildFromTemplate(template)
Menu.setApplicationMenu(menu)

// IPC handlers for electron-specific functionality
ipcMain.handle('app:get-version', () => {
	return app.getVersion()
})

ipcMain.handle('app:get-path', (event, name) => {
	return app.getPath(name)
})

ipcMain.on('app:minimize', () => {
	if (mainWindow) mainWindow.minimize()
})

ipcMain.on('app:maximize', () => {
	if (mainWindow) {
		if (mainWindow.isMaximized()) {
			mainWindow.unmaximize()
		} else {
			mainWindow.maximize()
		}
	}
})

ipcMain.on('app:close', () => {
	if (mainWindow) mainWindow.close()
})
