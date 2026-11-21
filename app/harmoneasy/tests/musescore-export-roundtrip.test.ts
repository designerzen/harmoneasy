// @vitest-environment happy-dom
import { expect, it } from "vitest"
import AudioCommand from "audiobus/commands/audio-command"
import AudioEvent from "audiobus/models/audio-event"
import { NOTE_ON } from "audiobus/commands/commands"
import { File as NodeFile } from "node:buffer"
import { createMuseScoreFromAudioEventRecording } from "audiobus/exporters/adapter-musescore"
import { importMuseScoreFile } from "audiobus/importers/import-musescore"
import { recordingNotes } from "audiobus/formats/note-sequence"
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

for (const compressed of [false, true]) {
	it(`round-trips MuseScore ${compressed ? "mscz" : "mscx"} rests, ties, overlaps, programs and velocities`, async () => {
		const blob = await createMuseScoreFromAudioEventRecording(recording, { BPM: 120 }, compressed)
		if (!compressed) {
			const xml = await blob.text()
			expect(xml).toContain("<programVersion>4.0.0</programVersion>")
			expect(xml).toContain('<Spanner type="Tie">')
			expect(xml).toContain("<Rest>")
		}
		const result = await importMuseScoreFile(new NodeFile([await blob.arrayBuffer()], `song.${compressed ? "mscz" : "mscx"}`) as unknown as File)
		const notes = result.commands.filter((command) => command.type === NOTE_ON)
		const expected = recordingNotes(recording)
		expect(notes).toHaveLength(expected.length)
		for (const note of expected) {
			const match = notes.find((command) => command.number === note.number && command.patch === note.patch && Math.abs(command.startAt - note.start) < 0.001)!
			expect(match).toBeDefined()
			expect(match.channel).toBe(note.channel)
			expect(match.velocity).toBe(note.velocity)
			expect(match.endAt - match.startAt).toBeCloseTo(note.duration, 6)
		}
	})
}
it("rejects empty scores and invalid tempo", async () => {
	await expect(createMuseScoreFromAudioEventRecording({ ...recording, events: [] }, { BPM: 120 }, false)).rejects.toThrow("1–128 voices")
	await expect(createMuseScoreFromAudioEventRecording(recording, { BPM: 0 }, false)).rejects.toThrow("tempo")
})
