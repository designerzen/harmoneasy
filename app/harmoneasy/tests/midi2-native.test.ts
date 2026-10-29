import { afterEach, describe, expect, it, vi } from "vitest"
import { EventEmitter } from "node:events"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { registerMidi2IPC } from "../electron/midi2-ipc.js"
import Input from "../../../packages/audiobus/io/inputs/input-midi2-native-device"
import Output from "../../../packages/audiobus/io/outputs/output-midi2-native-device"
import {
	midiBytesToUmp,
	umpToMidiBytes,
	isUmpPacket,
	umpToCommand,
	commandToUmp
} from "../../../packages/audiobus/midi/ump-codec"
import { NOTE_OFF, NOTE_ON } from "../../../packages/audiobus/commands"

afterEach(() => vi.unstubAllGlobals())

function setup() {
	const listeners = new Set<(index: number, words: number[]) => void>()
	const bridge = {
		getUmpInputs: vi.fn(async () => [
			{ index: 0, name: "A" },
			{ index: 3, name: "B" }
		]),
		getUmpOutputs: vi.fn(async () => [
			{ index: 0, name: "A" },
			{ index: 3, name: "B" }
		]),
		getCapabilities: vi.fn(async () => ({ perNoteCC: false, midi2Support: false })),
		openUmpInput: vi.fn(async (_index: number) => {}),
		closeUmpInput: vi.fn(async (_index: number) => {}),
		openUmpOutput: vi.fn(async (_index: number) => {}),
		closeUmpOutput: vi.fn(async (_index: number) => {}),
		sendUmp: vi.fn(async (_index: number, _words: number[]) => {}),
		onUmpInput: (callback: (index: number, words: number[]) => void) => {
			listeners.add(callback)
			return () => listeners.delete(callback)
		}
	}
	vi.stubGlobal("window", { electronAPI: { midi2: bridge } })
	return {
		bridge,
		listeners,
		receive: (index: number, words: number[]) => {
			for (const listener of listeners) {
				listener(index, words)
			}
		}
	}
}

describe("native MIDI UMP codec", () => {
	it("encodes complete two-word MIDI 2.0 messages", () => {
		expect(midiBytesToUmp([0x92, 60, 127])).toEqual([0x40923c00, 0xffff0000])
		expect(midiBytesToUmp([0xb2, 74, 127])).toEqual([0x40b24a00, 0xffffffff])
		expect(midiBytesToUmp([0xc2, 42])).toEqual([0x40c20000, 0x2a000000])
		expect(midiBytesToUmp([0xf8])).toEqual([0x10f80000])
		expect(midiBytesToUmp([0xe0, 0, 64])).toEqual([0x40e00000, 0x80000000])
		expect(midiBytesToUmp([0xb0, 1, 64])).toEqual([0x40b00100, 0x80000000])
		expect(midiBytesToUmp([0xb0, 1, 70])).toEqual([0x40b00100, 0x8c30c30c])
		expect(midiBytesToUmp([0x90, 60, 0])[0]).toBe(0x40803c00)
	})
	it.each([
		[0x90, 60, 100],
		[0x80, 60, 45],
		[0xa5, 61, 99],
		[0xb0, 64, 127],
		[0xc0, 42],
		[0xd0, 90],
		[0xe0, 0, 64],
		[0xe0, 127, 127]
	])("round trips %j without losing note/controller data", (...bytes) => {
		expect(umpToMidiBytes(midiBytesToUmp(bytes))).toEqual(bytes)
	})
	it("rejects truncated or malformed packets", () => {
		expect(umpToMidiBytes([0x40903c00])).toBeUndefined()
		expect(umpToMidiBytes([0x40903c00, -1])).toBeUndefined()
		expect(() => midiBytesToUmp([0xf0, 1, 0xf7])).toThrow("Unsupported")
		expect(isUmpPacket([0x5005017d, 0, 0])).toBe(false)
		expect(isUmpPacket([0x5005017d, 0x12345678, 0, 0])).toBe(true)
		expect(isUmpPacket([0xb0000000, 1, 2])).toBe(true)
	})
	it("preserves native precision and attributes while allowing note transformations", () => {
		const command = umpToCommand([0x4f923c03, 0xabcd1234], 0, "keyboard")!
		expect(commandToUmp(command)).toEqual([0x4f923c03, 0xabcd1234])
		command.number = 72
		expect(commandToUmp(command)).toEqual([0x4f924803, 0xabcd1234])
		command.velocity = 127
		expect(commandToUmp(command)).toEqual([0x4f924803, 0xffff1234])
		command.type = NOTE_OFF
		command.velocity = 0
		expect(commandToUmp(command)).toEqual([0x4f824803, 0x1234])
	})
})

describe("native MIDI renderer adapters", () => {
	it("forwards native input to output without reducing 16/32-bit values or dropping per-note/SysEx8 data", async () => {
		const { bridge, receive } = setup()
		bridge.getCapabilities.mockResolvedValue({ perNoteCC: true, midi2Support: true })
		const input = new Input(),
			output = new Output({ selectedDevice: "3", selectedChannel: 5 })
		const dispatch = vi.spyOn(input, "dispatch")
		await input.connect()
		await output.connect()
		const packets = [
			[0x4f923c03, 0xabcd1234],
			[0x4f123c4a, 0xdeadbeef],
			[0x4fb24a00, 0x12345678],
			[0x4fe20000, 0x80000001],
			[0x5005017d, 0x12345678, 0, 0]
		]
		for (const packet of packets) {
			receive(0, packet)
			await output.sendCommand(dispatch.mock.calls.at(-1)![0])
		}
		expect(bridge.sendUmp.mock.calls).toEqual(
			packets.map((packet) => [
				3,
				packet[0] >>> 28 === 4
					? [((packet[0] & 0xfff0ffff) | 0x40000) >>> 0, packet[1]]
					: packet
			])
		)
		await input.disconnect()
		await output.disconnect()
		expect(bridge.sendUmp).toHaveBeenLastCalledWith(3, [0x4f843c00, 0])
	})
	it("sends full-resolution public methods and serializes per-note control after note-on", async () => {
		const { bridge } = setup()
		bridge.getCapabilities.mockResolvedValue({ perNoteCC: true, midi2Support: true })
		const output = new Output()
		await output.connect()
		await Promise.all([
			output.noteOn16(60, 0xabcd, 16, 15),
			output.sendPerNoteController32(60, 74, 0x12345678, 16, 15)
		])
		await output.sendControlChange32(74, 0xdeadbeef, 16, 15)
		await output.sendPitchBend32(0x80000001, 16, 15)
		expect(bridge.sendUmp.mock.calls).toEqual([
			[0, [0x4f9f3c00, 0xabcd0000]],
			[0, [0x4f1f3c4a, 0x12345678]],
			[0, [0x4fbf4a00, 0xdeadbeef]],
			[0, [0x4fef0000, 0x80000001]]
		])
		await output.disconnect()
		expect(bridge.sendUmp).toHaveBeenLastCalledWith(0, [0x4f8f3c00, 0])
	})
	it("filters device and channel, decodes velocity, and releases notes on disconnect", async () => {
		const { bridge, receive, listeners } = setup()
		const input = new Input({ selectedDevice: "3", selectedChannel: 2 })
		const dispatch = vi.spyOn(input, "dispatch")
		const note = vi.fn()
		input.addEventListener("noteon", note)
		await Promise.all([input.connect(), input.connect()])
		expect(bridge.openUmpInput).toHaveBeenCalledTimes(2)
		receive(0, [0x20913c64])
		receive(3, [0x20903c64])
		expect(dispatch).not.toHaveBeenCalled()
		receive(3, [0x40913c00, 0xffff0000])
		expect(dispatch).toHaveBeenLastCalledWith(
			expect.objectContaining({ type: NOTE_ON, number: 60, velocity: 127, channel: 2 })
		)
		expect(note.mock.calls[0][0].detail.velocity).toBe(65535)
		await input.disconnect()
		expect(dispatch).toHaveBeenLastCalledWith(
			expect.objectContaining({ type: NOTE_OFF, number: 60, channel: 2 })
		)
		expect(bridge.closeUmpInput.mock.calls).toEqual([[0], [3]])
		expect(listeners.size).toBe(0)
		await input.connect()
		await input.disconnect()
		expect(listeners.size).toBe(0)
	})
	it("keeps same pitch independent across devices and channels", async () => {
		const { receive } = setup()
		const input = new Input()
		await input.connect()
		receive(0, [0x20903c64])
		receive(0, [0x20913c64])
		receive(3, [0x20903c64])
		expect(input.getActiveNotesWithControllers().size).toBe(3)
		receive(0, [0x20803c00])
		expect(input.getActiveNotesWithControllers().size).toBe(2)
		await input.disableDevice(3)
		expect(input.getActiveNotesWithControllers().size).toBe(1)
		await input.destroy()
	})
	it("releases sustain even after the held notes have ended", async () => {
		const { receive } = setup()
		const input = new Input()
		await input.connect()
		const dispatch = vi.spyOn(input, "dispatch")
		receive(0, [0x20b1407f])
		await input.disconnect()
		expect(dispatch).toHaveBeenLastCalledWith(
			expect.objectContaining({ channel: 2, number: 64, value: 0 })
		)
	})
	it("rolls back a partially opened input connection", async () => {
		const { bridge, listeners } = setup()
		bridge.openUmpInput.mockRejectedValueOnce(new Error("Busy"))
		const input = new Input()
		await expect(input.connect()).rejects.toThrow("Busy")
		expect(input.isConnected).toBe(false)
		expect(listeners.size).toBe(0)
		bridge.openUmpInput.mockImplementation(async (index) => {
			if (index === 3) {
				throw new Error("Busy")
			}
		})
		await expect(input.connect()).rejects.toThrow("Busy")
		expect(bridge.closeUmpInput).toHaveBeenCalledWith(0)
	})
	it("routes direct output methods through saved selections and closes after releasing notes", async () => {
		const { bridge } = setup()
		const output = new Output({ selectedDevice: "3", selectedChannel: 5 })
		await Promise.all([output.connect(), output.connect()])
		expect(bridge.openUmpOutput.mock.calls).toEqual([[3]])
		await output.noteOn(60, 127, 2)
		expect(bridge.sendUmp).toHaveBeenLastCalledWith(3, [0x40943c00, 0xffff0000])
		await output.sendPitchBend(8192, 2)
		expect(umpToMidiBytes(bridge.sendUmp.mock.calls.at(-1)![1])).toEqual([0xe4, 0, 64])
		await output.disconnect()
		expect(bridge.sendUmp).toHaveBeenLastCalledWith(3, [0x40843c00, 0])
		expect(bridge.closeUmpOutput.mock.calls).toEqual([[3]])
		expect(output.isConnected).toBe(false)
		await expect(output.sendPerNoteController(60, 1, 100)).rejects.toThrow(
			"native MIDI 2.0 transport"
		)
	})
	it("propagates failed sends and still closes on release failure", async () => {
		const { bridge } = setup()
		const output = new Output()
		await output.connect()
		await output.noteOn(60)
		bridge.sendUmp.mockRejectedValue(new Error("Unplugged"))
		await expect(output.disconnect()).rejects.toThrow("Unplugged")
		expect(bridge.closeUmpOutput).toHaveBeenCalledWith(0)
		expect(output.isConnected).toBe(false)
	})
	it("sends to all selected devices/channels and releases the original routes when switching", async () => {
		const { bridge } = setup()
		const output = new Output({ selectedDevice: "", selectedChannel: 0 })
		await output.connect()
		await output.noteOn(60, 127)
		expect(bridge.sendUmp).toHaveBeenCalledTimes(32)
		expect(bridge.sendUmp.mock.calls[31]).toEqual([3, [0x409f3c00, 0xffff0000]])
		await output.selectDevice(3)
		expect(bridge.sendUmp).toHaveBeenCalledTimes(64)
		expect(bridge.sendUmp.mock.calls[63]).toEqual([3, [0x408f3c00, 0]])
		await output.destroy()
		expect(bridge.closeUmpOutput.mock.calls).toEqual([[0], [3]])
	})
	it("fails clearly outside Electron", async () => {
		vi.stubGlobal("window", {})
		await expect(new Input().connect()).rejects.toThrow("Electron desktop app")
		await expect(new Output().connect()).rejects.toThrow("Electron desktop app")
	})
})

describe("Electron MIDI bridge ownership", () => {
	it("shares native ports across windows and releases them on reload/destruction", () => {
		const handlers = new Map<string, Function>()
		const native = {
			openUmpInput: vi.fn(),
			closeUmpInput: vi.fn(),
			openUmpOutput: vi.fn(),
			closeUmpOutput: vi.fn(),
			sendUmp: vi.fn()
		}
		registerMidi2IPC(
			{ handle: (name: string, handler: Function) => handlers.set(name, handler) },
			() => native
		)
		const sender = () =>
			Object.assign(new EventEmitter(), { send: vi.fn(), isDestroyed: () => false })
		const a = sender(),
			b = sender()
		const invoke = (owner: any, method: string, ...args: any[]) =>
			handlers.get("midi2:" + method)!({ sender: owner }, ...args)
		invoke(a, "openUmpInput", 0)
		invoke(b, "openUmpInput", 0)
		expect(native.openUmpInput).toHaveBeenCalledTimes(1)
		native.openUmpInput.mock.calls[0][1](0, [0x20903c7f])
		expect(a.send).toHaveBeenCalledWith("midi2:input", 0, [0x20903c7f], undefined)
		expect(b.send).toHaveBeenCalledTimes(1)
		invoke(a, "closeUmpInput", 0)
		expect(native.closeUmpInput).not.toHaveBeenCalled()
		b.emit("destroyed")
		expect(native.closeUmpInput).toHaveBeenCalledWith(0)
		expect(() => invoke(a, "sendUmp", 0, [0x20903c7f])).toThrow("not open")
		invoke(a, "openUmpOutput", 0)
		invoke(a, "sendUmp", 0, [0x40903c00, 0xffff0000])
		expect(native.sendUmp).toHaveBeenCalledWith(0, [0x40903c00, 0xffff0000])
		expect(() => invoke(a, "sendUmp", 0, [-1])).toThrow("Invalid UMP")
		a.emit("did-start-navigation", {}, "about:blank", false, true)
		expect(native.closeUmpOutput).toHaveBeenCalledWith(0)
	})
	it("reference-counts graph nodes in the sandbox preload and removes event listeners", async () => {
		const ipc = Object.assign(new EventEmitter(), {
			invoke: vi.fn(async () => {}),
			send: vi.fn()
		})
		let api: any
		runInNewContext(
			readFileSync(new URL("../electron/electron-preload.cjs", import.meta.url), "utf8"),
			{
				require: () => ({
					contextBridge: {
						exposeInMainWorld: (_name: string, value: any) => {
							api = value
						}
					},
					ipcRenderer: ipc
				}),
				process: { platform: "win32", env: {} },
				navigator: {}
			}
		)
		await Promise.all([api.midi2.openUmpInput(0), api.midi2.openUmpInput(0)])
		expect(ipc.invoke.mock.calls).toEqual([["midi2:openUmpInput", 0]])
		await api.midi2.closeUmpInput(0)
		expect(ipc.invoke).toHaveBeenCalledTimes(1)
		await api.midi2.closeUmpInput(0)
		expect(ipc.invoke).toHaveBeenLastCalledWith("midi2:closeUmpInput", 0)
		const callback = vi.fn(),
			remove = api.midi2.onUmpInput(callback)
		ipc.emit("midi2:input", {}, 0, [0x20903c7f])
		expect(callback).toHaveBeenCalledWith(0, [0x20903c7f], undefined)
		remove()
		expect(ipc.listenerCount("midi2:input")).toBe(0)
	})
})