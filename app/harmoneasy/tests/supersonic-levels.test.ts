// @vitest-environment happy-dom
import { expect, it, vi } from "vitest"
import { midiNoteToFrequency } from "../../../packages/audiobus/conversion/note-to-frequency"
const engine = vi.hoisted(() => ({
	initialized: false,
	init: vi.fn(),
	on: vi.fn(),
	send: vi.fn(),
	loadSynthDefs: vi.fn().mockResolvedValue({}),
	destroy: vi.fn().mockResolvedValue(undefined)
}))
vi.mock("../../../packages/audiobus/node_modules/supersonic-scsynth", () => ({
	SuperSonic: class {
		constructor() {
			return engine
		}
	}
}))
import OutputSuperSonic from "../../../packages/audiobus/io/outputs/output-supersonic"

it("converts MIDI notes in octaves at concert pitch", () => {
	expect(midiNoteToFrequency(57)).toBe(220)
	expect(midiNoteToFrequency(69)).toBe(440)
	expect(midiNoteToFrequency(81)).toBe(880)
})
it("loads bundled synthdefs and retains velocity in the preset amplitude", async () => {
	engine.initialized = false
	engine.init.mockImplementation(async () => {
		engine.initialized = true
	})
	const output = new OutputSuperSonic()
	await output.connect()
	expect(engine.loadSynthDefs).toHaveBeenCalledWith(expect.arrayContaining(["sonic-pi-beep"]))
	output.noteOn(57, 80)
	const message = engine.send.mock.lastCall!
	expect(message.slice(0, 5)).toEqual(["/s_new", "sonic-pi-beep", 1000, 0, 0])
	const params = Object.fromEntries(
		Array.from({ length: (message.length - 5) / 2 }, (_, i) => [
			message[5 + i * 2],
			message[6 + i * 2]
		])
	)
	expect(params.note).toBe(57)
	expect(params.amp).toBeCloseTo((0.2 * 80) / 127)
	output.noteOff(57)
	expect(engine.send).toHaveBeenLastCalledWith("/n_free", 1000)
	await output.destroy()
})