// @vitest-environment happy-dom
import { expect, it } from "vitest"
import AudioCommand from "audiobus/commands/audio-command"
import AudioEvent from "audiobus/models/audio-event"
import { NOTE_ON } from "audiobus/commands/commands"
import { File as NodeFile } from "node:buffer"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { createMIDIFileFromAudioEventRecording } from "audiobus/exporters/adapter-midi-file"
import { createMIDIMarkdownFromAudioEventRecording } from "audiobus/exporters/adapter-midi-markdown"
import { importMIDIFile } from "audiobus/importers/import-midi-file"
import { recordingNotes } from "audiobus/formats/note-sequence"
const { Midi } = createRequire(resolve("../../packages/audiobus/package.json"))("@tonejs/midi")
const recording = {
	name: 'Song & "test"',
	duration: 15,
	events: [
		[60, 1, 3, 90, 10, 12.5],
		[64, 1, 3, 100, 10.25, 10.75],
		[60, 2, 5, 64, 10, 10.5],
		[67, 2, 5, 70, 13, 13.5]
	].map(([number, channel, patch, velocity, start, endAt]) => new AudioEvent(
		Object.assign(new AudioCommand(), { type: NOTE_ON, number, channel, patch, velocity, endAt, from: `Source ${channel}` }), start
	))
}

it("round-trips overlapping MIDI notes, channels, programs, velocities, name and tempo", async () => {
	const blob = await createMIDIFileFromAudioEventRecording(recording, { BPM: 120 })
	const bytes = await blob.arrayBuffer()
	const midi = new Midi(bytes)
	expect(midi.header.name).toBe(recording.name)
	expect(midi.header.tempos[0].bpm).toBe(120)
	expect(midi.tracks).toHaveLength(2)
	expect(midi.tracks.map((track: { name: string }) => track.name)).toEqual(["Source 1 1", "Source 2 2"])
	const imported = await importMIDIFile(new NodeFile([bytes], "song.mid") as unknown as File)
	const actual = imported.commands.filter((command) => command.type === NOTE_ON)
	const expected = recordingNotes(recording)
	expect(actual).toHaveLength(expected.length)
	for (const note of expected) {
		const match = actual.find((command) => command.channel === note.channel && command.number === note.number && Math.abs(command.startAt - note.start) < 0.001)!
		expect(match).toBeDefined()
		expect(match.patch).toBe(note.patch)
		expect(match.velocity).toBeCloseTo(note.velocity, 8)
		expect(match.endAt - match.startAt).toBeCloseTo(note.duration, 3)
	}
})
it("writes MIDI Markdown from paired recording notes without exportData", () => {
	const text = createMIDIMarkdownFromAudioEventRecording(recording, { BPM: 120 })
	expect(text).toContain("**Total Notes:** 4")
	expect(text).toContain("| 0:00.00 | 0:02.50 | C4 | 60 |")
})
