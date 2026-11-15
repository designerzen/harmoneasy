// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import InputProtocol from "audiobus/io/inputs/input-protocol"
import { Peer, CommandRegistry, EMPTY_SCHEMA } from "audiobus/io/protocol-registry"
import { INPUT_EVENT, NOTE_ON, NOTE_OFF, CONTROL_CHANGE } from "audiobus/commands/commands"
import { EVENT_MESSAGE } from "audiobus/events/event-constants"

afterEach(() => vi.restoreAllMocks())

it("requires explicit pairing", async () => {
	const input = new InputProtocol()
	await expect(input.connect()).rejects.toThrow("Pair an application")
	expect(() => input.attach(window, "*")).toThrow("exact")
	input.destroy()
})

it("routes MIDI, exposes shared commands and releases notes and sustain on disconnect", async () => {
	const registry = new CommandRegistry()
	registry.register({
		id: "test.name",
		title: "Name",
		description: "",
		inputSchema: EMPTY_SCHEMA,
		execute: () => "Harmoneasy"
	})
	const input = new InputProtocol({ registry })
	const commands: any[] = []
	input.addEventListener(INPUT_EVENT, (event) => commands.push((event as CustomEvent).detail))
	const origin =
		window.location.origin === "null" ? "http://localhost:3000" : window.location.origin
	const listeners = new Set<(message: unknown) => void>()
	const target = {
		postMessage: (message: string) =>
			queueMicrotask(() => listeners.forEach((fn) => fn(message)))
	} as unknown as Window
	const remote = new Peer(
		{
			send: (message) =>
				queueMicrotask(() =>
					window.dispatchEvent(
						new MessageEvent(EVENT_MESSAGE, { data: message, origin, source: target })
					)
				),
			listen: (receive) => {
				listeners.add(receive)
				return () => {
					listeners.delete(receive)
				}
			}
		},
		{ identity: { name: "External application", version: "1" } }
	)
	try {
		input.attach(target, origin)
		await input.connect()
		expect(input.isConnected).toBe(true)
		expect(await remote.call("test.name")).toBe("Harmoneasy")
		remote.sendMidi([0x90, 60, 100])
		remote.sendMidi([0xb0, 64, 127])
		await new Promise<void>((resolve) => queueMicrotask(resolve))
		expect(commands[0].type).toBe(NOTE_ON)
		await input.disconnect()
		expect(commands.map((command) => command.type)).toEqual([
			NOTE_ON,
			CONTROL_CHANGE,
			CONTROL_CHANGE,
			NOTE_OFF
		])
		expect(input.isConnected).toBe(false)
		remote.sendMidi([0x90, 61, 100])
		await new Promise<void>((resolve) => queueMicrotask(resolve))
		expect(commands).toHaveLength(4)
	} finally {
		input.destroy()
		remote.close()
	}
})

it("receives UMP intact, isolates groups, gates SysEx and dispatches grouped releases", async () => {
	const input = new InputProtocol(),
		commands: any[] = []
	input.addEventListener(INPUT_EVENT, (event) => commands.push((event as CustomEvent).detail))
	const origin = "https://paired.example"
	const listeners = new Set<(message: unknown) => void>()
	const target = {
		postMessage: (message: string) =>
			queueMicrotask(() => listeners.forEach((fn) => fn(message)))
	} as unknown as Window
	const remote = new Peer(
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
		{ identity: { name: "UMP source", version: "1" }, ump: true }
	)
	try {
		input.attach(target, origin)
		await input.connect()
		for (const words of [
			[0x43913c00, 0xabcd1234],
			[0x44913c00, 0x12340000],
			[0x43013c01, 0xdeadbeef],
			[0x43b14000, 0xffffffff],
			[0x33000000, 0],
			[0x53000000, 0, 0, 0]
		]) {
			remote.sendUmp(words)
		}
		await new Promise<void>((resolve) => queueMicrotask(resolve))
		expect(commands).toHaveLength(4)
		expect(commands[0].ump).toEqual([0x43913c00, 0xabcd1234])
		expect(commands[0].midiGroup).toBe(3)
		expect(commands[2].ump).toEqual([0x43013c01, 0xdeadbeef])
		await input.disconnect()
		expect(commands.slice(4).map((command) => command.ump)).toEqual([
			[0x43b14000, 0],
			[0x43813c00, 0],
			[0x44813c00, 0]
		])
	} finally {
		input.destroy()
		remote.close()
	}
})