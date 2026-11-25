import path from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { existsSync } from "node:fs"
import EVENTS from "./update-events.cjs"

const require = createRequire(import.meta.url)
const directory = path.dirname(fileURLToPath(import.meta.url))

// Keep Electron and the updater injectable so lifecycle and consent can be tested without installing.
export function setupAutoUpdater({
	app,
	BrowserWindow,
	ipcMain,
	getMainWindow,
	getUpdater = () => require("electron-updater").autoUpdater,
	platform = process.platform,
	env = process.env,
	resourcesPath = process.resourcesPath,
	logger = console
}) {
	if (!app.isPackaged || env.PORTABLE_EXECUTABLE_FILE) {
		return
	}
	// electron-builder marks installed Linux packages so electron-updater can select DebUpdater.
	if (
		platform === "linux" &&
		!env.APPIMAGE &&
		!(resourcesPath && existsSync(path.join(resourcesPath, "package-type")))
	) {
		return
	}

	let updater
	try {
		updater = getUpdater()
	} catch (error) {
		logger.warn("Could not initialize updates", error)
		return
	}
	updater.autoDownload = false
	updater.autoInstallOnAppQuit = false
	updater.allowDowngrade = false
	updater.allowPrerelease = false
	updater.logger = logger
	updater.requestHeaders = { ...updater.requestHeaders, "Cache-Control": "no-cache" }

	let window = null
	let quitting = false
	let handingOff = false
	let state = { phase: "checking", currentVersion: app.getVersion() }
	const sendState = () => {
		if (!window || window.isDestroyed()) {
			return
		}
		window.webContents.send(EVENTS.UPDATE_STATE, state)
		window.setProgressBar(state.phase === "downloading" ? (state.percent ?? 0) / 100 : -1)
	}
	const setState = (next) => {
		state = { ...state, ...next }
		sendState()
	}
	const fail = (error) => {
		handingOff = false
		logger.warn("Update failed", error)
		// No interruption for offline startup, missing releases, or a failed background check.
		if (state.phase === "checking") {
			return
		}
		setState({ phase: "error" })
	}
	const showOffer = (info) => {
		if (quitting || !getMainWindow() || window) {
			return
		}
		state = { phase: "available", currentVersion: app.getVersion(), version: info.version }
		window = new BrowserWindow({
			parent: getMainWindow(),
			modal: true,
			width: 520,
			height: 360,
			resizable: false,
			minimizable: false,
			maximizable: false,
			show: false,
			title: "Harmoneasy update",
			autoHideMenuBar: true,
			webPreferences: {
				preload: path.join(directory, "update-preload.cjs"),
				nodeIntegration: false,
				contextIsolation: true,
				// Only the isolated preload imports our shared IPC constants.
				sandbox: false
			}
		})
		window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
		window.webContents.on(EVENTS.EVENT_WILL_NAVIGATE, (event) => event.preventDefault())
		window.once(EVENTS.EVENT_READY_TO_SHOW, () => window?.show())
		window.on(EVENTS.EVENT_CLOSE, (event) => {
			if (!quitting && !handingOff && ["downloading", "installing"].includes(state.phase)) {
				event.preventDefault()
			}
		})
		window.on(EVENTS.EVENT_CLOSED, () => {
			window = null
		})
		void window.loadFile(path.join(directory, "update.html")).catch(fail)
	}
	const trusted = (event) =>
		window &&
		!window.isDestroyed() &&
		event.sender === window.webContents &&
		event.senderFrame === window.webContents.mainFrame
	const onReady = (event) => {
		if (trusted(event)) {
			sendState()
		}
	}
	const onAction = async (event, action) => {
		if (!trusted(event)) {
			return
		}
		if (action === "later" && ["available", "downloaded", "error"].includes(state.phase)) {
			window.close()
		} else if (action === "download" && ["available", "error"].includes(state.phase)) {
			setState({
				phase: "downloading",
				percent: 0,
				transferred: 0,
				total: 0,
				bytesPerSecond: 0
			})
			try {
				await updater.downloadUpdate()
			} catch (error) {
				fail(error)
			}
		} else if (action === "install" && state.phase === "downloaded") {
			setState({ phase: "installing" })
			// Give the renderer a frame to show the handoff animation before the installer takes over.
			setTimeout(() => {
				handingOff = true
				try {
					updater.quitAndInstall(false, true)
				} catch (error) {
					fail(error)
				}
			}, 300)
		}
	}
	const onProgress = ({ percent, transferred, total, bytesPerSecond }) => {
		if (state.phase === "downloading") {
			setState({
				percent: Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0,
				transferred,
				total,
				bytesPerSecond
			})
		}
	}
	const onDownloaded = () => {
		if (state.phase === "downloading") {
			setState({ phase: "downloaded", percent: 100 })
		}
	}
	ipcMain.on(EVENTS.UPDATE_READY, onReady)
	ipcMain.on(EVENTS.UPDATE_ACTION, onAction)
	updater.on(EVENTS.UPDATE_AVAILABLE, showOffer)
	updater.on(EVENTS.UPDATE_PROGRESS, onProgress)
	updater.on(EVENTS.UPDATE_DOWNLOADED, onDownloaded)
	updater.on(EVENTS.EVENT_ERROR, fail)
	app.once(EVENTS.EVENT_BEFORE_QUIT, () => {
		quitting = true
		ipcMain.removeListener(EVENTS.UPDATE_READY, onReady)
		ipcMain.removeListener(EVENTS.UPDATE_ACTION, onAction)
	})
	void updater.checkForUpdates().catch(fail)
}