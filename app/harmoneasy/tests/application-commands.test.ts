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
			panic
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
	expect(vi.getTimerCount()).toBe(0)
})