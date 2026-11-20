import { expect, it } from "vitest"
import { File as NodeFile } from "node:buffer"
import AudioCommand from "audiobus/commands/audio-command"
import AudioEvent from "audiobus/models/audio-event"
import { NOTE_ON, NOTE_OFF } from "audiobus/commands/commands"
import { parseMML } from "audiobus/formats/mml"
import { parseRTTTL } from "audiobus/formats/rtttl"
import { recordingNotes, recordingVoices, type NoteRecording } from "audiobus/formats/note-sequence"
import { MMLtoAudioCommands } from "audiobus/conversion/mml-to-audio-commands"
import { importMMLFile } from "audiobus/importers/import-mml"
import { importRTTTLFile } from "audiobus/importers/import-rtttl"
import { createMMLFromAudioEventRecording } from "audiobus/exporters/adapter-mml"
import { createRTTTLFromAudioEventRecording } from "audiobus/exporters/adapter-rtttl"
import { createLilyPondFromAudioEventRecording } from "audiobus/exporters/adapter-lilypond"

const file = (text: string, name: string) => new NodeFile([text], name) as unknown as File
const on = (commands: AudioCommand[]) => commands.filter((c) => c.type === NOTE_ON)
function recording(
	notes: {
		number: number
		start: number
		end: number
		channel?: number
		velocity?: number
		patch?: number
	}[]
): NoteRecording {
	const events = notes.flatMap((note) => [
		new AudioEvent(
			Object.assign(new AudioCommand(), {
				type: NOTE_ON,
				number: note.number,
				channel: note.channel ?? 1,
				velocity: note.velocity ?? 100,
				patch: note.patch ?? 0,
				from: "test"
			}),
			note.start
		),
		new AudioEvent(
			Object.assign(new AudioCommand(), {
				type: NOTE_OFF,
				number: note.number,
				channel: note.channel ?? 1,
				velocity: 0,
				from: "test"
			}),
			note.end
		)
	])
	return { events, duration: Math.max(...notes.map((n) => n.end), 0), name: 'Tune "A" \\ title' }
}
it("parses MML defaults, accidentals, rests, octave shifts, dotted notes, gates and ties", () => {
	const result = parseMML("T120 O4 L8 V15 c d+ r4 >e4. < @5 @v64 q4 f4 & f8")
	expect(result.noteCount).toBe(4)
	expect(
		on(result.commands).map((c) => [c.number, c.startAt, c.endAt, c.velocity, c.patch])
	).toEqual([
		[60, 0, 0.25, 127, 0],
		[63, 0.25, 0.5, 127, 0],
		[76, 1, 1.75, 127, 0],
		[65, 1.75, 2.375, 64, 5]
	])
	expect(result.commands.filter((c) => c.type === NOTE_OFF)).toHaveLength(4)
})
it("executes bounded nested MML repeats and parallel parts from independent starting times", () => {
	const result = parseMML("// lead\nt120 l8 [c[d]3]2; /* bass */ t60 o2 l4 c r c;")
	expect(result.noteCount).toBe(10)
	expect(
		on(result.commands)
			.filter((c) => c.channel === 2)
			.map((c) => [c.startAt, c.endAt])
	).toEqual([
		[0, 1],
		[2, 3]
	])
	expect(
		on(result.commands)
			.filter((c) => c.channel === 1)
			.map((c) => c.number)
	).toEqual([60, 62, 62, 62, 60, 62, 62, 62])
})
it("applies inline MML tempo changes and absolute MIDI notes", () => {
	const result = MMLtoAudioCommands("t60 c4 t120 d4 n64")
	expect(on(result).map((c) => [c.number, c.startAt, c.endAt])).toEqual([
		[60, 0, 1],
		[62, 1, 1.5],
		[64, 1.5, 2]
	])
})
for (const text of [
	"[c]257",
	"[c",
	"c]",
	"c&d",
	"c&",
	"r&c",
	"t0c",
	"l0c",
	"o9b",
	"%6 @0 c",
	"/* c",
	"v0 c"
]) {
	it(`rejects unsupported or malformed MML: ${text}`, () => {
		expect(() => parseMML(text)).toThrow()
	})
}
it("round-trips MML polyphony, rests, programs, velocity and low pitches", async () => {
	const source = recording([
		{ number: 60, start: 10, end: 11, patch: 5, velocity: 96 },
		{ number: 64, start: 10.25, end: 10.75, patch: 5, velocity: 64 },
		{ number: 0, start: 10, end: 10.5, channel: 3, patch: 7 },
		{ number: 67, start: 11.25, end: 11.5, patch: 5, velocity: 80 }
	])
	const text = createMMLFromAudioEventRecording(source, { BPM: 120 })
	const result = await importMMLFile(file(text, "song.mml"))
	const actual = on(result.commands).sort((a, b) => a.number - b.number)
	const expected = recordingNotes(source).sort((a, b) => a.number - b.number)
	expect(actual).toHaveLength(expected.length)
	for (const [i, note] of actual.entries()) {
		expect([note.number, note.patch, note.velocity]).toEqual([
			expected[i].number,
			expected[i].patch,
			expected[i].velocity
		])
		expect(note.startAt).toBeCloseTo(expected[i].start, 3)
		expect(note.endAt - note.startAt).toBeCloseTo(expected[i].duration, 3)
	}
})
it("preserves nonbinary MML durations with ties on the 96 PPQ export grid", () => {
	const source = recording([{ number: 60, start: 0, end: 1 / 6 }])
	const result = parseMML(createMMLFromAudioEventRecording(source, { BPM: 120 }))
	expect(result.noteCount).toBe(1)
	expect(on(result.commands)[0].endAt).toBeCloseTo(1 / 6, 6)
})
it("parses RTTTL defaults, sharps, both dot positions, pauses and inline tempo changes", async () => {
	const result = await importRTTTLFile(
		file("Tune:d=8,o=5,b=120:c,16d#.,p,4f.6,b=60,c", "song.rtx")
	)
	expect(on(result.commands).map((c) => [c.number, c.startAt, c.endAt])).toEqual([
		[72, 0, 0.25],
		[75, 0.25, 0.4375],
		[89, 0.6875, 1.4375],
		[72, 1.4375, 1.9375]
	])
})
it("uses the classic RTTTL defaults when the controls section is empty", () => {
	const result = parseRTTTL("Tune::c")
	expect(on(result.commands)[0].number).toBe(84)
	expect(on(result.commands)[0].endAt).toBeCloseTo(60 / 63, 6)
})
it("round-trips a monophonic RTTTL melody with gaps and dotted durations", () => {
	const source = recording([
		{ number: 60, start: 10, end: 10.5 },
		{ number: 63, start: 10.75, end: 11.5 }
	])
	const text = createRTTTLFromAudioEventRecording(source, { BPM: 120 })
	expect(text).toContain(":d=4,o=6,b=120:4c4,8p,4d#4.")
	const result = parseRTTTL(text)
	expect(on(result.commands).map((c) => [c.number, c.startAt, c.endAt])).toEqual([
		[60, 0, 0.5],
		[63, 0.75, 1.5]
	])
})
for (const text of [
	"hello",
	"Tune:o=3:c",
	"Tune:d=3:c",
	"Tune:b=0:c",
	"Tune::c#8",
	"Tune::c..",
	"Tune::p#",
	"Tune::b#7",
	"Tune::c,",
	"Tune::p"
]) {
	it(`rejects invalid or silent RTTTL: ${text}`, () => {
		expect(() => parseRTTTL(text)).toThrow()
	})
}
it("rejects RTTTL polyphony, unavailable pitches and overlong notes explicitly", () => {
	expect(() =>
		createRTTTLFromAudioEventRecording(
			recording([
				{ number: 60, start: 0, end: 1 },
				{ number: 64, start: 0, end: 1 }
			]),
			{ BPM: 120 }
		)
	).toThrow("single melody")
	expect(() =>
		createRTTTLFromAudioEventRecording(recording([{ number: 48, start: 0, end: 1 }]), {
			BPM: 120
		})
	).toThrow("octaves 4–7")
	expect(() =>
		createRTTTLFromAudioEventRecording(recording([{ number: 60, start: 0, end: 4 }]), {
			BPM: 120
		})
	).toThrow("dotted whole")
})
it("writes absolute LilyPond pitches, independent staves, rests and escaped titles", () => {
	const source = recording([
		{ number: 60, start: 10, end: 10.5 },
		{ number: 61, start: 10.25, end: 10.75 },
		{ number: 0, channel: 3, start: 11, end: 11.5 }
	])
	const text = createLilyPondFromAudioEventRecording(source, { BPM: 120 })
	expect(recordingVoices(source)).toHaveLength(3)
	expect(text.match(/\\new Staff/g)).toHaveLength(3)
	expect(text).toContain("c'1*1/4")
	expect(text).toContain("cis'1*1/4")
	expect(text).toContain("r1*1/8")
	expect(text).toContain("c,,,,1*1/4")
	expect(text).toContain('title = "Tune \\"A\\" \\\\ title"')
	expect(text).toContain("\\midi {}")
})
it("requires notes and valid tempos for the new exporters", () => {
	for (const create of [
		createMMLFromAudioEventRecording,
		createRTTTLFromAudioEventRecording,
		createLilyPondFromAudioEventRecording
	]) {
		expect(() => create(recording([]), { BPM: 120 })).toThrow()
		expect(() => create(recording([{ number: 60, start: 0, end: 1 }]), { BPM: NaN })).toThrow(
			"tempo"
		)
	}
})
it("treats bare RTTTL b4 and d4 as notes rather than tempo or duration controls", () => {
	const result = parseRTTTL("Tune:d=4,o=6,b=120:b4,d4")
	expect(on(result.commands).map((c) => [c.number, c.startAt, c.endAt])).toEqual([
		[71, 0, 0.5],
		[62, 0.5, 1]
	])
})