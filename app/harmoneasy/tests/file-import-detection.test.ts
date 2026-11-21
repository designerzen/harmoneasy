import { expect, it } from "vitest"
import { File as NodeFile } from "node:buffer"
import { createRequire } from "node:module"
import { detectImportFile, importMusicalFile } from "audiobus/importers/file-import"
import { importNotationFile } from "audiobus/importers/import-notation-file"
import { importNoteSequenceFile } from "audiobus/importers/import-note-sequence"
import { createNoteSequenceFromAudioEventRecording } from "audiobus/exporters/adapter-note-sequence"
import AudioCommand from "audiobus/commands/audio-command"
import AudioEvent from "audiobus/models/audio-event"
import { NOTE_ON } from "audiobus/commands/commands"
const require = createRequire(new URL("../../../packages/audiobus/package.json", import.meta.url))
const { zipSync, strToU8 } = require("fflate")
const file = (data: string | Uint8Array, name = "renamed.bin", type = "") =>
	new NodeFile([data], name, { type }) as unknown as File
for (const [text, id] of [
	["MThd0000", "midi"],
	["IMPM0000", "tracker"],
	["MMD10000", "tracker"],
	["Extended Module: ", "tracker"],
	["RIFF0000WAVEdata", "audio"],
	["OggS0000", "audio"],
	["fLaC0000", "audio"],
	["ID3audio", "audio"],
	["X:1\nK:C\nC", "abc"],
	["0, 0, Header, 1, 1, 480", "midi-csv"],
	["t120 o4 c4", "mml"],
	["Tune:d=4,o=5,b=120:c", "rtttl"],
	['<?xml version="1.0"?><score-partwise/>', "musicxml"],
	['<Project version="1.0"/>', "dawproject"],
	[JSON.stringify({ notes: [{ pitch: 60, endTime: 1 }] }), "notesequence"]
] as const) {
	it(`detects ${id} from content without trusting the extension`, async () => {
		expect((await detectImportFile(file(text))).format.id).toBe(id)
	})
}
it("identifies ZIP contents before considering a misleading .zip filename", async () => {
	for (const [contents, id] of [
		[{ "META-INF/container.xml": strToU8("<container/>") }, "mxl"],
		[{ "project.xml": strToU8("<Project/>") }, "dawproject"],
		[{ "Content/score.gpif": strToU8("<GPIF/>") }, "guitar-pro"],
		[{ "score.xml": strToU8("<score version='1'/>") }, "capella"],
		[{ "song.mid": strToU8("MThd0000") }, "bundle"]
	] as const) {
		const detected = await detectImportFile(file(zipSync(contents), "random.zip"))
		expect(detected.format.id).toBe(id)
		expect(detected.archive).toBeDefined()
	}
})
it("rejects misleading MIDI, generic JSON and archive traversal", async () => {
	await expect(detectImportFile(file("not midi", "song.mid"))).rejects.toThrow(
		"Standard MIDI File header"
	)
	await expect(detectImportFile(file('{"name":"plugin"}', "plugin.json"))).rejects.toThrow(
		"not a Magenta NoteSequence"
	)
	await expect(
		detectImportFile(file(zipSync({ "../project.xml": strToU8("<Project/>") })))
	).rejects.toThrow("Unsafe archive path")
})
it("imports Magenta seconds and quantized protobuf JSON with instruments and drums", async () => {
	const seconds = await importNoteSequenceFile(
		file(
			JSON.stringify({
				notes: [
					{ pitch: 60, end_time: 1, instrument: 2, program: 7, velocity: 90 },
					{ pitch: 36, start_time: 0.5, end_time: 0.75, is_drum: true }
				]
			})
		)
	)
	expect(seconds.noteCount).toBe(2)
	expect(seconds.commands.filter((c) => c.type === NOTE_ON)).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ number: 60, startAt: 0, endAt: 1, channel: 3, patch: 7 }),
			expect.objectContaining({ number: 36, channel: 10, startAt: 0.5 })
		])
	)
	const quantized = await importNoteSequenceFile(
		file(
			JSON.stringify({
				notes: [{ pitch: 64, quantizedEndStep: "4" }],
				quantizationInfo: { stepsPerQuarter: 4 },
				tempos: [{ time: 0, qpm: 120 }]
			})
		)
	)
	expect(quantized.commands[0]).toMatchObject({ number: 64, startAt: 0, endAt: 0.5 })
})
it("round-trips NoteSequence channels, programs, velocities and timing", async () => {
	const event = new AudioEvent(
		Object.assign(new AudioCommand(), {
			type: NOTE_ON,
			number: 60,
			channel: 14,
			patch: 8,
			velocity: 91,
			endAt: 11
		}),
		10
	)
	const text = createNoteSequenceFromAudioEventRecording(
		{ events: [event], duration: 11, name: "Test" },
		{ BPM: 120 }
	)
	const result = await importMusicalFile(file(text, "test.notes.json"))
	expect(result.commands[0]).toMatchObject({
		number: 60,
		channel: 14,
		patch: 8,
		velocity: 91,
		startAt: 0,
		endAt: 1
	})
})
for (const notes of [
	[null],
	[{ pitch: 128, endTime: 1 }],
	[{ pitch: 60, startTime: 1, endTime: 0 }],
	[{ pitch: 60, startTime: -1, endTime: 1 }]
]) {
	it("rejects malformed NoteSequence notes", async () => {
		await expect(importNoteSequenceFile(file(JSON.stringify({ notes })))).rejects.toThrow()
	})
}
it("imports alphaTex notes through the headless score engine", async () => {
	const result = await importMusicalFile(
		file('\\title "Test" \\tempo 120 . :4 0.1 2.1 4.1 5.1', "test.atex")
	)
	expect(result.noteCount).toBe(4)
	expect(result.commands.filter((c) => c.type === NOTE_ON).map((c) => c.number)).toEqual([
		64, 66, 68, 69
	])
})
it("imports a Guitar Pro archive with the same notes as the original score", async () => {
	const { importer, exporter, Settings } =
		await import("../../../packages/audiobus/node_modules/@coderline/alphatab/dist/alphaTab.core.mjs")
	const parser = new importer.AlphaTexImporter(),
		settings = new Settings()
	parser.initFromString('\\title "GP Test" \\tempo 120 . :4 0.1 2.1 4.1 5.1', settings)
	const score = parser.readScore(),
		bytes = new exporter.Gp7Exporter().export(score, settings)
	const input = file(bytes, "renamed.zip")
	expect((await detectImportFile(input)).format.id).toBe("guitar-pro")
	const result = await importNotationFile(input)
	expect(result.noteCount).toBe(4)
	expect(result.commands.filter((c) => c.type === NOTE_ON).map((c) => c.number)).toEqual([
		64, 66, 68, 69
	])
})
it("imports notes from a Capella score archive", async () => {
	const chords = ["C5", "D5", "E5", "F5"]
		.map(
			(pitch) =>
				`<chord><duration base="1/4"/><heads><head pitch="${pitch}"/></heads></chord>`
		)
		.join("")
	const score = `<score><layout><staves><staffLayout description="Piano"><notation defaultClef="treble"/><sound instr="0" volume="100"/></staffLayout></staves></layout><systems><system tempo="120"><staves><staff layout="Piano" defaultTime="4/4"><voices><voice><noteObjects>${chords}</noteObjects></voice></voices></staff></staves></system></systems></score>`
	const input = file(zipSync({ "score.xml": strToU8(score) }), "renamed.zip")
	expect((await detectImportFile(input)).format.id).toBe("capella")
	const result = await importMusicalFile(input)
	expect(result.noteCount).toBe(4)
	expect(result.commands.filter((c) => c.type === NOTE_ON).map((c) => c.number)).toEqual([
		60, 62, 64, 65
	])
})