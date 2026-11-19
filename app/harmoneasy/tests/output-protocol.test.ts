// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import OutputProtocol from "audiobus/io/outputs/output-protocol"
import InputProtocol from "audiobus/io/inputs/input-protocol"
import { Peer, CommandRegistry, EMPTY_SCHEMA } from "audiobus/io/protocol-registry"
import {
	NOTE_ON,
	NOTE_OFF,
	CONTROL_CHANGE,
	PITCH_BEND,
	PROGRAM_CHANGE,
	MIDI_CLOCK,
	MIDI_START,
	MIDI_CONTINUE,
	MIDI_STOP
} from "audiobus/commands/commands"
import { MIDI_MESSAGE } from "audiobus/midi/midi-command-conversion"
import {
	EVENT_CONNECTION_CHANGED,
	EVENT_PROTOCOL_EVENT,
	EVENT_PROTOCOL_PATCH,
	EVENT_CHANGE,
	EVENT_INPUT,
	EVENT_SUBMIT,
	EVENT_MESSAGE
} from "audiobus/events/event-constants"
import { musicalCommand } from "audiobus/io/event-clip"
import { umpToCommand } from "audiobus/midi/ump-codec"

const flush = async () => {
	await new Promise<void>((resolve) => setTimeout(resolve, 0))
}
const cleanups: (() => void)[] = []
afterEach(() => {
	cleanups.splice(0).forEach((clean) => clean())
	document.body.replaceChildren()
	vi.restoreAllMocks()
})

function pair(options: Record<string, any> = {}, ump = false, remoteOptions = {}) {
	const listeners = [new Set<(message: unknown) => void>(), new Set<(message: unknown) => void>()]
	const frames: string[] = []
	const transport = (index: number) => ({
		send: (message: string) => {
			if (index === 0) {
				frames.push(message)
			}
			queueMicrotask(() => listeners[1 - index].forEach((receive) => receive(message)))
		},
		listen: (receive: (message: unknown) => void) => {
			listeners[index].add(receive)
			return () => {
				listeners[index].delete(receive)
			}
		}
	})
	const registry = new CommandRegistry(),
		bytes: number[][] = []
	const words: number[][] = []
	let patch = "initial-patch"
	const remote = new Peer(transport(1), {
		identity: { name: "Destination", version: "1" },
		registry,
		ump,
		onUmp: (data) => words.push(data),
		onMidi: (data) => bytes.push([...data]),
		getPatch: () => patch,
		setPatch: (value) => {
			patch = value
		},
		...remoteOptions
	})
	const output = new OutputProtocol(options)
	output.attachTransport(transport(0))
	cleanups.push(() => {
		output.destroy()
		remote.close()
	})
	return { output, remote, registry, bytes, words, frames, listeners, getPatch: () => patch }
}

it("requires pairing and registers connection transitions", async () => {
	const output = new OutputProtocol()
	await expect(output.connect()).rejects.toThrow("Pair a destination")
	expect(() => output.attach(window, "*")).toThrow("exact")
	output.destroy()
	const p = pair(),
		changes = vi.fn()
	p.output.addEventListener(EVENT_CONNECTION_CHANGED, changes)
	await Promise.all([p.output.connect(), p.output.connect()])
	expect(p.output.isConnected).toBe(true)
	expect(
		p.frames.filter(
			(frame) =>
				frame.startsWith("control,request,") &&
				decodeURIComponent(frame).includes('"initialize"')
		)
	).toHaveLength(1)
	await p.output.disconnect()
	expect(changes).toHaveBeenCalledTimes(2)
	expect(p.listeners[0].size).toBe(0)
})

it("sends transformed MIDI with channels, controllers, bend, pressure and system bytes", async () => {
	const p = pair()
	await p.output.connect()
	for (const command of [
		{ type: NOTE_ON, number: 62, velocity: 90, channel: 3, raw: [0x90, 60, 100] },
		{ type: CONTROL_CHANGE, number: 7, value: 80, channel: 3 },
		{ type: PITCH_BEND, value: 16383, channel: 3 },
		{ type: PROGRAM_CHANGE, number: 0, value: 12, channel: 3 },
		{ type: "channelPressure", value: 60, channel: 3 },
		{ type: MIDI_CLOCK },
		{ type: MIDI_START },
		{ type: MIDI_CONTINUE },
		{ type: MIDI_STOP },
		{ type: NOTE_OFF, number: 62, velocity: 0, channel: 3 }
	]) {
		p.output.sendCommand(musicalCommand(command))
	}
	await flush()
	expect(p.bytes).toEqual([
		[0x92, 62, 90],
		[0xb2, 7, 80],
		[0xe2, 127, 127],
		[0xc2, 12],
		[0xd2, 60],
		[0xf8],
		[0xfa],
		[0xfb],
		[0xfc],
		[0x82, 62, 0]
	])
})

it("releases sustained and held notes before disconnect and sends nothing afterward", async () => {
	const p = pair()
	await p.output.connect()
	p.output.noteOn(60, 100, 2)
	p.output.sendCommand(
		musicalCommand({ type: CONTROL_CHANGE, number: 64, value: 127, channel: 2 })
	)
	await p.output.disconnect()
	p.output.noteOn(70)
	await flush()
	expect(p.bytes).toEqual([
		[0x91, 60, 100],
		[0xb1, 64, 127],
		[0xb1, 64, 0],
		[0x81, 60, 0]
	])
	expect(p.output.isConnected).toBe(false)
})

it("gates SysEx and supports legacy WebMidiLink without a control handshake", async () => {
	const p = pair({ mode: "webmidilink" })
	await p.output.connect()
	p.output.noteOn(60)
	p.output.sendCommand(musicalCommand({ type: MIDI_MESSAGE, raw: [0xf0, 1, 2, 0xf7] }))
	await flush()
	expect(p.frames).toEqual(["midi,90,3c,7f"])
	await expect(p.output.discover()).rejects.toMatchObject({ code: "unavailable" })
	p.output.options.allowSysex = true
	p.output.sendCommand(musicalCommand({ type: MIDI_MESSAGE, raw: [0xf0, 1, 2, 0xf7] }))
	const patches: string[] = []
	p.output.addEventListener(EVENT_PROTOCOL_PATCH, (event) =>
		patches.push((event as CustomEvent).detail)
	)
	p.output.requestPatch()
	p.output.setPatch("new-patch")
	await flush()
	expect(patches).toEqual(["initial-patch"])
	expect(p.getPatch()).toBe("new-patch")
	expect(p.bytes).toContainEqual([0xf0, 1, 2, 0xf7])
})

it("discovers destination commands, invokes both ways and forwards subscribed events", async () => {
	const local = new CommandRegistry(),
		p = pair({ registry: local })
	local.register({
		id: "local.name",
		title: "Name",
		description: "",
		inputSchema: EMPTY_SCHEMA,
		execute: () => "Harmoneasy"
	})
	p.registry.register({
		id: "destination.name",
		title: "Name",
		description: "",
		inputSchema: EMPTY_SCHEMA,
		execute: () => "Destination"
	})
	await p.output.connect()
	expect((await p.output.discover())[0].id).toBe("destination.name")
	expect(await p.output.call("destination.name")).toBe("Destination")
	expect(await p.remote.call("local.name")).toBe("Harmoneasy")
	const events: unknown[] = []
	p.output.addEventListener(EVENT_PROTOCOL_EVENT, (event) =>
		events.push((event as CustomEvent).detail)
	)
	await p.output.subscribe("transport.changed")
	p.registry.publish("transport.changed", { bpm: 128 })
	await flush()
	expect(events).toContainEqual({ topic: "transport.changed", data: { bpm: 128 } })
})

it("renders destination argument forms and refreshes commands after remote registration", async () => {
	const p = pair()
	let bpm = 120
	p.registry.register({
		id: "transport.setTempo",
		title: "Set destination tempo",
		description: "BPM",
		inputSchema: {
			type: "object",
			properties: { bpm: { type: "number", minimum: 10, maximum: 303 } },
			required: ["bpm"],
			additionalProperties: false
		},
		execute: (args) => {
			bpm = args.bpm as number
			return { bpm }
		}
	})
	const panel = await p.output.createGui()
	document.body.append(panel)
	await p.output.connect()
	const select = panel.querySelector<HTMLSelectElement>('[aria-label="Destination command"]')!
	expect(select.options[0].text).toBe("Set destination tempo")
	const input = panel.querySelector<HTMLInputElement>('form input[type="number"]')!
	input.value = "128"
	panel.querySelector("form")!.dispatchEvent(new Event(EVENT_SUBMIT, { cancelable: true }))
	await flush()
	expect(bpm).toBe(128)
	p.registry.register({
		id: "new.command",
		title: "New command",
		description: "",
		inputSchema: EMPTY_SCHEMA,
		execute: () => null
	})
	await flush()
	expect([...select.options].map((option) => option.value)).toContain("new.command")
	await p.output.disconnect()
	expect(select.disabled).toBe(true)
	expect(panel.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true)
	select.dispatchEvent(new Event(EVENT_CHANGE))
})

it("cleans up a handshake timeout", async () => {
	const p = pair({ timeoutMs: 10 })
	p.remote.close()
	await expect(p.output.connect()).rejects.toMatchObject({ code: "timeout" })
	expect(p.output.isConnected).toBe(false)
	expect(p.listeners[0].size).toBe(0)
	await expect(p.output.call("missing")).rejects.toMatchObject({ code: "not_initialized" })
})

it("balances retriggers and velocity-zero releases without leaving held notes", async () => {
	const p = pair()
	await p.output.connect()
	p.output.noteOn(60, 100)
	p.output.noteOn(60, 90)
	p.output.noteOn(60, 0)
	await p.output.disconnect()
	await flush()
	expect(p.bytes).toEqual([
		[0x90, 60, 100],
		[0x80, 60, 0],
		[0x90, 60, 90],
		[0x90, 60, 0]
	])
})

it("cancels an in-flight handshake when disconnected and removes its listener", async () => {
	const p = pair()
	p.remote.close()
	const connecting = p.output.connect()
	await p.output.disconnect()
	await expect(connecting).rejects.toMatchObject({ code: "closed" })
	expect(p.listeners[0].size).toBe(0)
	expect(p.output.isConnected).toBe(false)
})

it("preserves MIDI 2 precision, per-note data and independent groups through note cleanup", async () => {
	const p = pair({}, true)
	await p.output.connect()
	const note = [0x43913c00, 0xabcd1234]
	const otherGroup = [0x44913c00, 0x12340000]
	const expression = [0x43013c01, 0xdeadbeef]
	for (const words of [note, otherGroup, expression, [0x43b14000, 0xffffffff]]) {
		p.output.sendCommand(umpToCommand(words, 1, "test")!)
	}
	expect(p.output.getNoteKey(umpToCommand(note, 1, "test")!)).not.toBe(
		p.output.getNoteKey(umpToCommand(otherGroup, 1, "test")!)
	)
	await p.output.disconnect()
	await flush()
	expect(p.words.slice(0, 4)).toEqual([note, otherGroup, expression, [0x43b14000, 0xffffffff]])
	expect(p.words.slice(4)).toEqual([
		[0x43b14000, 0],
		[0x43813c00, 0],
		[0x44813c00, 0]
	])
	expect(p.bytes).toEqual([])
})

it("requires opt-in for MIDI 1 fallback and refuses to merge groups or drop per-note messages", async () => {
	const p = pair()
	await p.output.connect()
	const note = umpToCommand([0x40903c00, 0xabcd0000], 0, "test")!
	expect(() => p.output.sendCommand(note)).toThrow("MIDI 1 conversion")
	p.output.options.allowMidi1Fallback = true
	p.output.sendCommand(note)
	await flush()
	expect(p.bytes[0]).toEqual([0x90, 60, 85])
	expect(() => p.output.sendCommand(umpToCommand([0x41903c00, 0xabcd0000], 0, "test")!)).toThrow()
	expect(() => p.output.sendCommand(umpToCommand([0x40003c01, 0x12345678], 0, "test")!)).toThrow()
})

it("preserves transformed channels and groups without reducing untouched high-resolution values", async () => {
	const p = pair({}, true)
	await p.output.connect()
	const command = umpToCommand([0x40903c00, 0xabcd1234], 0, "test")!
	command.channel = 5
	command.midiGroup = 6
	command.number = 64
	p.output.sendCommand(command)
	await flush()
	expect(p.words[0]).toEqual([0x46944000, 0xabcd1234])
})

it("edits discovered properties with units and reflects remote changes", async () => {
	const p = pair()
	let bpm = 120,
		writable = true
	p.registry.registerProperty({
		id: "transport.tempo",
		title: "Tempo",
		description: "BPM",
		unit: "BPM",
		schema: { type: "number", minimum: 10, maximum: 303 },
		get: () => bpm,
		set: (value) => {
			bpm = value as number
		},
		writable: () => writable
	})
	const panel = await p.output.createGui()
	document.body.append(panel)
	await p.output.connect()
	await flush()
	const select = panel.querySelector<HTMLSelectElement>('[aria-label="Destination property"]')!
	expect(select.value).toBe("transport.tempo")
	const editor = panel.querySelector<HTMLInputElement>('fieldset input[type="number"]')!
	expect(editor.value).toBe("120")
	expect(editor.closest("label")!.textContent).toContain("BPM")
	editor.value = "128"
	const apply = [...panel.querySelectorAll<HTMLButtonElement>("button")].find(
		(button) => button.textContent === "Apply property"
	)!
	apply.click()
	await flush()
	expect(bpm).toBe(128)
	bpm = 140
	await p.registry.notifyProperty("transport.tempo")
	await flush()
	expect(panel.querySelector("fieldset output")!.textContent).toContain("140 BPM")
	writable = false
	p.registry.publish("properties.listChanged", null)
	await flush()
	await flush()
	expect(panel.querySelector<HTMLInputElement>("fieldset input")!.disabled).toBe(true)
	let label = "Named"
	p.registry.registerProperty({
		id: "device.label",
		title: "Device label",
		description: "",
		schema: { type: "string" },
		get: () => label,
		set: (value) => {
			label = value as string
		}
	})
	await flush()
	await flush()
	select.value = "device.label"
	select.dispatchEvent(new Event(EVENT_CHANGE))
	await flush()
	panel.querySelector<HTMLInputElement>('fieldset input[type="text"]')!.value = ""
	apply.click()
	await flush()
	expect(label).toBe("")
	await p.output.disconnect()
	expect(panel.querySelector<HTMLFieldSetElement>("fieldset")!.hidden).toBe(true)
})

it("treats MIDI 2 zero-velocity Note On as a held note and preserves transformed MIDI 1 UMP", async () => {
	const p = pair({}, true)
	await p.output.connect()
	p.output.sendCommand(umpToCommand([0x40903c00, 0], 0, "test")!)
	const legacyUmp = umpToCommand([0x23923d64], 0, "test")!
	legacyUmp.number = 64
	legacyUmp.velocity = 80
	legacyUmp.channel = 5
	p.output.sendCommand(legacyUmp)
	await p.output.disconnect()
	await flush()
	expect(p.words).toEqual([[0x40903c00, 0], [0x23944050], [0x40803c00, 0], [0x23844000]])
})
it("presents a destination's pairing code without saving it", async () => {
	const p = pair({}, false, { requirePairingCode: "ABCD2345" })
	await expect(p.output.connect()).rejects.toMatchObject({ code: "unauthorized" })
	expect(p.output.isConnected).toBe(false)
	const panel = await p.output.createGui()
	const code = panel.querySelector<HTMLInputElement>('input[placeholder="ABCD-EFGH"]')!
	code.value = "abcd-2345"
	code.dispatchEvent(new Event(EVENT_INPUT))
	await p.output.connect()
	expect(p.output.isConnected).toBe(true)
	expect(p.remote.isAuthorized).toBe(true)
	expect(JSON.stringify(p.output.options)).not.toMatch(/ABCD|abcd/)
})

it("subscribes to retained destination state atomically", async () => {
	const p = pair()
	let bpm = 120
	p.registry.retain("transport.changed", () => ({ bpm }))
	const events: unknown[] = []
	p.output.addEventListener(EVENT_PROTOCOL_EVENT, (event) =>
		events.push((event as CustomEvent).detail)
	)
	await p.output.connect()
	expect(await p.output.subscribeState("transport.changed")).toEqual({
		retained: true,
		state: { bpm: 120 }
	})
	bpm = 128
	p.registry.publish("transport.changed", { bpm })
	await flush()
	expect(events).toEqual([{ topic: "transport.changed", data: { bpm: 128 } }])
	expect(await p.output.subscribeState("other.topic")).toEqual({ retained: false })
})

it("keeps a property read answered after an older change event", async () => {
	const p = pair()
	let bpm = 120
	p.registry.registerProperty({
		id: "transport.tempo",
		title: "Tempo",
		description: "BPM",
		unit: "BPM",
		schema: { type: "number", minimum: 10, maximum: 303 },
		get: () => bpm,
		set: (value) => {
			bpm = value as number
		}
	})
	const panel = await p.output.createGui()
	document.body.append(panel)
	await p.output.connect()
	await flush()
	const read = [...panel.querySelectorAll<HTMLButtonElement>("button")].find(
		(button) => button.textContent === "Read property"
	)!
	// The read request is sent first; an event published before it executes arrives before
	// its response and carries an older value.
	read.click()
	p.registry.publish("properties.changed", { id: "transport.tempo", value: 130 })
	bpm = 140
	await flush()
	await flush()
	expect(panel.querySelector("fieldset output")!.textContent).toContain("140 BPM")
})
it("refuses a pairing code in legacy WebMidiLink mode instead of dropping MIDI silently", async () => {
	const p = pair({ mode: "webmidilink" })
	p.output.setPairingCode("ABCD-2345")
	await expect(p.output.connect()).rejects.toThrow("audioBus Protocol mode")
	expect(p.output.isConnected).toBe(false)
	p.output.setPairingCode("")
	await p.output.connect()
	expect(p.output.isConnected).toBe(true)
})

it("also sends MIDI to applications connected without pairing when enabled", async () => {
	const input = new InputProtocol()
	const origin = "https://controller.example"
	const listeners = new Set<(message: unknown) => void>()
	const target = {
		postMessage: (message: string) =>
			queueMicrotask(() => listeners.forEach((receive) => receive(message)))
	} as unknown as Window
	const received: number[][] = []
	const controller = new Peer(
		{
			send: (message) =>
				queueMicrotask(() =>
					window.dispatchEvent(
						new MessageEvent(EVENT_MESSAGE, { data: message, source: target, origin })
					)
				),
			listen: (receive) => {
				listeners.add(receive)
				return () => {
					listeners.delete(receive)
				}
			}
		},
		{
			identity: { name: "Controller", version: "1" },
			onMidi: (data) => received.push([...data])
		}
	)
	const silent = new OutputProtocol()
	const output = new OutputProtocol({ sendToConnectedApplications: true })
	cleanups.push(() => {
		silent.destroy()
		output.destroy()
		controller.close()
		input.destroy()
	})
	await controller.connect()
	silent.noteOn(61, 100, 1)
	output.noteOn(60, 100, 2)
	await flush()
	expect(output.isConnected).toBe(false)
	expect(received).toEqual([[0x91, 60, 100]])
	output.destroy()
	await flush()
	expect(received).toEqual([
		[0x91, 60, 100],
		[0x81, 60, 0]
	])
})