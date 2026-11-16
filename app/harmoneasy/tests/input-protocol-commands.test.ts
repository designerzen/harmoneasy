// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest"
import InputProtocol, { MAX_UNPAIRED_PEERS } from "audiobus/io/inputs/input-protocol"
import { Peer, CommandRegistry, EMPTY_SCHEMA } from "audiobus/io/protocol-registry"
import {
	INPUT_EVENT,
	NOTE_ON,
	NOTE_OFF,
	PITCH_BEND,
	CONTROL_CHANGE,
	PROGRAM_CHANGE
} from "audiobus/commands/commands"
import { POLYPHONIC_PRESSURE, CHANNEL_PRESSURE } from "audiobus/midi/midi-command-conversion"
import { EVENT_MESSAGE } from "audiobus/events/event-constants"

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((clean) => clean()))

/**
 * A remote window whose messages reach this window with the given origin. Pass `window` to reuse
 * one sending window, for example after it navigates to another origin.
 */
function remoteWindow(
	origin: string,
	timeoutMs?: number,
	existing?: { source: Window; listeners: Set<(message: unknown) => void> }
) {
	const listeners = existing?.listeners ?? new Set<(message: unknown) => void>()
	const source =
		existing?.source ??
		({
			closed: false,
			postMessage: (message: string) =>
				queueMicrotask(() => listeners.forEach((fn) => fn(message)))
		} as unknown as Window)
	const peer = new Peer(
		{
			send: (message) =>
				queueMicrotask(() =>
					window.dispatchEvent(
						new MessageEvent(EVENT_MESSAGE, { data: message, origin, source })
					)
				),
			listen: (receive) => {
				listeners.add(receive)
				return () => {
					listeners.delete(receive)
				}
			}
		},
		{ identity: { name: "Controller", version: "1" }, timeoutMs }
	)
	cleanups.push(() => peer.close())
	return { source, peer, listeners }
}

function createInput(options: Record<string, any> = {}) {
	const registry = new CommandRegistry()
	registry.register({
		id: "app.name",
		title: "Name",
		description: "",
		inputSchema: EMPTY_SCHEMA,
		execute: () => "Harmoneasy"
	})
	const input = new InputProtocol({ registry, ...options })
	const commands: any[] = []
	input.addEventListener(INPUT_EVENT, (event) => commands.push((event as CustomEvent).detail))
	cleanups.push(() => input.destroy())
	return { input, commands }
}

it("offers discoverable MIDI commands alongside application commands and plays them into its chain", async () => {
	const { input, commands } = createInput()
	const remote = remoteWindow("https://paired.example")
	input.attach(remote.source, "https://paired.example")
	await input.connect()
	const ids = (await remote.peer.discover()).map((command) => command.id)
	expect(ids).toEqual(
		expect.arrayContaining([
			"app.name",
			"midi.noteOn",
			"midi.noteOff",
			"midi.polyAftertouch",
			"midi.channelAftertouch",
			"midi.pitchBend",
			"midi.controlChange",
			"midi.programChange",
			"midi.allNotesOff"
		])
	)
	expect((await remote.peer.listBundles()).map((bundle) => bundle.id)).toContain(
		"org.audiobus.midi"
	)
	expect(await remote.peer.call("app.name")).toBe("Harmoneasy")
	await remote.peer.call("midi.noteOn", { note: 60, velocity: 90, channel: 2 })
	await remote.peer.call("midi.polyAftertouch", { note: 60, pressure: 70, channel: 2 })
	await remote.peer.call("midi.channelAftertouch", { pressure: 40, channel: 2 })
	await remote.peer.call("midi.pitchBend", { value: 8191, channel: 2 })
	await remote.peer.call("midi.controlChange", { controller: 1, value: 64 })
	await remote.peer.call("midi.programChange", { program: 5 })
	await remote.peer.call("midi.noteOff", { note: 60, channel: 2 })
	await expect(remote.peer.call("midi.noteOn", { note: 128 })).rejects.toMatchObject({
		code: "invalid_params"
	})
	expect(commands.map((command) => command.type)).toEqual([
		NOTE_ON,
		POLYPHONIC_PRESSURE,
		CHANNEL_PRESSURE,
		PITCH_BEND,
		CONTROL_CHANGE,
		PROGRAM_CHANGE,
		NOTE_OFF
	])
	expect(commands[0]).toMatchObject({ number: 60, velocity: 90, channel: 2 })
	// A held note started by a command is released on disconnect, like WebMidiLink MIDI.
	await remote.peer.call("midi.noteOn", { note: 64 })
	await input.disconnect()
	expect(commands.at(-1)).toMatchObject({ type: NOTE_OFF, number: 64 })
})

it("ignores unpaired windows unless unpaired control is accepted", async () => {
	const { input } = createInput({ acceptUnpaired: false })
	await expect(input.connect()).rejects.toThrow("Pair an application")
	const remote = remoteWindow("https://anyone.example", 30)
	await expect(remote.peer.connect()).rejects.toMatchObject({ code: "timeout" })
	expect(input.unpairedConnections).toHaveLength(0)
})

it("accepts control from any window when unpaired control is enabled, one session per window", async () => {
	const { input, commands } = createInput({ acceptUnpaired: true })
	await input.connect()
	expect(input.isConnected).toBe(true)
	const first = remoteWindow("https://one.example")
	const second = remoteWindow("https://two.example")
	await first.peer.connect()
	await second.peer.connect()
	expect(input.unpairedConnections).toHaveLength(2)
	expect(await second.peer.call("app.name")).toBe("Harmoneasy")
	await first.peer.call("midi.noteOn", { note: 62 })
	first.peer.sendMidi([0x90, 67, 100])
	await settle()
	expect(commands.map((command) => command.number)).toEqual([62, 67])
	// Opaque origins cannot be answered without broadcasting, so they are ignored.
	window.dispatchEvent(
		new MessageEvent(EVENT_MESSAGE, {
			data: "midi,90,40,64",
			origin: "null",
			source: {} as Window
		})
	)
	await settle()
	expect(commands).toHaveLength(2)
	expect(input.unpairedConnections).toHaveLength(2)
	await input.disconnect()
	expect(input.unpairedConnections).toHaveLength(0)
	expect(commands.slice(2).map((command) => [command.type, command.number])).toEqual(
		expect.arrayContaining([
			[NOTE_OFF, 62],
			[NOTE_OFF, 67]
		])
	)
	first.peer.sendMidi([0x90, 69, 100])
	await settle()
	expect(commands.some((command) => command.number === 69)).toBe(false)
})

it("limits how many unpaired windows may connect", async () => {
	const { input } = createInput({ acceptUnpaired: true })
	await input.connect()
	const remotes = Array.from({ length: MAX_UNPAIRED_PEERS + 1 }, (_, index) =>
		remoteWindow(`https://window-${index}.example`, 30)
	)
	const results = await Promise.allSettled(remotes.map((remote) => remote.peer.connect()))
	expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
		MAX_UNPAIRED_PEERS
	)
	expect(input.unpairedConnections).toHaveLength(MAX_UNPAIRED_PEERS)
})
it("starts a fresh session when a window navigates, releasing only that session's notes", async () => {
	const { input, commands } = createInput({ acceptUnpaired: true })
	await input.connect()
	const before = remoteWindow("https://before.example")
	const other = remoteWindow("https://other.example")
	await before.peer.connect()
	await other.peer.connect()
	await before.peer.call("midi.noteOn", { note: 60 })
	other.peer.sendMidi([0x90, 72, 100])
	await settle()
	before.peer.close()
	const after = remoteWindow("https://after.example", undefined, before)
	await after.peer.connect()
	expect(input.unpairedConnections).toHaveLength(2)
	const released = commands.slice(2)
	expect(released.map((command) => [command.type, command.number])).toEqual([[NOTE_OFF, 60]])
	expect(await after.peer.call("app.name")).toBe("Harmoneasy")
})

it("frees the slots of closed windows before applying the limit", async () => {
	const { input } = createInput({ acceptUnpaired: true })
	await input.connect()
	const remotes = Array.from({ length: MAX_UNPAIRED_PEERS }, (_, index) =>
		remoteWindow(`https://window-${index}.example`)
	)
	await Promise.all(remotes.map((remote) => remote.peer.connect()))
	;(remotes[0].source as { closed: boolean }).closed = true
	const late = remoteWindow("https://late.example", 50)
	await late.peer.connect()
	expect(input.unpairedConnections).toHaveLength(MAX_UNPAIRED_PEERS)
})

it("cancels the settings reconnect when the input is destroyed first", async () => {
	const { input } = createInput({ acceptUnpaired: true })
	const paired = remoteWindow("https://paired.example")
	input.attach(paired.source, "https://paired.example")
	await input.connect()
	const panel = await input.createGui()
	const checkbox = panel.querySelector<HTMLInputElement>('input[type="checkbox"]')!
	checkbox.checked = false
	checkbox.dispatchEvent(new Event("change"))
	input.destroy()
	await settle()
	await settle()
	expect(input.isConnected).toBe(false)
	const stranger = remoteWindow("https://stranger.example", 30)
	await expect(stranger.peer.connect()).rejects.toMatchObject({ code: "timeout" })
	expect(input.unpairedConnections).toHaveLength(0)
})
it("shares unpaired sessions between Inputs so each application command executes once", async () => {
	const registry = new CommandRegistry()
	let executed = 0
	registry.register({
		id: "app.count",
		title: "Count",
		description: "",
		inputSchema: EMPTY_SCHEMA,
		execute: () => ++executed
	})
	const first = createInput({ registry, acceptUnpaired: true })
	const second = createInput({ registry, acceptUnpaired: true })
	await first.input.connect()
	await second.input.connect()
	const remote = remoteWindow("https://shared.example")
	await remote.peer.connect()
	expect(await remote.peer.call("app.count")).toBe(1)
	expect(executed).toBe(1)
	expect(first.input.unpairedConnections).toHaveLength(1)
	expect(second.input.unpairedConnections).toHaveLength(1)
	// MIDI plays into every Input's chain, and each releases its own copy of the note.
	await remote.peer.call("midi.noteOn", { note: 61 })
	expect(first.commands.map((command) => command.number)).toEqual([61])
	expect(second.commands.map((command) => command.number)).toEqual([61])
	await first.input.disconnect()
	expect(first.commands.at(-1)).toMatchObject({ type: NOTE_OFF, number: 61 })
	expect(second.commands).toHaveLength(1)
	// The session outlives the first Input while another still accepts it.
	expect(await remote.peer.call("app.count")).toBe(2)
	await second.input.disconnect()
	expect(second.commands.at(-1)).toMatchObject({ type: NOTE_OFF, number: 61 })
})

it("malformed traffic takes no session slot; closing the sender releases its notes", async () => {
	const { input, commands } = createInput({ acceptUnpaired: true })
	await input.connect()
	for (let index = 0; index < MAX_UNPAIRED_PEERS; index++) {
		window.dispatchEvent(
			new MessageEvent(EVENT_MESSAGE, {
				data: "control,request,%bad",
				origin: `https://junk-${index}.example`,
				source: { closed: false } as Window
			})
		)
		window.dispatchEvent(
			new MessageEvent(EVENT_MESSAGE, {
				data: `midi,invalid`,
				origin: `https://midi-${index}.example`,
				source: { closed: false } as Window
			})
		)
	}
	await settle()
	expect(input.unpairedConnections).toHaveLength(0)
	expect(commands).toHaveLength(0)
	const remote = remoteWindow("https://real.example")
	await remote.peer.connect()
	await remote.peer.call("midi.noteOn", { note: 65 })
	remote.peer.close()
	await settle()
	expect(input.unpairedConnections).toHaveLength(0)
	expect(commands.map((command) => [command.type, command.number])).toEqual([
		[NOTE_ON, 65],
		[NOTE_OFF, 65]
	])
})
it("listens by default and receives legacy MIDI without a handshake", async () => {
	const { input, commands } = createInput()
	expect(input.isConnected).toBe(true)
	expect(input.requiresConnectionControl).toBe(false)
	const panel = await input.createGui()
	expect(panel.querySelector("details")?.open).toBe(false)
	expect(panel.querySelector<HTMLInputElement>('input[type="url"]')?.closest("div")?.hidden).toBe(
		true
	)
	const source = { postMessage: () => {}, closed: false } as unknown as Window
	window.dispatchEvent(
		new MessageEvent(EVENT_MESSAGE, {
			data: "midi,90,3c,64",
			origin: "https://legacy.example",
			source
		})
	)
	await settle()
	expect(commands[0]).toMatchObject({ type: NOTE_ON, number: 60 })
	await input.disconnect()
	expect(commands.at(-1)).toMatchObject({ type: NOTE_OFF, number: 60 })
})
it("applies optional pairing and resumes open listening from advanced settings", async () => {
	const { input } = createInput()
	const panel = await input.createGui()
	const checkbox = panel.querySelector<HTMLInputElement>('input[type="checkbox"]')!
	checkbox.checked = false
	checkbox.dispatchEvent(new Event("change"))
	await settle()
	expect(input.isConnected).toBe(false)
	const stranger = remoteWindow("https://optional.example", 30)
	await expect(stranger.peer.connect()).rejects.toMatchObject({ code: "timeout" })
	checkbox.checked = true
	checkbox.dispatchEvent(new Event("change"))
	await settle()
	expect(input.isConnected).toBe(true)
	await stranger.peer.connect()
	expect(await stranger.peer.call("app.name")).toBe("Harmoneasy")
})

it("allows programmatic lifecycle control without automatic listening", async () => {
	const { input } = createInput({ autoConnect: false })
	expect(input.isConnected).toBe(false)
	await input.connect()
	expect(input.isConnected).toBe(true)
})