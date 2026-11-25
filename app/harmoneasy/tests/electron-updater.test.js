import { EventEmitter } from "node:events"
import { afterEach, describe, expect, it, vi } from "vitest"
import { setupAutoUpdater } from "../electron/auto-updater.js"
import EVENTS from "../electron/update-events.cjs"

function harness(options = {}) {
	const windows = []
	class Window extends EventEmitter {
		constructor(settings) {
			super()
			this.settings = settings
			this.webContents = Object.assign(new EventEmitter(), {
				send: vi.fn(),
				mainFrame: {},
				setWindowOpenHandler: vi.fn()
			})
			windows.push(this)
		}
		isDestroyed = () => false
		loadFile = vi.fn().mockResolvedValue(undefined)
		show = vi.fn()
		setProgressBar = vi.fn()
		close = vi.fn(() => this.emit(EVENTS.EVENT_CLOSED))
	}
	const updater = Object.assign(new EventEmitter(), {
		checkForUpdates: vi.fn().mockResolvedValue(null),
		downloadUpdate: vi.fn().mockResolvedValue([]),
		quitAndInstall: vi.fn()
	})
	const app = Object.assign(new EventEmitter(), { isPackaged: true, getVersion: () => "1.0.0" })
	const ipcMain = new EventEmitter()
	const getUpdater = vi.fn(() => updater)
	const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() }
	setupAutoUpdater({
		app,
		BrowserWindow: Window,
		ipcMain,
		getUpdater,
		getMainWindow: () => ({}),
		platform: "win32",
		env: {},
		logger,
		...options
	})
	const offer = () => {
		updater.emit(EVENTS.UPDATE_AVAILABLE, { version: "1.1.0" })
		return windows[0]
	}
	const action = (value, sender = windows[0]?.webContents) =>
		ipcMain.emit(EVENTS.UPDATE_ACTION, { sender, senderFrame: sender?.mainFrame }, value)
	return { windows, updater, app, ipcMain, getUpdater, logger, offer, action }
}

afterEach(() => vi.useRealTimers())

describe("desktop updates", () => {
	it("checks on startup, with download, installation, and downgrades disabled by default", () => {
		const h = harness()
		expect(h.updater.checkForUpdates).toHaveBeenCalledOnce()
		expect(h.updater.autoDownload).toBe(false)
		expect(h.updater.autoInstallOnAppQuit).toBe(false)
		expect(h.updater.allowDowngrade).toBe(false)
		expect(h.windows).toHaveLength(0)
	})
	it.each([
		{ app: { isPackaged: false } },
		{ env: { PORTABLE_EXECUTABLE_FILE: "Harmoneasy.exe" } },
		{ platform: "linux" }
	])("skips development and unsupported distributions: %j", (options) => {
		expect(harness(options).getUpdater).not.toHaveBeenCalled()
	})
	it("checks for updates in Linux AppImage builds", () => {
		expect(
			harness({ platform: "linux", env: { APPIMAGE: "/app/Harmoneasy.AppImage" } }).updater
				.checkForUpdates
		).toHaveBeenCalledOnce()
	})
	it("stays quiet when offline or when no newer release exists", async () => {
		const h = harness()
		h.updater.emit(EVENTS.EVENT_ERROR, new Error("ENOTFOUND"))
		await Promise.resolve()
		expect(h.windows).toHaveLength(0)
		expect(h.updater.downloadUpdate).not.toHaveBeenCalled()
	})
	it("lets the user defer without downloading", () => {
		const h = harness()
		const window = h.offer()
		h.action("later")
		expect(window.close).toHaveBeenCalledOnce()
		expect(h.updater.downloadUpdate).not.toHaveBeenCalled()
	})
	it("requires consent, reports progress, and waits for restart consent", async () => {
		vi.useFakeTimers()
		const h = harness()
		const window = h.offer()
		const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
		h.ipcMain.emit(EVENTS.UPDATE_READY, event)
		expect(window.webContents.send).toHaveBeenLastCalledWith(
			EVENTS.UPDATE_STATE,
			expect.objectContaining({ phase: "available", version: "1.1.0" })
		)
		h.action("install")
		expect(h.updater.quitAndInstall).not.toHaveBeenCalled()
		h.action("download")
		h.action("download")
		expect(h.updater.downloadUpdate).toHaveBeenCalledOnce()
		const preventDefault = vi.fn()
		window.emit(EVENTS.EVENT_CLOSE, { preventDefault })
		expect(preventDefault).toHaveBeenCalledOnce()
		h.updater.emit(EVENTS.UPDATE_PROGRESS, {
			percent: 42,
			total: 100,
			transferred: 42,
			bytesPerSecond: 10
		})
		expect(window.setProgressBar).toHaveBeenLastCalledWith(0.42)
		h.updater.emit(EVENTS.UPDATE_DOWNLOADED)
		expect(window.webContents.send).toHaveBeenLastCalledWith(
			EVENTS.UPDATE_STATE,
			expect.objectContaining({ phase: "downloaded" })
		)
		expect(h.updater.quitAndInstall).not.toHaveBeenCalled()
		h.action("install")
		await vi.runAllTimersAsync()
		expect(h.updater.quitAndInstall).toHaveBeenCalledWith(false, true)
		preventDefault.mockClear()
		window.emit(EVENTS.EVENT_CLOSE, { preventDefault })
		expect(preventDefault).not.toHaveBeenCalled()
	})
	it("rejects update actions from other windows and subframes", () => {
		const h = harness()
		const window = h.offer()
		h.action("download", { mainFrame: {} })
		h.ipcMain.emit(
			EVENTS.UPDATE_ACTION,
			{ sender: window.webContents, senderFrame: {} },
			"download"
		)
		expect(h.updater.downloadUpdate).not.toHaveBeenCalled()
	})
	it("shows a recoverable error when download fails", async () => {
		const h = harness()
		const window = h.offer()
		h.updater.downloadUpdate.mockRejectedValueOnce(new Error("connection lost"))
		h.action("download")
		await Promise.resolve()
		expect(window.webContents.send).toHaveBeenLastCalledWith(
			EVENTS.UPDATE_STATE,
			expect.objectContaining({ phase: "error" })
		)
		h.action("download")
		expect(h.updater.downloadUpdate).toHaveBeenCalledTimes(2)
	})
	it("allows quitting during a download and removes action handlers", () => {
		const h = harness()
		const window = h.offer()
		h.action("download")
		h.app.emit(EVENTS.EVENT_BEFORE_QUIT)
		const preventDefault = vi.fn()
		window.emit(EVENTS.EVENT_CLOSE, { preventDefault })
		expect(preventDefault).not.toHaveBeenCalled()
		expect(h.ipcMain.listenerCount(EVENTS.UPDATE_ACTION)).toBe(0)
	})
})