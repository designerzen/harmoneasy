// @vitest-environment happy-dom
import { expect, it } from "vitest"
import { File as NodeFile } from "node:buffer"
import AudioCommand from "audiobus/commands/audio-command"
import AudioEvent from "audiobus/models/audio-event"
import { NOTE_ON, NOTE_OFF } from "audiobus/commands/commands"
import {
	detectImportFile,
	importMusicalFile,
	IMPORT_FILE_ACCEPT
} from "audiobus/importers/file-import"
import {
	INTERCHANGE_EXPORT_FORMATS,
	exportInterchangeRecording,
	createRMIDFromAudioEventRecording,
	createUSTFromAudioEventRecording
} from "audiobus/exporters/adapter-interchange"
import { recordingNotes } from "audiobus/formats/note-sequence"
const file = (data: string | Uint8Array, name = "renamed.bin") =>
	new NodeFile([data], name) as unknown as File
const timer = { BPM: 120 }
const recording = {
	name: 'Melody & "test"',
	duration: 12,
	events: [
		new AudioEvent(
			Object.assign(new AudioCommand(), {
				type: NOTE_ON,
				number: 60,
				channel: 2,
				patch: 7,
				velocity: 95,
				endAt: 10.5
			}),
			10
		),
		new AudioEvent(
			Object.assign(new AudioCommand(), {
				type: NOTE_ON,
				number: 64,
				channel: 2,
				patch: 7,
				velocity: 80,
				endAt: 11.5
			}),
			11
		)
	]
}
const onNotes = (result: Awaited<ReturnType<typeof importMusicalFile>>) =>
	result.commands.filter((command) => command.type === NOTE_ON)

for (const format of INTERCHANGE_EXPORT_FORMATS) {
	it(`exports and detects ${format.label}, then reloads its pitches and timing`, async () => {
		const original = JSON.stringify(recording)
		const blob = await exportInterchangeRecording(recording, timer, format.id)
		const input = file(new Uint8Array(await blob.arrayBuffer()))
		expect((await detectImportFile(input)).format.id).toBe(format.id)
		const imported = await importMusicalFile(input)
		expect(imported.noteCount).toBe(2)
		const notes = onNotes(imported)
		expect(notes.map((note) => note.number)).toEqual([60, 64])
		expect(notes[0].startAt).toBeCloseTo(0, 3)
		expect(notes[0].endAt).toBeCloseTo(0.5, 3)
		expect(notes[1].startAt).toBeCloseTo(1, 3)
		expect(notes[1].endAt).toBeCloseTo(1.5, 3)
		expect(JSON.stringify(recording)).toBe(original)
	})
}

it("loads independent Tone.js JSON with polyphony, programs and drums", async () => {
	const input = file(
		JSON.stringify({
			header: { ppq: 480 },
			tracks: [
				{
					channel: 1,
					instrument: { number: 11 },
					notes: [
						{ midi: 60, time: 0, duration: 1, velocity: 0.5 },
						{ midi: 64, time: 0.25, duration: 0.25, velocity: 1 }
					]
				},
				{
					channel: 9,
					instrument: { number: 0 },
					notes: [{ midi: 36, time: 0, duration: 0.1, velocity: 1 }]
				}
			]
		})
	)
	const result = await importMusicalFile(input)
	expect(onNotes(result)).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ number: 60, channel: 2, patch: 11, velocity: 64, endAt: 1 }),
			expect.objectContaining({ number: 36, channel: 10 })
		])
	)
	expect(result.commands.filter((command) => command.type === NOTE_OFF)).toHaveLength(3)
})

it("imports MIDI and frequency JAMS notes while ignoring unrelated annotations", async () => {
	const result = await importMusicalFile(
		file(
			JSON.stringify({
				annotations: [
					{ namespace: "beat", data: [{ time: 0, value: 1, duration: 0 }] },
					{
						namespace: "note_hz",
						data: [{ time: 0.5, duration: 1, value: 440, confidence: null }]
					},
					{
						namespace: "note_midi",
						data: [{ time: 1, duration: 0.25, value: 60.2, confidence: null }]
					}
				]
			})
		)
	)
	expect(onNotes(result)).toEqual([
		expect.objectContaining({ number: 69, startAt: 0.5, endAt: 1.5 }),
		expect.objectContaining({ number: 60, startAt: 1, endAt: 1.25 })
	])
})

it("applies UST rests and note-local tempo changes", async () => {
	const result = await importMusicalFile(
		file(
			"[#VERSION]\nUST Version1.2\n[#SETTING]\nTempo=120\n[#0000]\nLength=480\nNoteNum=60\nLyric=a\n[#0001]\nLength=480\nLyric=R\nTempo=60\n[#0002]\nLength=240\nNoteNum=64\nLyric=a\n[#TRACKEND]\n"
		)
	)
	expect(onNotes(result)).toEqual([
		expect.objectContaining({ number: 60, startAt: 0, endAt: 0.5 }),
		expect.objectContaining({ number: 64, startAt: 1.5, endAt: 2 })
	])
})

it("rejects overlapping UST export instead of losing notes", () => {
	const overlapping = {
		...recording,
		events: [
			...recording.events,
			new AudioEvent(
				Object.assign(new AudioCommand(), {
					type: NOTE_ON,
					number: 67,
					velocity: 100,
					endAt: 10.5
				}),
				10
			)
		]
	}
	expect(() => createUSTFromAudioEventRecording(overlapping, timer)).toThrow("single melody")
})

it("imports Sonic Visualiser frames and Hz pitches with the declared sample rate", async () => {
	const result = await importMusicalFile(
		file(
			'<!DOCTYPE sonic-visualiser><sv><data><model id="1" type="sparse" subtype="note" dimensions="3" sampleRate="44100" units="Hz" dataset="2"/><dataset id="2"><point frame="44100" duration="22050" value="440" level="0.5" label="A"/></dataset></data></sv>'
		)
	)
	expect(onNotes(result)[0]).toMatchObject({ number: 69, startAt: 1, endAt: 1.5, velocity: 64 })
})

it("preserves channels and programs in RIFF MIDI and Tone.js JSON", async () => {
	for (const id of ["rmid", "tone-json"] as const) {
		const blob = await exportInterchangeRecording(recording, timer, id)
		const result = await importMusicalFile(file(new Uint8Array(await blob.arrayBuffer())))
		expect(onNotes(result)[0]).toMatchObject({ channel: 2, patch: 7 })
		expect(onNotes(result)[0].velocity).toBeCloseTo(95, 4)
	}
})

it("rejects truncated RIFF MIDI containers", async () => {
	const bytes = createRMIDFromAudioEventRecording(recording, timer)
	await expect(importMusicalFile(file(bytes.slice(0, -1)))).rejects.toThrow("length")
	new DataView(bytes.buffer).setUint32(16, bytes.length * 2, true)
	await expect(importMusicalFile(file(bytes))).rejects.toThrow("Truncated")
})

for (const [text, name] of [
	[
		'{"header":{},"tracks":[{"channel":0,"notes":[{"midi":60,"time":0,"duration":1,"velocity":2}]}]}',
		"bad.tone.json"
	],
	[
		'{"annotations":[{"namespace":"note_midi","data":[{"time":-1,"duration":1,"value":60}]}]}',
		"bad.jams"
	],
	[
		'{"annotations":[{"namespace":"note_hz","data":[{"time":0,"duration":1,"value":0}]}]}',
		"bad.jams"
	],
	["[#SETTING]\nTempo=0\n[#0000]\nLength=480\nNoteNum=60\nLyric=a\n", "bad.ust"],
	[
		'<sv><data><model subtype="note" sampleRate="0" dataset="2"/><dataset id="2"/></data></sv>',
		"bad.svl"
	],
	['<!DOCTYPE sv [<!ENTITY x SYSTEM "file:///secret">]><sv/>', "bad.svl"]
]) {
	it(`rejects invalid ${name} data`, async () => {
		await expect(importMusicalFile(file(text, name))).rejects.toThrow()
	})
}

it("advertises the new extensions in the unified file picker", () => {
	for (const extension of [".tone.json", ".jams", ".ust", ".svl", ".rmi", ".rmid", ".kar"]) {
		expect(IMPORT_FILE_ACCEPT.split(",")).toContain(extension)
	}
	expect(recordingNotes(recording)).toHaveLength(2)
})

for (const format of ["guitar-pro", "alphatex"] as const) {
	it(`preserves chords and ties across measures in ${format}`, async () => {
		const chord = {
			...recording,
			events: [
				new AudioEvent(
					Object.assign(new AudioCommand(), {
						type: NOTE_ON,
						number: 60,
						channel: 1,
						patch: 0,
						velocity: 100,
						endAt: 14.5
					}),
					10
				),
				new AudioEvent(
					Object.assign(new AudioCommand(), {
						type: NOTE_ON,
						number: 64,
						channel: 1,
						patch: 0,
						velocity: 100,
						endAt: 11.5
					}),
					10.5
				),
				new AudioEvent(
					Object.assign(new AudioCommand(), {
						type: NOTE_ON,
						number: 67,
						channel: 1,
						patch: 0,
						velocity: 100,
						endAt: 13.5
					}),
					13
				)
			]
		}
		const blob = await exportInterchangeRecording(chord, timer, format)
		const result = await importMusicalFile(file(new Uint8Array(await blob.arrayBuffer())))
		expect(result.noteCount).toBe(3)
		expect(onNotes(result)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ number: 60, startAt: 0, endAt: 4.5 }),
				expect.objectContaining({ number: 64, startAt: 0.5, endAt: 1.5 }),
				expect.objectContaining({ number: 67, startAt: 3, endAt: 3.5 })
			])
		)
	})
}