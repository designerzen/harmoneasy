const { contextBridge, ipcRenderer } = require("electron")
const EVENTS = require("./update-events.cjs")

contextBridge.exposeInMainWorld("updates", {
	download: () => ipcRenderer.send(EVENTS.UPDATE_ACTION, "download"),
	install: () => ipcRenderer.send(EVENTS.UPDATE_ACTION, "install"),
	later: () => ipcRenderer.send(EVENTS.UPDATE_ACTION, "later"),
	onState: (callback) => {
		ipcRenderer.on(EVENTS.UPDATE_STATE, (_event, state) => callback(state))
		ipcRenderer.send(EVENTS.UPDATE_READY)
	},
	EVENT_CLICK: EVENTS.EVENT_CLICK
})