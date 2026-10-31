import { afterEach, describe, expect, it, vi } from "vitest"
import { createRequire } from "node:module"
import AudioCommand from "audiobus/audio-command"
import { NOTE_ON, NOTE_OFF, CONTROL_CHANGE } from "audiobus/commands"
import { TransformerMIDIFilePlayer } from "audiobus/io/transformers/transformer-midi-file-player"

const timer = {} as any
const { Midi } = createRequire(new URL("../../../packages/audiobus/package.json", import.meta.url))(
	"@tonejs/midi"
)
const command = (type: string, number = 60, velocity = 100, channel = 1, from = "keyboard") =>
	Object.assign(new AudioCommand(), { type, number, velocity, channel, from, startAt: 10 })
const transformers: TransformerMIDIFilePlayer[] = []
function midiFile() {
	const midi = new Midi()
	const bass = midi.addTrack()
	bass.name = "Bass"
	bass.channel = 0
	bass.addNote({ midi: 36, time: 0, duration: 1 })
	const melody = midi.addTrack()
	melody.name = "Lead melody"
	melody.channel = 1
	for (const [time, pitch] of [64, 67, 65].entries()) {
		melody.addNote({ midi: pitch, time, duration: 0.5, velocity: 0.8 })
	}
	const drums = midi.addTrack()
	drums.name = "Drums"
	drums.channel = 9
	drums.addNote({ midi: 42, time: 0, duration: 0.2 })
	return midi.toArray()
}
async function setup(options = {}) {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response(midiFile()))
	)
	const transformer = new TransformerMIDIFilePlayer({ playbackMode: "step", ...options })
	transformers.push(transformer)
	await transformer.loadMIDIFile("song.mid")
	return transformer
}
afterEach(() => {
	transformers.splice(0).forEach((transformer) => transformer.destroy())
	vi.unstubAllGlobals()
})
describe("MIDI file melody stepping", () => {
	it("plays exactly one melody note for each press and wraps repeatedly", async () => {
		const transformer = await setup()
		const notes: number[] = []
		for (let index = 0; index < 15; index++) {
			const [on] = transformer.transform([command(NOTE_ON, 30 + index)], timer)
			notes.push(on.number)
			expect(on.startAt).toBe(10)
			const [off] = transformer.transform([command(NOTE_OFF, 30 + index, 0)], timer)
			expect(off).toMatchObject({ type: NOTE_OFF, number: on.number, velocity: 0 })
		}
		expect(notes).toEqual(Array.from({ length: 5 }, () => [64, 67, 65]).flat())
	})
	it("keeps key releases matched to their assigned notes across channels and devices", async () => {
		const transformer = await setup()
		transformer.transform(
			[command(NOTE_ON, 60, 80, 1, "one"), command(NOTE_ON, 60, 90, 2, "two")],
			timer
		)
		expect(
			transformer
				.transform(
					[command(NOTE_ON, 60, 0, 2, "two"), command(NOTE_OFF, 60, 0, 1, "one")],
					timer
				)
				.map((note) => [note.type, note.number, note.channel])
		).toEqual([
			[NOTE_OFF, 67, 2],
			[NOTE_OFF, 64, 1]
		])
		expect(transformer.transform([command(NOTE_OFF, 90, 0)], timer)).toEqual([])
	})
	it("releases a retriggered key before assigning its next melody note", async () => {
		const transformer = await setup()
		transformer.transform([command(NOTE_ON)], timer)
		expect(
			transformer.transform([command(NOTE_ON)], timer).map((note) => [note.type, note.number])
		).toEqual([
			[NOTE_OFF, 64],
			[NOTE_ON, 67]
		])
	})
	it("selects an explicit melody track and rewinds when reset", async () => {
		const transformer = await setup({ trackIndex: 0 })
		expect(transformer.transform([command(NOTE_ON)], timer)[0].number).toBe(36)
		transformer.setConfig("trackIndex", 1)
		expect(transformer.transform([command(NOTE_ON, 61)], timer)[0].number).toBe(64)
		transformer.reset()
		expect(transformer.transform([command(NOTE_ON)], timer)[0].number).toBe(64)
	})
	it("passes controllers through without advancing and stops when looping is disabled", async () => {
		const transformer = await setup({ loop: false })
		const cc = command(CONTROL_CHANGE, 7)
		expect(transformer.transform([cc], timer)).toEqual([cc])
		for (let index = 0; index < 3; index++) {
			transformer.transform([command(NOTE_ON, index)], timer)
		}
		expect(transformer.transform([command(NOTE_ON, 99)], timer)).toEqual([])
		transformer.setConfig("loop", true)
		expect(transformer.transform([command(NOTE_ON, 99)], timer)[0].number).toBe(64)
	})
	it("does not leak trigger notes before a melody has loaded", () => {
		const transformer = new TransformerMIDIFilePlayer({ playbackMode: "step" })
		transformers.push(transformer)
		expect(transformer.transform([command(NOTE_ON), command(NOTE_OFF)], timer)).toEqual([])
	})
	it("preserves the original whole-file playback mode", async () => {
		const transformer = await setup({ playbackMode: "file" })
		expect(transformer.transform([command(NOTE_ON)], timer)).toHaveLength(10)
	})
	it("still releases held melody notes when bypassed", async () => {
		const transformer = await setup()
		transformer.transform([command(NOTE_ON)], timer)
		transformer.setConfig("enabled", false)
		expect(transformer.transform([command(NOTE_OFF)], timer)[0]).toMatchObject({
			type: NOTE_OFF,
			number: 64
		})
	})
	it("releases the assigned pitch after switching back to whole-file mode", async () => {
		const transformer = await setup()
		transformer.transform([command(NOTE_ON)], timer)
		transformer.setConfig("playbackMode", "file")
		expect(transformer.transform([command(NOTE_OFF)], timer)).toEqual([
			expect.objectContaining({ type: NOTE_OFF, number: 64 })
		])
	})
})