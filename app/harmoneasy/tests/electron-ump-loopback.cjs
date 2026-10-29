// pnpm exec electron tests/electron-ump-loopback.cjs
// Uses OS loopback endpoints, never an attached instrument or third-party driver.
const { app, BrowserWindow, ipcMain } = require("electron")
const { spawn, spawnSync } = require("node:child_process")
const { mkdtempSync, rmSync } = require("node:fs")
const { tmpdir } = require("node:os")
const path = require("node:path")
const assert = require("node:assert/strict")

let helper, temporary
const testName = `Harmoneasy UMP test ${process.pid}`
async function startMacLoopback() {
	temporary = mkdtempSync(path.join(tmpdir(), "harmoneasy-ump-"))
	const executable = path.join(temporary, "loopback")
	const build = spawnSync(
		"xcrun",
		[
			"clang++",
			"-std=c++17",
			"-fblocks",
			"-mmacosx-version-min=11.0",
			path.join(__dirname, "native-coremidi-loopback.cc"),
			"-framework",
			"CoreMIDI",
			"-framework",
			"CoreFoundation",
			"-o",
			executable
		],
		{ encoding: "utf8" }
	)
	if (build.error || build.status) {
		throw new Error(build.error?.message ?? build.stderr)
	}
	helper = spawn(executable, [testName], { stdio: ["pipe", "pipe", "inherit"] })
	await new Promise((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error("CoreMIDI helper did not start")), 10000)
		helper.stdout.once("data", () => {
			clearTimeout(timeout)
			resolve()
		})
		helper.once("error", (error) => {
			clearTimeout(timeout)
			reject(error)
		})
		helper.once("exit", (code) => {
			clearTimeout(timeout)
			reject(new Error(`CoreMIDI helper exited: ${code}`))
		})
	})
}

app.whenReady()
	.then(async () => {
		if (process.platform === "darwin") {
			await startMacLoopback()
		}
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
		await window.loadURL("data:text/html,<title>Native UMP loopback</title>")
		const result = await window.webContents.executeJavaScript(`(async () => {
        const midi = window.electronAPI.midi2
        const capabilities = await midi.getCapabilities()
        if (!capabilities.umpSupport) throw new Error('Native UMP transport unavailable')
        const inputs = await midi.getUmpInputs(true), outputs = await midi.getUmpOutputs(true)
        const input = inputs.find(d => d.id?.toUpperCase().includes('DIAG_LOOPBACK_B') || d.name.includes(${JSON.stringify(testName)}))
        const output = outputs.find(d => d.id?.toUpperCase().includes('DIAG_LOOPBACK_A') || d.name.includes(${JSON.stringify(testName)}))
        if (!input || !output) throw new Error('OS UMP loopback endpoints unavailable')
        const packets = [
            [0x10f80000],
            [0x4f9f3c03, 0xabcd1234],
            [0x4f1f3c4a, 0xdeadbeef],
            [0x45b44a00, 0x12345678],
            [0x40e00000, 0x80000001],
            [0x5005017d, 0x12345678, 0, 0],
            [0x4f8f3c00, 0x43210000]
        ]
        const received = []
        let timer, resolveReceived, rejectReceived
        const allReceived = new Promise((resolve, reject) => { resolveReceived = resolve; rejectReceived = reject })
        const remove = midi.onUmpInput((index, words) => {
            if (index !== input.index) return
            received.push(words)
            if (received.length === packets.length) { clearTimeout(timer); resolveReceived() }
        })
        try {
            await midi.openUmpInput(input.index)
            await midi.openUmpOutput(output.index)
            await midi.getUmpOutputs(true) // Discovery must not replace live handles.
            timer = setTimeout(() => rejectReceived(new Error('UMP receive timed out: ' + JSON.stringify(received))), 5000)
            for (const packet of packets) await midi.sendUmp(output.index, packet)
            await allReceived
            if (JSON.stringify(received) !== JSON.stringify(packets)) throw new Error('UMP data changed: ' + JSON.stringify(received))
            // Verify framing rejects incomplete 64-/128-bit messages at the native boundary.
            let rejected = 0
            for (const packet of [[0x40903c00], [0x5005017d, 0, 0]]) {
                try { await midi.sendUmp(output.index, packet) } catch { rejected++ }
            }
            if (rejected !== 2) throw new Error('Truncated UMP was accepted')
            // Closing and reopening input must not break an output sharing its endpoint.
            if (capabilities.windowsMIDIServices) {
                await midi.openUmpOutput(input.index)
                await midi.closeUmpInput(input.index)
                await midi.openUmpInput(input.index)
                await midi.closeUmpOutput(input.index)
            }
            return { backend: capabilities.backend, packets: received.length, input: input.name, output: output.name }
        } finally {
            clearTimeout(timer); remove()
            await midi.closeUmpInput(input.index)
            await midi.closeUmpOutput(output.index)
        }
    })()`)
		assert.equal(result.packets, 7)
		console.log("Native MIDI 2.0 Electron loopback passed:", JSON.stringify(result))
		window.destroy()
	})
	.then(() => finish(0))
	.catch((error) => {
		console.error(error)
		finish(1)
	})

function finish(code) {
	if (helper && helper.exitCode === null) {
		helper.once("exit", () => {
			if (temporary) {
				rmSync(temporary, { recursive: true, force: true })
			}
			app.exit(code)
		})
		helper.stdin.end("\n")
	} else {
		if (temporary) {
			rmSync(temporary, { recursive: true, force: true })
		}
		app.exit(code)
	}
}