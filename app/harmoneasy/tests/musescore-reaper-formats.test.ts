// @vitest-environment happy-dom
import { expect, it } from "vitest"
import { File as NodeFile } from "node:buffer"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import {
	detectImportFile,
	importMusicalFile,
	IMPORT_FILE_ACCEPT
} from "audiobus/importers/file-import"
import { createReaperFromAudioEventRecording } from "audiobus/exporters/adapter-reaper"
import {
	parseReaperProject,
	reaperChunks,
	reaperField,
	reaperTimeAxis
} from "audiobus/formats/reaper-project"
import AudioCommand from "audiobus/commands/audio-command"
import AudioEvent from "audiobus/models/audio-event"
import { NOTE_ON } from "audiobus/commands/commands"
const require = createRequire(resolve("../../packages/audiobus/package.json"))
const { zipSync, strToU8 } = require("fflate")
const file = (data: string | Uint8Array, name = "renamed.bin") =>
	new NodeFile([data], name) as unknown as File
const on = (result: Awaited<ReturnType<typeof importMusicalFile>>) =>
	result.commands.filter((command) => command.type === NOTE_ON)
const note = (pitch: number, ties = "") => `<Note><pitch>${pitch}</pitch>${ties}</Note>`
const chord = (pitch: number, duration = "quarter", extra = "", ties = "") =>
	`<Chord><durationType>${duration}</durationType>${extra}${note(pitch, ties)}</Chord>`
const tieStart =
	'<Spanner type="Tie"><Tie/><next><location><fractions>1/4</fractions></location></next></Spanner>'
const tieEnd =
	'<Spanner type="Tie"><prev><location><fractions>-1/4</fractions></location></prev></Spanner>'
const score = (measures: string, version = "4.00") =>
	`<museScore version="${version}"><Score><Division>480</Division><Part><Staff id="1"/><Instrument><Channel><program value="7"/></Channel></Instrument></Part><Staff id="1">${measures}</Staff></Score></museScore>`

for (const version of ["3.02", "4.00"]) {
	it(`loads MuseScore ${version} voices, pickups, ties and tempo changes`, async () => {
		const xml = score(
			`<Measure len="1/4"><voice><TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig><Tempo><tempo>2</tempo></Tempo>${chord(60, "quarter", "", tieStart)}</voice><voice><Rest><durationType>measure</durationType></Rest></voice></Measure>
<Measure><voice><Tempo><tempo>1</tempo></Tempo>${chord(60, "half", "", tieEnd)}${chord(64, "half")}</voice><voice><location><fractions>1/4</fractions></location>${chord(67, "eighth", "<dots>1</dots>")}</voice></Measure>`,
			version
		)
		const input = file(xml)
		expect((await detectImportFile(input)).format.id).toBe("musescore")
		const notes = on(await importMusicalFile(input))
		expect(notes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					number: 60,
					startAt: 0,
					endAt: 2.5,
					channel: 1,
					patch: 7
				}),
				expect.objectContaining({ number: 64, startAt: 2.5, endAt: 4.5 }),
				expect.objectContaining({ number: 67, startAt: 1.5, endAt: 2.25 })
			])
		)
		expect(notes).toHaveLength(3)
	})
}

it("handles nested MuseScore tuplets and chord notes", async () => {
	const xml = score(
		`<Measure len="1/4"><voice><Tempo><tempo>2</tempo></Tempo><Tuplet><normalNotes>2</normalNotes><actualNotes>3</actualNotes></Tuplet><Chord><durationType>eighth</durationType>${note(60)}${note(64)}</Chord><Tuplet><normalNotes>2</normalNotes><actualNotes>3</actualNotes></Tuplet>${chord(62, "eighth")}${chord(63, "eighth")}${chord(65, "eighth")}<endTuplet/><endTuplet/></voice></Measure>`
	)
	const notes = on(await importMusicalFile(file(xml)))
	expect(notes).toHaveLength(5)
	expect(notes[0].endAt).toBeCloseTo(1 / 6, 5)
	expect(notes.at(-1)!.endAt).toBeCloseTo(0.5, 5)
})

it("handles MuseScore ID-based tuplets", async () => {
	const xml = score(
		`<Measure len="1/4"><voice><Tuplet id="1"><normalNotes>2</normalNotes><actualNotes>3</actualNotes></Tuplet>${[60, 62, 64].map((pitch) => chord(pitch, "eighth", "<Tuplet>1</Tuplet>")).join("")}</voice></Measure>`
	)
	const notes = on(await importMusicalFile(file(xml)))
	expect(notes).toHaveLength(3)
	expect(notes[2].endAt).toBeCloseTo(0.5, 5)
})

it("loads the designated MSCZ score instead of an excerpt or MusicXML", async () => {
	const xml = score(`<Measure><voice>${chord(60)}</voice></Measure>`)
	const input = file(
		zipSync({
			"META-INF/container.xml": strToU8(
				'<container><rootfiles><rootfile full-path="Main.mscx"/></rootfiles></container>'
			),
			"Main.mscx": strToU8(xml),
			"Excerpts/Part.mscx": strToU8(xml.replace("<pitch>60", "<pitch>64"))
		}),
		"score.zip"
	)
	expect((await detectImportFile(input)).format.id).toBe("musescore")
	expect(on(await importMusicalFile(input))[0].number).toBe(60)
})

it("loads an MSCZ without a container when it has one unambiguous score", async () => {
	const input = file(
		zipSync({ "Score.mscx": strToU8(score(`<Measure><voice>${chord(64)}</voice></Measure>`)) })
	)
	expect(on(await importMusicalFile(input))[0].number).toBe(64)
})

const midi = (events = "E 0 c1 07\nE 0 91 3c 60\nE 960 81 3c 00\nE 0 b1 7b 00", extra = "") =>
	`<SOURCE MIDI\nHASDATA 1 960 QN\n${events}\n${extra}\n>`
const item = (source = midi(), properties = "POSITION 0\nLENGTH 1\nLOOP 0") =>
	`<ITEM\n${properties}\n${source}\n>`
const rpp = (items = item(), tempo = "TEMPO 120 4 4", trackProperties = 'NAME "Piano"') =>
	`<REAPER_PROJECT 0.1 7.0 1\n${tempo}\n<TRACK {ID}\n${trackProperties}\n${items}\n>\n>\n`

it("loads embedded REAPER MIDI with clip placement, program, channel and track name", async () => {
	const input = file(rpp(item(midi(), "POSITION 2\nLENGTH 1\nLOOP 0")))
	expect((await detectImportFile(input)).format.id).toBe("reaper")
	expect(on(await importMusicalFile(input))).toEqual([
		expect.objectContaining({
			number: 60,
			startAt: 2,
			endAt: 2.5,
			channel: 2,
			patch: 7,
			velocity: 96,
			from: "Piano"
		})
	])
})

it("integrates a REAPER stepped tempo map across a note", async () => {
	const input = file(
		rpp(
			item(
				midi("E 0 90 3c 64\nE 1920 80 3c 00\nE 0 b0 7b 00"),
				"POSITION 0\nLENGTH 2\nLOOP 0"
			),
			"TEMPO 120 4 4\n<TEMPOENVEX\nPT 0 120 1\nPT 0.5 60 1\n>"
		)
	)
	expect(on(await importMusicalFile(input))[0]).toMatchObject({ startAt: 0, endAt: 1.5 })
})

it("integrates and inverts linear REAPER tempo ramps", async () => {
	const project = parseReaperProject(
		rpp(item(midi()), "TEMPO 120 4 4\n<TEMPOENVEX\nPT 0 120 0\nPT 2 60 1\n>")
	)
	const axis = reaperTimeAxis(project)
	expect(axis.beats(2)).toBeCloseTo(3, 8)
	for (const seconds of [0, 0.5, 1, 1.5, 2, 3]) {
		expect(axis.seconds(axis.beats(seconds))).toBeCloseTo(seconds, 8)
	}
	const notes = on(
		await importMusicalFile(
			file(
				rpp(
					item(midi("E 0 90 3c 64\nE 2880 80 3c 00"), "POSITION 0\nLENGTH 3\nLOOP 0"),
					"TEMPO 120 4 4\n<TEMPOENVEX\nPT 0 120 0\nPT 2 60 1\n>"
				)
			)
		)
	)
	expect(notes[0].endAt).toBeCloseTo(2, 8)
})

it("repeats embedded MIDI loops and clips the final note to the item end", async () => {
	const notes = on(
		await importMusicalFile(file(rpp(item(midi(), "POSITION 0\nLENGTH 1.25\nLOOP 1"))))
	)
	expect(notes.map((note) => [note.startAt, note.endAt])).toEqual([
		[0, 0.5],
		[0.5, 1],
		[1, 1.25]
	])
})

it("honors a REAPER MIDI source's fixed tempo and play rate", async () => {
	const notes = on(
		await importMusicalFile(
			file(
				rpp(
					item(
						midi(undefined, "IGNTEMPO 1 60 4 4"),
						"POSITION 1\nLENGTH 2\nPLAYRATE 2\nLOOP 0"
					)
				)
			)
		)
	)
	expect(notes[0]).toMatchObject({ startAt: 1, endAt: 1.5 })
})

it("accounts for SysEx deltas and ignores muted MIDI notes", async () => {
	const events =
		"<X 480 0\nf0AA9w==\n>\nEm 0 90 3e 64\nEm 240 80 3e 00\nE 240 90 3c 64\nE 480 80 3c 00"
	const notes = on(await importMusicalFile(file(rpp(item(midi(events))))))
	expect(notes).toHaveLength(1)
	expect(notes[0]).toMatchObject({ number: 60, startAt: 0.5, endAt: 0.75 })
})

it("does not load MIDI from muted REAPER items or tracks", async () => {
	await expect(
		importMusicalFile(file(rpp(item(midi(), "POSITION 0\nLENGTH 1\nMUTE 1"))))
	).rejects.toThrow("no importable")
	await expect(
		importMusicalFile(file(rpp(item(), "TEMPO 120", "MUTESOLO 1 0 0")))
	).rejects.toThrow("no importable")
})

it("resolves pooled embedded MIDI even when a copy has an empty HASDATA block", async () => {
	const original = midi(undefined, "POOLEDEVTS {POOL}")
	const copy = "<SOURCE MIDI\nHASDATA 1 960 QN\nPOOLEDEVTS {POOL}\n>"
	const notes = on(
		await importMusicalFile(
			file(rpp(`${item(original)}\n${item(copy, "POSITION 2\nLENGTH 1\nLOOP 0")}`))
		)
	)
	expect(notes.map((note) => [note.startAt, note.endAt])).toEqual([
		[0, 0.5],
		[2, 2.5]
	])
})

it("rejects MSCZ paths that escape the archive", async () => {
	const input = file(
		zipSync({
			"META-INF/container.xml": strToU8(
				'<container><rootfile full-path="../Main.mscx"/></container>'
			),
			"Main.mscx": strToU8(score(`<Measure><voice>${chord(60)}</voice></Measure>`))
		})
	)
	await expect(importMusicalFile(input)).rejects.toThrow("Unsafe archive path")
})

it("applies integer REAPER take transposition", async () => {
	const notes = on(
		await importMusicalFile(
			file(rpp(item(midi(), "POSITION 0\nLENGTH 1\nPLAYRATE 1 1 12\nLOOP 0")))
		)
	)
	expect(notes[0].number).toBe(72)
})

it("round-trips REAPER polyphony, names, channels, patches and velocities", async () => {
	const events = [
		{ number: 60, channel: 1, patch: 8, velocity: 90, start: 10, end: 11, from: 'Piano "A"' },
		{
			number: 64,
			channel: 1,
			patch: 8,
			velocity: 80,
			start: 10.5,
			end: 11.5,
			from: 'Piano "A"'
		},
		{ number: 36, channel: 10, patch: 0, velocity: 110, start: 10.25, end: 10.5, from: "Drums" }
	].map(
		(note) =>
			new AudioEvent(
				Object.assign(new AudioCommand(), {
					type: NOTE_ON,
					number: note.number,
					channel: note.channel,
					patch: note.patch,
					velocity: note.velocity,
					endAt: note.end,
					from: note.from
				}),
				note.start
			)
	)
	const recording = { name: "Take", duration: 12, events },
		original = JSON.stringify(recording)
	const text = createReaperFromAudioEventRecording(recording, { BPM: 120 })
	const project = parseReaperProject(text)
	expect(reaperChunks(project, "TRACK").map((track) => reaperField(track, "NAME")[0])).toEqual([
		'Piano "A"',
		"Drums"
	])
	const notes = on(await importMusicalFile(file(text)))
	expect(notes).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				number: 60,
				startAt: 0,
				endAt: 1,
				channel: 1,
				patch: 8,
				velocity: 90
			}),
			expect.objectContaining({ number: 64, startAt: 0.5, endAt: 1.5, channel: 1 }),
			expect.objectContaining({
				number: 36,
				startAt: 0.25,
				endAt: 0.5,
				channel: 10,
				velocity: 110
			})
		])
	)
	expect(JSON.stringify(recording)).toBe(original)
})

for (const [text, error] of [
	[score(`<Measure><voice>${chord(60, "unknown")}</voice></Measure>`), "duration"],
	[score(`<Measure><voice>${chord(128)}</voice></Measure>`), "Invalid note"],
	[score(`<Measure><voice>${chord(60, "quarter", "", tieEnd)}</voice></Measure>`), "tie"],
	[score(`<Measure><voice>${chord(60)}</voice></Measure>`, "2.06"), "MuseScore 3 or 4"],
	[rpp().slice(0, -3), "complete"],
	[rpp(item(midi(), "POSITION 0\nLENGTH 1\nSOFFS 0.5")), "source offset"],
	[rpp(item(midi(), "POSITION 0\nLENGTH 1\nTAKE SEL")), "active take"],
	[rpp(item('<SOURCE MIDI\nFILE "song.mid"\n>')), "embedded"],
	[rpp(item(midi("E 0 90 3c 64"))), "unterminated"],
	[rpp(item(midi("E -1 90 3c 64\nE 960 80 3c 00"))), "delta"],
	[rpp(item(midi("E 0 90 3c ff\nE 960 80 3c 00"))), "bytes"]
]) {
	it(`rejects unsupported or malformed input: ${error}`, async () => {
		await expect(importMusicalFile(file(text))).rejects.toThrow(error)
	})
}

it("includes MuseScore and REAPER in the unified picker", () => {
	for (const extension of [".mscx", ".mscz", ".rpp"]) {
		expect(IMPORT_FILE_ACCEPT.split(",")).toContain(extension)
	}
})