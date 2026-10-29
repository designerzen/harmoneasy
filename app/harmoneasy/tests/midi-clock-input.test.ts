import { describe, expect, it, vi } from "vitest"
import InputMIDITransportClock from "../../../packages/audiobus/io/inputs/input-midi-transport-clock"
import InputWebMIDIDevice from "../../../packages/audiobus/io/inputs/input-webmidi-device"
import type InputAudioEvent from "../../../packages/audiobus/io/events/input-audio-event"

const midi = vi.hoisted(() => ({
	inputs: [] as any[],
	enable: vi.fn(async () => {}),
	addListener: vi.fn(),
	removeListener: vi.fn()
}))
vi.mock("../../../packages/audiobus/node_modules/webmidi/dist/esm/webmidi.esm.js", () => ({
	WebMidi: midi
}))

describe("MIDI transport clock input", () => {
	it("forwards all 24 pulses, preserves transport codes and shared origin, and unsubscribes on disconnect", async () => {
		const listeners = new Set<(event: any) => void>()
		const device = {
			id: "clock",
			name: "Clock",
			manufacturer: "Test",
			type: "input",
			addListener: (_type: string, callback: (event: any) => void) => listeners.add(callback),
			removeListener: (_type: string, callback: (event: any) => void) =>
				listeners.delete(callback)
		}
		midi.inputs = [device]
		const clock = new InputMIDITransportClock()
		const notes = new InputWebMIDIDevice()
		const events: InputAudioEvent[] = []
		const noteEvents: InputAudioEvent[] = []
		clock.addEventListener("inputEvent", ((event: InputAudioEvent) =>
			events.push(event)) as EventListener)
		notes.addEventListener("inputEvent", ((event: InputAudioEvent) =>
			noteEvents.push(event)) as EventListener)
		await clock.connect()
		await notes.connect()
		expect(clock.inputDevices).toEqual([device])
		const send = (data: number[]) => {
			const event = { message: { data } }
			listeners.forEach((callback) => callback(event))
		}
		send([0xfa])
		for (let i = 0; i < 24; i++) {
			send([0xf8])
		}
		send([0xfc])
		send([0xfb])
		send([0x90, 94, 127])
		send([0x90, 60, 127])
		expect(events.filter((event) => event.command.type === "midiClock")).toHaveLength(24)
		expect(events[0].command.type).toBe("midiStart")
		expect(events[0].command.from).toBe("clock")
		expect(events[0].origin).toBe(noteEvents[0].origin)
		expect(events.some((event) => event.command.type === "midiStop")).toBe(true)
		expect(events.some((event) => event.command.type === "midiContinue")).toBe(true)
		expect(events.some((event) => event.command.number === 94)).toBe(true)
		expect(events.some((event) => event.command.number === 60)).toBe(false)
		expect(clock.getClockCount()).toBe(24)
		expect(clock.getClockProgress()).toBe(0)
		await clock.destroy()
		const count = events.length
		send([0xf8])
		expect(events).toHaveLength(count)
		expect(listeners.size).toBe(1)
		await notes.destroy()
		expect(listeners.size).toBe(0)
	})
})