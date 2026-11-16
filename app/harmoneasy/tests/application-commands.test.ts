import { afterEach, expect, it, vi } from "vitest"
import { CommandRegistry } from "audiobus/io/protocol-registry"
import { registerApplicationCommands } from "../source/services/application-commands"

afterEach(() => vi.useRealTimers())

it("shares transport handlers, validates tempo, observes local changes and unregisters", async () => {
	vi.useFakeTimers()
	const registry = new CommandRegistry()
	let bpm = 120,
		running = false,
		internal = true
	const panic = vi.fn()
	const events: string[] = []
	registry.observe((topic) => events.push(topic))
	const remove = registerApplicationCommands(
		{
			getTransport: () => ({ bpm, running, clockSource: internal ? "internal" : "midi" }),
			canSetTempo: () => internal,
			setTempo: (value) => {
				bpm = value
			},
			transport: async (action) => {
				running = action === "start"
			},
			panic,
			presets: async () => [],
			loadPreset: async () => {}
		},
		registry
	)
	expect(await registry.call("transport.setTempo", { bpm: 130 })).toEqual({
		bpm: 130,
		running: false,
		clockSource: "internal"
	})
	await expect(registry.call("transport.setTempo", { bpm: 999 })).rejects.toMatchObject({
		code: "invalid_params"
	})
	expect(bpm).toBe(130)
	expect(
		registry.listProperties().find((property) => property.id === "transport.tempo")?.unit
	).toBe("BPM")
	expect(await registry.getProperty("transport.tempo")).toBe(130)
	await registry.setProperty("transport.tempo", 135)
	expect(bpm).toBe(135)
	expect(registry.listBundles()[0].id).toBe("org.audiobus.transport")
	await registry.call("transport.start")
	expect(running).toBe(true)
	await registry.call("transport.stop")
	expect(running).toBe(false)
	await registry.call("app.panic")
	expect(panic).toHaveBeenCalledOnce()
	expect(registry.readRetained("transport.changed")).toEqual({
		value: { bpm: 135, running: false, clockSource: "internal" }
	})
	internal = false
	await vi.advanceTimersByTimeAsync(100)
	expect(events).toContain("transport.changed")
	expect(registry.list().find((command) => command.id === "transport.setTempo")?.available).toBe(
		false
	)
	await expect(registry.call("transport.setTempo", { bpm: 120 })).rejects.toMatchObject({
		code: "unavailable"
	})
	await expect(registry.call("transport.start")).rejects.toMatchObject({ code: "unavailable" })
	await expect(registry.setProperty("transport.tempo", 140)).rejects.toMatchObject({
		code: "read_only"
	})
	remove()
	expect(registry.list()).toEqual([])
	expect(registry.listProperties()).toEqual([])
	expect(registry.listBundles()).toEqual([])
	expect(registry.readRetained("transport.changed")).toBeUndefined()
	expect(vi.getTimerCount()).toBe(0)
})

it("lists and loads published presets, replying before the workspace is replaced", async () => {
	vi.useFakeTimers()
	const registry = new CommandRegistry()
	const loadPreset = vi.fn(async () => {})
	const presets = [
		{
			id: "protocol-step-song",
			name: "audioBus Protocol — Step through a song",
			category: "audioBus Protocol",
			description: "Step through a song",
			remote: true
		},
		{ id: "ode-to-joy", name: "Ode to Joy", category: "Songs", description: "", remote: false }
	]
	const remove = registerApplicationCommands(
		{
			getTransport: () => ({ bpm: 120, running: false, clockSource: "internal" }),
			canSetTempo: () => true,
			setTempo: () => {},
			transport: async () => {},
			panic: () => {},
			presets: async () => presets,
			loadPreset
		},
		registry
	)
	expect(await registry.call("presets.list")).toEqual(presets)
	expect(await registry.call("presets.list", { query: "protocol STEP" })).toEqual([presets[0]])
	await expect(registry.call("presets.load", { id: "missing" })).rejects.toMatchObject({
		code: "invalid_params"
	})
	expect(await registry.call("presets.load", { id: "ode-to-joy" })).toEqual(presets[1])
	expect(loadPreset).not.toHaveBeenCalled()
	await vi.advanceTimersByTimeAsync(0)
	expect(loadPreset).toHaveBeenCalledWith("ode-to-joy")
	remove()
	expect(registry.list().some((command) => command.id.startsWith("presets."))).toBe(false)
})
