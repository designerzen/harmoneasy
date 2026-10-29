const { contextBridge, ipcRenderer } = require("electron")

// Serialize port reference changes so a disconnect cannot race a reconnect.
const references = new Map()
let pending = Promise.resolve()
function reference(method, index, opening) {
	const key = `${method}:${index}`
	const action = pending.then(async () => {
		const count = references.get(key) ?? 0
		if (opening) {
			if (!count) {
				await ipcRenderer.invoke(`midi2:openUmp${method}`, index)
			}
			references.set(key, count + 1)
		} else if (count) {
			if (count === 1) {
				await ipcRenderer.invoke(`midi2:closeUmp${method}`, index)
				references.delete(key)
			} else {
				references.set(key, count - 1)
			}
		}
	})
	pending = action.catch(() => {})
	return action
}

// Expose safe IPC methods to the renderer process
contextBridge.exposeInMainWorld("electronAPI", {
	midi2: {
		getUmpInputs: (diagnostics = false) =>
			ipcRenderer.invoke("midi2:getUmpInputs", diagnostics),
		getUmpOutputs: (diagnostics = false) =>
			ipcRenderer.invoke("midi2:getUmpOutputs", diagnostics),
		getCapabilities: () => ipcRenderer.invoke("midi2:getCapabilities"),
		openUmpInput: (index) => reference("Input", index, true),
		closeUmpInput: (index) => reference("Input", index, false),
		openUmpOutput: (index) => reference("Output", index, true),
		closeUmpOutput: (index) => reference("Output", index, false),
		sendUmp: (index, words) => ipcRenderer.invoke("midi2:sendUmp", index, words),
		onUmpInput: (callback) => {
			const listener = (_event, index, words, timestamp) => callback(index, words, timestamp)
			ipcRenderer.on("midi2:input", listener)
			return () => ipcRenderer.removeListener("midi2:input", listener)
		}
	},
	// Application methods
	getVersion: () => ipcRenderer.invoke("app:get-version"),
	getAppPath: (name) => ipcRenderer.invoke("app:get-path", name),

	// Window control methods
	minimize: () => ipcRenderer.send("app:minimize"),
	maximize: () => ipcRenderer.send("app:maximize"),
	close: () => ipcRenderer.send("app:close"),

	// File system operations (through IPC)
	openFile: async (options) => ipcRenderer.invoke("dialog:openFile", options),
	saveFile: async (options) => ipcRenderer.invoke("dialog:saveFile", options),

	// Platform detection
	platform: process.platform,
	isDev: process.env.NODE_ENV === "development"
})

// Expose Web Bluetooth API if available
if (navigator.bluetooth) {
	contextBridge.exposeInMainWorld("bluetooth", navigator.bluetooth)
}