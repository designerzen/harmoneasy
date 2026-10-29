// Run with: pnpm exec electron tests/electron-midi-smoke.cjs
const { app, BrowserWindow, ipcMain } = require("electron")
const path = require("node:path")
const assert = require("node:assert/strict")

app.whenReady()
	.then(async () => {
		const { registerMidi2IPC } = await import("../electron/midi2-ipc.js")
		registerMidi2IPC(ipcMain, () => require("../build/Release/midi2-native.node"))
		const window = new BrowserWindow({
			show: false,
			webPreferences: {
				preload: path.resolve(__dirname, "../electron/electron-preload.cjs"),
				sandbox: true,
				contextIsolation: true,
				nodeIntegration: false
			}
		})
		await window.loadURL("data:text/html,<title>MIDI bridge smoke test</title>")
		const result = await window.webContents.executeJavaScript(`(async () => {
        const midi = window.electronAPI.midi2
        const capabilities = await midi.getCapabilities()
        const inputs = await midi.getUmpInputs()
        const outputs = await midi.getUmpOutputs()
        for (const device of inputs) {
            await midi.openUmpInput(device.index)
            await midi.closeUmpInput(device.index)
        }
        for (const device of outputs) {
            await midi.openUmpOutput(device.index)
            await midi.getUmpOutputs() // Enumeration must preserve open handles.
            // Note-off only: test transmission without starting an audible note.
            await midi.sendUmp(device.index, [0x40803c00, 0])
            let rejected = false
            try { await midi.sendUmp(device.index, [0x40103c01, 0xffffffff]) }
            catch { rejected = true }
            if (!capabilities.perNoteCC && !rejected) throw new Error('Unsupported per-note message was accepted')
            await midi.closeUmpOutput(device.index)
        }
        return { capabilities, inputs, outputs }
    })()`)
		assert.equal(result.capabilities.nativeOSSupport, true)
		console.log("Electron MIDI smoke test passed:", JSON.stringify(result))
		window.destroy()
		app.quit()
	})
	.catch((error) => {
		console.error(error)
		app.exit(1)
	})