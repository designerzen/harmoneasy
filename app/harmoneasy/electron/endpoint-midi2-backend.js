import { createRequire } from "node:module"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKET_WORDS = [1, 1, 1, 2, 2, 4, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4]

export function validateUMPWords(words) {
	if (!Array.isArray(words) || words.length < 1 || words.length > 4) {
		throw new TypeError("A UMP message must contain between one and four 32-bit words")
	}
	if (words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffffffff)) {
		throw new TypeError("UMP words must be unsigned 32-bit integers")
	}
	const expected = PACKET_WORDS[(words[0] >>> 28) & 0xf]
	if (words.length !== expected) {
		throw new TypeError(`UMP message type requires ${expected} word(s)`)
	}
	return words.map((word) => word >>> 0)
}

export function normalisePorts(ports = []) {
	const normalised = ports.map((port) => ({
		id: String(port.id),
		name: String(port.name || "Native MIDI 2.0 endpoint"),
		manufacturer: String(port.manufacturer || "Native MIDI 2.0"),
		version: String(port.version || "2.0"),
		type: port.type || "bidirectional",
		nativeDataFormat: port.nativeDataFormat || "ump"
	}))
	return {
		inputs: normalised
			.filter((port) => port.type !== "output")
			.map((port) => ({ ...port, type: "input" })),
		outputs: normalised
			.filter((port) => port.type !== "input")
			.map((port) => ({ ...port, type: "output" }))
	}
}

export function createNativeMIDIBackend(binding, events) {
	let ports = []
	const updatePorts = (nextPorts) => {
		ports = Array.isArray(nextPorts) ? nextPorts : []
		events.onPortsChanged(normalisePorts(ports))
	}
	const result = binding.start({
		onMessage: (message) =>
			events.onMessage({ ...message, words: validateUMPWords(message.words) }),
		onPortsChanged: updatePorts
	})
	ports = Array.isArray(result?.ports) ? result.ports : []
	return {
		get inputs() {
			return normalisePorts(ports).inputs
		},
		get outputs() {
			return normalisePorts(ports).outputs
		},
		send: (endpointId, words, timestamp = 0) =>
			binding.send(endpointId, validateUMPWords(words), timestamp),
		destroy: () => binding.stop()
	}
}

export function getSerializablePorts(backend) {
	return backend
		? { inputs: backend.inputs, outputs: backend.outputs }
		: { inputs: [], outputs: [] }
}

const ADDONS = {
	win32: {
		packageName: "@photosynth/windows-midi-services",
		binary: "photosynth_windows_midi.node",
		fallbackBinary: "windows-midi-services.node",
		label: "Windows MIDI Services"
	},
	darwin: {
		packageName: "@photosynth/macos-coremidi",
		binary: "photosynth_macos_coremidi.node",
		label: "CoreMIDI MIDI 2.0"
	}
}

export function loadEndpointMidi2Binding(platform = process.platform, arch = process.arch) {
	const addon = ADDONS[platform]
	if (!addon) {
		return null
	}
	const require = createRequire(import.meta.url)
	const candidates = [
		path.join(__dirname, "native", "prebuilt", `${platform}-${arch}`, addon.binary),
		addon.fallbackBinary
			? path.join(__dirname, "native", "prebuilt", `${platform}-${arch}`, addon.fallbackBinary)
			: null,
		process.resourcesPath
			? path.join(
					process.resourcesPath,
					"app.asar.unpacked",
					"electron",
					"native",
					"prebuilt",
					`${platform}-${arch}`,
					addon.binary
				)
			: null
	].filter(Boolean)

	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) {
			try {
				return require(candidate)
			} catch (error) {
				console.info(`${addon.label} prebuilt addon failed to load:`, error?.message ?? error)
			}
		}
	}
	try {
		return require(addon.packageName)
	} catch {
		return null
	}
}

export function registerEndpointMidi2IPC(
	ipcMain,
	getWindows,
	loadBinding = loadEndpointMidi2Binding
) {
	let backend = null
	const broadcast = (channel, payload) => {
		for (const win of getWindows()) {
			if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
				win.webContents.send(channel, payload)
			}
		}
	}
	const binding = loadBinding()
	if (binding) {
		try {
			backend = createNativeMIDIBackend(binding, {
				onMessage: (message) => broadcast("midi:message", message),
				onPortsChanged: (ports) => broadcast("midi:ports-changed", ports)
			})
		} catch (error) {
			console.info("Endpoint MIDI 2.0 backend unavailable; using fallback:", error?.message ?? error)
			backend = null
		}
	}

	ipcMain.on("midi:is-available", (event) => {
		event.returnValue = backend !== null
	})
	ipcMain.handle("midi:get-ports", () => getSerializablePorts(backend))
	ipcMain.handle("midi:send", async (_event, payload) => {
		if (!backend?.send) {
			throw new Error("Native MIDI output is unavailable")
		}
		const words = validateUMPWords(payload?.words)
		await backend.send(String(payload.portId), words, Number(payload.timestamp) || 0)
		return true
	})

	return {
		get available() {
			return backend !== null
		},
		destroy() {
			backend?.destroy?.()
			backend = null
		}
	}
}
