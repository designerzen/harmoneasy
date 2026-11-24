import path from "path"
import { registerMidi2IPC } from "./midi2-ipc.js"
import { registerEndpointMidi2IPC } from "./endpoint-midi2-backend.js"
import {
	app,
	BrowserWindow,
	dialog,
	Menu,
	ipcMain,
	session,
	systemPreferences,
	protocol
} from "electron"
import {
	createMidiDeviceStore,
	MIDI_DEVICE_DIRECTORY
} from "audiobus/hardware/midi-devices/device-files.js"
import { mkdir } from "node:fs/promises"
import { fileURLToPath } from "url"
import { createRequire } from "module"
import { loadElectronModule } from "./electron-loader.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
protocol.registerSchemesAsPrivileged([
	{
		scheme: "midi-device",
		privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
	}
])

const require = createRequire(import.meta.url)
registerMidi2IPC(ipcMain, () => require("../build/Release/midi2-native.node"))
const endpointMidi2 = registerEndpointMidi2IPC(ipcMain, () => BrowserWindow.getAllWindows())

let SocketServer = null
let mainWindow
let socketServer
let createMenuTemplate = null

function setupAutoUpdater() {
	// Only check for updates in production (packaged app)
	if (!app.isPackaged) {
		console.log("Auto-updater disabled in development mode")
		return
	}

	try {
		const updaterModule = require("update-electron-app")
		const updateElectronApp =
			updaterModule.updateElectronApp ?? updaterModule.default ?? updaterModule
		if (typeof updateElectronApp !== "function") {
			console.warn("Auto-updater module did not export a callable function")
			return
		}
		// Uses official Electron update service or Hazel/custom server
		// Checks for updates at app startup, then every 10 minutes
		// Automatically handles dialog and installation
		updateElectronApp({
			repo: "designerzen/harmoneasy"
		})
	} catch (error) {
		console.error("Failed to setup auto-updater:", error)
	}
}

async function initializeSocketServer() {
	for (const modulePath of [
		"../source/server/socket-server.js",
		"./source/server/socket-server.js"
	]) {
		try {
			const module = await import(modulePath)
			SocketServer = module.default
			return
		} catch {
			continue
		}
	}
	console.warn("Socket server module not available")
}

// Create a new window to use
function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1400,
		height: 900,
		minWidth: 800,
		minHeight: 600,
		webPreferences: {
			preload: path.join(__dirname, "electron-preload.cjs"),
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
			webSecurity: true,
			enableRemoteModule: false
		},
		icon: path.join(__dirname, "..", "public", "favicon.ico")
	})

	// Load URL based on whether app is packaged
	// In development (npm run dev:electron): app.isPackaged = false, load from dev server
	// In production (built app): app.isPackaged = true, load from dist files
	const isProduction = app.isPackaged
	if (!isProduction) {
		console.log("Loading app... isProduction:", isProduction)

		// Development: load from Vite dev server
		const devServerUrl = "http://localhost:1999"
		console.log("Dev mode: loading from", devServerUrl)
		mainWindow.loadURL(devServerUrl)
		mainWindow.webContents.openDevTools()

		// Retry loading if connection fails (server not ready yet), bounded to avoid infinite loops
		let devLoadRetries = 0
		const maxDevLoadRetries = 30
		mainWindow.webContents.on("did-finish-load", () => {
			devLoadRetries = 0
		})
		mainWindow.webContents.on("did-fail-load", () => {
			if (devLoadRetries >= maxDevLoadRetries) {
				console.error("Dev server did not become ready after retries.")
				return
			}
			devLoadRetries++
			console.log(`Dev server not ready, retrying in 1s (${devLoadRetries}/${maxDevLoadRetries})...`)
			setTimeout(() => {
				if (mainWindow && !mainWindow.isDestroyed()) {
					mainWindow.loadURL(devServerUrl)
				}
			}, 1000)
		})
	} else {
		// Production: load from built dist files
		mainWindow.loadFile(path.join(__dirname, "..", "dist-electron", "index.html"))
	}

	// Handle Bluetooth device selection
	mainWindow.webContents.on("select-bluetooth-device", (event, deviceList, callback) => {
		event.preventDefault()
		if (deviceList && deviceList.length > 0) {
			callback(deviceList[0].deviceId)
		} else {
			callback("")
		}
	})

	// Handle Bluetooth pairing with explicit user confirmation
	mainWindow.webContents.session.setBluetoothPairingHandler(async (details, callback) => {
		try {
			if (details.pairingKind === "providePin") {
				callback({ confirmed: false })
				return
			}
			const detail =
				details.pairingKind === "confirmPin" && details.pin
					? `Confirm that the PIN ${details.pin} matches the device.`
					: `Allow Bluetooth pairing with device ${details.deviceId}?`
			const { response } = await dialog.showMessageBox(mainWindow, {
				type: "question",
				buttons: ["Pair", "Cancel"],
				defaultId: 0,
				cancelId: 1,
				title: "Bluetooth Pairing Request",
				message: "Pair Bluetooth MIDI device?",
				detail
			})
			callback({ confirmed: response === 0 })
		} catch {
			callback({ confirmed: false })
		}
	})

	mainWindow.on("closed", () => {
		mainWindow = null
	})
}

// If there is already a window on screen,
// we should focus the existing one rather than
// creating a new one each time
function focusOrCreateMainWindow() {
	if (BrowserWindow.getAllWindows().length === 0) {
		createWindow()
		return
	}

	if (mainWindow && !mainWindow.isDestroyed()) {
		// On Linux/Wayland, focus() often doesn't take effect (compositor ignores it). Apps like Telegram
		// work because they receive an XDG activation token via StatusNotifierItem.ProvideXdgActivationToken;
		// Electron's tray doesn't handle that yet. Workaround: destroy and recreate the HUD so the new
		// window gets focus (creation path works). Only for HUD, not editor.
		if (process.platform === "linux" && !mainWindow.isFocused()) {
			const win = mainWindow
			mainWindow = null
			win.once("closed", () => createWindow())
			win.destroy()
			return
		}

		// Show existing!
		mainWindow.show()
		if (mainWindow.isMinimized()) {
			mainWindow.restore()
		}
		mainWindow.moveTop()
		mainWindow.focus()
	}
}

// https://github.com/aalhaimi/electron-web-bluetooth/blob/master/main.js
app.commandLine.appendSwitch("enable-web-bluetooth", true)

app.on("ready", async () => {
	const userMidiDevices = path.join(app.getPath("userData"), "midi-devices")
	await mkdir(userMidiDevices, { recursive: true })
	const profiles = createMidiDeviceStore(() => [userMidiDevices, MIDI_DEVICE_DIRECTORY])
	protocol.handle("midi-device", async (request) => {
		const url = new URL(request.url)
		const headers = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" }
		if (url.hostname !== "registry" || request.method !== "GET") {
			return new Response(null, { status: 404, headers })
		}
		try {
			const relative = decodeURIComponent(url.pathname.slice(1))
			const file = relative
				? await profiles.read(relative)
				: { type: "application/json", bytes: JSON.stringify(await profiles.list()) }
			if (!file) {
				return new Response(null, { status: 404, headers })
			}
			return new Response(file.bytes, { headers: { ...headers, "Content-Type": file.type } })
		} catch {
			return new Response(null, { status: 500, headers })
		}
	})

	await initializeSocketServer()

	setupAutoUpdater()

	// Add user permissions
	const allowedPermissions = new Set([
		"media",
		"audioCapture",
		"microphone",
		"midi",
		"midiSysex"
	])
	session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
		return allowedPermissions.has(permission)
	})

	session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
		callback(allowedPermissions.has(permission))
	})

	// extra neccessary
	if (process.platform === "darwin") {
		const micStatus = systemPreferences.getMediaAccessStatus("microphone")
		if (micStatus !== "granted") {
			await systemPreferences.askForMediaAccess("microphone")
		}
	}

	// Load menu template using the loader
	try {
		const menuModule = await loadElectronModule("electron-menu")
		createMenuTemplate = menuModule.createMenuTemplate

		// Setup menu
		const template = createMenuTemplate(app)
		const menu = Menu.buildFromTemplate(template)
		Menu.setApplicationMenu(menu)
	} catch (error) {
		console.error("Failed to setup application menu:", error.message)
	}

	focusOrCreateMainWindow()

	// Start socket server if available
	if (SocketServer) {
		try {
			socketServer = new SocketServer({ port: 3000 })
			socketServer.start()
		} catch (error) {
			console.warn("Failed to start socket server:", error.message)
		}
	}
})

app.on("window-all-closed", () => {
	endpointMidi2.destroy()
	if (socketServer) {
		socketServer.stop()
	}
	if (process.platform !== "darwin") {
		app.quit()
	}
})

app.on("activate", () => {
	if (mainWindow === null) {
		focusOrCreateMainWindow()
	}
})

// IPC handlers for electron-specific functionality
ipcMain.handle("app:get-version", () => {
	return app.getVersion()
})

const ALLOWED_APP_PATHS = new Set([
	"home",
	"appData",
	"userData",
	"temp",
	"desktop",
	"documents",
	"downloads",
	"music"
])

ipcMain.handle("app:get-path", (_event, name) => {
	if (typeof name !== "string" || !ALLOWED_APP_PATHS.has(name)) {
		throw new Error(`Disallowed app path requested: ${String(name)}`)
	}
	return app.getPath(name)
})

ipcMain.handle("dialog:openFile", (_event, options = {}) => {
	const safeOptions = options && typeof options === "object" ? options : {}
	return dialog.showOpenDialog(mainWindow, safeOptions)
})

ipcMain.handle("dialog:saveFile", (_event, options = {}) => {
	const safeOptions = options && typeof options === "object" ? options : {}
	return dialog.showSaveDialog(mainWindow, safeOptions)
})

ipcMain.on("app:minimize", () => {
	if (mainWindow) {
		mainWindow.minimize()
	}
})

ipcMain.on("app:maximize", () => {
	if (mainWindow) {
		if (mainWindow.isMaximized()) {
			mainWindow.unmaximize()
		} else {
			mainWindow.maximize()
		}
	}
})

ipcMain.on("app:close", () => {
	if (mainWindow) {
		mainWindow.close()
	}
})