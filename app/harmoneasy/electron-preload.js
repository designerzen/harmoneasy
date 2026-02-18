const { contextBridge, ipcRenderer } = require('electron')

// Expose safe IPC methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
	// Application methods
	getVersion: () => ipcRenderer.invoke('app:get-version'),
	getAppPath: (name) => ipcRenderer.invoke('app:get-path', name),

	// Window control methods
	minimize: () => ipcRenderer.send('app:minimize'),
	maximize: () => ipcRenderer.send('app:maximize'),
	close: () => ipcRenderer.send('app:close'),

	// File system operations (through IPC)
	openFile: async (options) => ipcRenderer.invoke('dialog:openFile', options),
	saveFile: async (options) => ipcRenderer.invoke('dialog:saveFile', options),

	// Platform detection
	platform: process.platform,
	isDev: process.env.NODE_ENV === 'development'
})

// Expose Web Bluetooth API if available
if (navigator.bluetooth) {
	contextBridge.exposeInMainWorld('bluetooth', navigator.bluetooth)
}
