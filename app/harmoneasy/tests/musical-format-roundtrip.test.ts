// @vitest-environment happy-dom
import { expect, it } from "vitest"
import { File as NodeFile } from "node:buffer"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import AudioCommand from "audiobus/commands/audio-command"
import AudioEvent from "audiobus/models/audio-event"
import { NOTE_ON, NOTE_OFF, CONTROL_CHANGE, PITCH_BEND } from "audiobus/commands/commands"
import { recordingNotes, type NoteRecording } from "audiobus/formats/note-sequence"
import { createABCFromAudioEventRecording } from "audiobus/exporters/adapter-abc"
import { createMIDICSVFromAudioEventRecording } from "audiobus/exporters/adapter-midi-csv"
import {
	createMusicXMLFromAudioEventRecording,
	createMXLFromAudioEventRecording
} from "audiobus/exporters/adapter-musicxml"
import { createDawProjectFromAudioEventRecording } from "audiobus/exporters/adapter-dawproject"
import { importABCFile } from "audiobus/importers/import-abc"
import { importMIDICSVFile } from "audiobus/importers/import-midi-csv"
import { importMusicXMLFile } from "audiobus/importers/import-musicxml-import"
import { importDawProjectFile } from "audiobus/importers/import-dawproject"
const { unzipSync } = createRequire(resolve("../../packages/audiobus/package.json"))("fflate")
const file = (bytes: string | Uint8Array, name: string) =>
	new NodeFile([bytes], name) as unknown as File
const timer = { BPM: 120 }
function recording(): NoteRecording {
	const events: AudioEvent[] = []
	const add = (
		number: number,
		channel: number,
		start: number,
		end: number,
		velocity: number,
		chainId = "a",
		patch = 3
	) => {
		for (const [type, startAt] of [
			[NOTE_ON, start],
			[NOTE_OFF, end]
		] as const) {
			const command = Object.assign(new AudioCommand(), {
				type,
				number,
				channel,
				startAt,
				velocity: type === NOTE_ON ? velocity : 0,
				from: "test",
				chainId,
				patch
			})
			events.push(new AudioEvent(command, startAt))
		}
	}
	add(60, 1, 10, 11, 90)
	add(60, 2, 10, 10.5, 64, "b", 5)
	add(64, 1, 10.25, 10.75, 100)
	add(67, 1, 11.5, 12, 70)
	add(0, 3, 10.5, 10.75, 80, "c", 1)
	return { events, duration: 12, name: 'Song, "A" & <B>' }
}
const summary = (commands: AudioCommand[]) =>
	commands
		.filter((c) => c.type === NOTE_ON)
		.map((c) => ({
			number: c.number,
			channel: c.channel,
			start: c.startAt,
			duration: c.endAt - c.startAt,
			velocity: c.velocity,
			patch: c.patch
		}))
		.sort((a, b) => a.channel - b.channel || a.start - b.start || a.number - b.number)
const expected = (record: NoteRecording) =>
	recordingNotes(record).sort(
		(a, b) => a.channel - b.channel || a.start - b.start || a.number - b.number
	)
it("pairs equal pitches independently by chain and channel without mutating the recorder", () => {
	const record = recording(),
		original = JSON.stringify(record.events)
	const result = recordingNotes(record)
	expect(result).toHaveLength(5)
	expect(
		result
			.filter((n) => n.number === 60)
			.map((n) => n.duration)
			.sort()
	).toEqual([0.5, 1])
	expect(JSON.stringify(record.events)).toBe(original)
})
it("round-trips standard MIDICSV notes, programs, velocities and overlapping channels", async () => {
	const record = recording()
	const text = createMIDICSVFromAudioEventRecording(record, timer)
	expect(text).toContain('Title_t, "Song, ""A"" & <B>"')
	const result = await importMIDICSVFile(file(text, "song.csv"))
	expect(result.noteCount).toBe(5)
	expect(summary(result.commands)).toEqual(expected(record))
})
it("reads MIDI CSV tempo maps, note-on-zero, controllers and pitch bend", async () => {
	const text = `0, 0, Header, 1, 2, 480
1, 0, Start_track
1, 0, Tempo, 500000
1, 480, Tempo, 1000000
1, 960, End_track
2, 0, Start_track
2, 0, Program_c, 0, 8
2, 0, Note_on_c, 0, 60, 80
2, 240, Control_c, 0, 1, 64
2, 480, Pitch_bend_c, 0, 9000
2, 960, Note_on_c, 0, 60, 0
2, 960, End_track
0, 0, End_of_file`
	const result = await importMIDICSVFile(file(text, "tempo.csv"))
	expect(result.commands.find((c) => c.type === NOTE_ON)).toMatchObject({ endAt: 1.5, patch: 8 })
	expect(result.commands.find((c) => c.type === CONTROL_CHANGE)).toMatchObject({
		number: 1,
		value: 64,
		startAt: 0.25
	})
	expect(result.commands.find((c) => c.type === PITCH_BEND)).toMatchObject({
		value: 9000,
		startAt: 0.5
	})
})
it("rejects ordinary CSV, bad timing divisions and out-of-range notes", async () => {
	await expect(importMIDICSVFile(file("name,value\nfoo,1", "table.csv"))).rejects.toThrow(
		"Header"
	)
	await expect(importMIDICSVFile(file("0,0,Header,1,1,-25", "smpte.csv"))).rejects.toThrow(
		"Invalid MIDI CSV"
	)
	await expect(
		importMIDICSVFile(file("0,0,Header,1,1,480\n1,0,Note_on_c,0,128,100", "bad.csv"))
	).rejects.toThrow("Invalid MIDI CSV")
})
for (const compressed of [false, true]) {
	it(`round-trips ${compressed ? "compressed" : "plain"} MusicXML with timing, programs and note dynamics`, async () => {
		const record = recording()
		const blob = await (
			compressed ? createMXLFromAudioEventRecording : createMusicXMLFromAudioEventRecording
		)(record, timer)
		const bytes = new Uint8Array(await blob.arrayBuffer())
		if (compressed) {
			const archive = unzipSync(bytes)
			expect(archive["META-INF/container.xml"]).toBeDefined()
			expect(archive["score.musicxml"]).toBeDefined()
		}
		const result = await importMusicXMLFile(
			file(bytes, compressed ? "song.mxl" : "song.musicxml")
		)
		expect(summary(result.commands)).toEqual(expected(record))
	})
}
it("exports DAWproject ZIP/XML that imports with note timing and channels intact", async () => {
	const record = recording(),
		blob = await createDawProjectFromAudioEventRecording(record, timer)
	const bytes = new Uint8Array(await blob.arrayBuffer()),
		archive = unzipSync(bytes)
	expect(new TextDecoder().decode(archive["metadata.xml"])).toContain("&amp; &lt;B&gt;")
	const result = await importDawProjectFile(file(bytes, "song.dawproject"))
	expect(summary(result.commands).map(({ patch: _patch, ...note }) => note)).toEqual(
		expected(record).map(({ patch: _patch, ...note }) => note)
	)
})
it("imports ABC key signatures, chords, rests, tuplets and repeats", async () => {
	const abc = "X:1\nT:Test\nM:4/4\nL:1/8\nQ:1/4=120\nK:G\n|: F2 [CE]2 z2 (3ABC :|"
	const result = await importABCFile(file(abc, "song.abc"))
	expect(result.noteCount).toBe(12)
	const notes = result.commands.filter((c) => c.type === NOTE_ON)
	expect(notes[0].number).toBe(66)
	expect(notes.filter((c) => c.number === 60)).toHaveLength(4)
})
it("round-trips ABC voices, pitches, rests and note durations", async () => {
	const record = recording(),
		abc = createABCFromAudioEventRecording(record, timer)
	const result = await importABCFile(file(abc, "song.abc"))
	expect(result.noteCount).toBe(5)
	const byPitch = (notes: { number: number; start: number; duration: number }[]) =>
		notes
			.map(({ number, start, duration }) => ({ number, start, duration }))
			.sort((a, b) => a.number - b.number || a.start - b.start || a.duration - b.duration)
	expect(byPitch(summary(result.commands))).toEqual(byPitch(expected(record)))
})
it("rejects empty ABC and requires a single tune", async () => {
	await expect(importABCFile(file("hello", "bad.abc"))).rejects.toThrow("key header")
	await expect(importABCFile(file("X:1\nK:C\nC\n\nX:2\nK:C\nD", "book.abc"))).rejects.toThrow(
		"one ABC tune"
	)
})
it("rejects invalid export tempos", () => {
	expect(() => createABCFromAudioEventRecording(recording(), { BPM: 0 })).toThrow("tempo")
	expect(() => createMIDICSVFromAudioEventRecording(recording(), { BPM: NaN })).toThrow("tempo")
})