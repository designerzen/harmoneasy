// @vitest-environment happy-dom
import { describe, expect, it } from "vitest"
import { File as NodeFile } from "node:buffer"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import AudioCommand from "audiobus/commands/audio-command"
import AudioEvent from "audiobus/models/audio-event"
import { NOTE_ON, NOTE_OFF } from "audiobus/commands/commands"
import { recordingNotes, type NoteRecording } from "audiobus/formats/note-sequence"
import {
	normalizeSong,
	songBars,
	songFromRecording,
	songNotes,
	songTimeAxis,
	type SongSource
} from "audiobus/formats/song-source"
import { recordingMIDI } from "audiobus/exporters/adapter-interchange"
import { getExportFormat } from "audiobus/exporters/registry"
import { createTrackerModule, TRACKER_EXPORT_FORMATS } from "audiobus/exporters/adapter-tracker"
import { importMusicalFile, type ImportFormatId } from "audiobus/importers/file-import"
import { importTrackerFile } from "audiobus/importers/import-tracker-file"
import { createMediaImporter, loadedSongs } from "../source/services/media-import"

// @tonejs/midi is a dependency of audiobus, not the app
const { Midi } = createRequire(resolve("../../packages/audiobus/package.json"))("@tonejs/midi")
type Midi = ReturnType<typeof recordingMIDI>

const file = async (blob: Blob | Uint8Array<ArrayBuffer>, name: string) =>
	new NodeFile(
		[blob instanceof Uint8Array ? blob : new Uint8Array(await blob.arrayBuffer())],
		name
	) as unknown as File

// 3/4 at 120 BPM, 90 BPM from bar 3, then 6/8 from bar 4; every note sits on a half-beat grid.
const SONG: SongSource = {
	name: "Meter Study",
	tempos: [
		{ time: 0, bpm: 120 },
		{ time: 3, bpm: 90 }
	],
	meters: [
		{ time: 0, numerator: 3, denominator: 4 },
		{ time: 5, numerator: 6, denominator: 8 }
	],
	key: { fifths: -3, mode: "minor" },
	tracks: [
		{
			name: "Lead Flute",
			channel: 1,
			patch: 73,
			notes: [
				[60, 0, 0.5],
				[64, 1.5, 1.5],
				[67, 4, 2],
				[72, 7, 1]
			].map(([number, start, duration]) => ({
				number,
				start,
				duration,
				velocity: 90,
				channel: 1,
				patch: 73
			}))
		},
		{
			name: "Bass",
			channel: 2,
			patch: 33,
			notes: [
				[36, 0, 3],
				[43, 5, 4]
			].map(([number, start, duration]) => ({
				number,
				start,
				duration,
				velocity: 72,
				channel: 2,
				patch: 33
			}))
		}
	]
}

const exportSong = async (id: string, song = SONG) => {
	const format = getExportFormat(id)!
	return file(await format.export(song), `exported.${format.extension}`)
}
const roundTrip = async (id: string, importId: ImportFormatId, song = SONG) =>
	(await importMusicalFile(await exportSong(id, song), importId)).song

const noteSummary = (song: SongSource) =>
	songNotes(song)
		.map((note) => ({
			number: note.number,
			start: Number(note.start.toFixed(3)),
			duration: Number(note.duration.toFixed(3))
		}))
		.sort((a, b) => a.start - b.start || a.number - b.number)

function expectTiming(song: SongSource) {
	expect(song.tempos.map((tempo) => [tempo.time, tempo.bpm])).toEqual([
		[0, expect.closeTo(120, 3)],
		[expect.closeTo(3, 3), expect.closeTo(90, 3)]
	])
	expect(
		song.meters.map((meter) => [
			Number(meter.time.toFixed(3)),
			meter.numerator,
			meter.denominator
		])
	).toEqual([
		[0, 3, 4],
		[5, 6, 8]
	])
	expect(noteSummary(song)).toEqual(noteSummary(SONG))
}
const trackNames = (song: SongSource) => song.tracks.map((track) => track.name).sort()

describe("song tempo map", () => {
	it("converts between seconds, beats, ticks and bars", () => {
		const axis = songTimeAxis(SONG)
		expect(axis.beats(3)).toBe(6)
		expect(axis.beats(5)).toBeCloseTo(9)
		expect(axis.seconds(12)).toBeCloseTo(7)
		expect(axis.ticks(4, 480)).toBeCloseTo(7.5 * 480)
		expect(axis.tickSeconds(7.5 * 480, 480)).toBeCloseTo(4)
		const bars = songBars(SONG)
		expect(bars.slice(0, 5).map((bar) => [bar.start, bar.numerator, bar.denominator])).toEqual([
			[0, 3, 4],
			[3, 3, 4],
			[6, 3, 4],
			[9, 6, 8],
			[12, 6, 8]
		])
	})

	it("rejects invalid songs without changing the input", () => {
		const copy = structuredClone(SONG)
		expect(() => normalizeSong({ ...copy, tempos: [{ time: 0, bpm: -1 }] })).toThrow()
		expect(() =>
			normalizeSong({ ...copy, meters: [{ time: 0, numerator: 3, denominator: 3 }] })
		).toThrow()
		expect(() => normalizeSong({ ...copy, key: { fifths: 9, mode: "major" } })).toThrow()
		expect(() => songTimeAxis({ tempos: [{ time: 1, bpm: 120 }] })).toThrow()
		expect(copy).toEqual(SONG)
	})
})

describe("metadata round trips", () => {
	it("keeps tempo changes, meters, key and track names through MIDI", async () => {
		const song = await roundTrip("midi", "midi")
		expectTiming(song)
		expect(song.key).toEqual({ fifths: -3, mode: "minor" })
		expect(song.name).toBe("Meter Study")
		expect(trackNames(song)).toEqual(["Bass", "Lead Flute"])
		expect(song.tracks.find((track) => track.name === "Lead Flute")).toMatchObject({
			channel: 1,
			patch: 73
		})
		// Exporting the imported song again gives the same song.
		const again = await roundTrip("midi", "midi", song)
		expectTiming(again)
		expect(again.key).toEqual(song.key)
	})

	it.each([
		["rmid", "rmid"],
		["tone-json", "tone-json"],
		["musicxml", "musicxml"],
		["mxl", "mxl"],
		["mscx", "musescore"],
		["mscz", "musescore"],
		["midi-csv", "midi-csv"]
	] as const)("keeps all metadata through %s", async (id, importId) => {
		const song = await roundTrip(id, importId)
		expectTiming(song)
		expect(song.key).toEqual({ fifths: -3, mode: "minor" })
		expect(trackNames(song)).toEqual(["Bass", "Lead Flute"])
	})

	it.each([
		["dawproject", "dawproject"],
		["reaper", "reaper"]
	] as const)("keeps tempo changes, meters and track names through %s", async (id, importId) => {
		const song = await roundTrip(id, importId)
		expectTiming(song)
		expect(trackNames(song)).toEqual(["Bass", "Lead Flute"])
	})

	it.each([
		["svp", "svp"],
		["ustx", "ustx"],
		["ufdata", "ufdata"]
	] as const)("keeps tempo changes and meters through %s", async (id, importId) => {
		const melody = { ...SONG, tracks: [SONG.tracks[0]] }
		const song = await roundTrip(id, importId, melody)
		expect(song.tempos.map((tempo) => [tempo.time, tempo.bpm])).toEqual([
			[0, 120],
			[expect.closeTo(3, 3), 90]
		])
		expect(
			song.meters.map((meter) => [meter.time, meter.numerator, meter.denominator])
		).toEqual([
			[0, 3, 4],
			[expect.closeTo(5, 3), 6, 8]
		])
		expect(noteSummary(song)).toEqual(noteSummary(melody))
	})

	it("keeps note times in single-tempo formats", async () => {
		const song = await roundTrip("lmms", "lmms")
		expect(song.tempos).toEqual([{ time: 0, bpm: 120 }])
		expect(noteSummary(song)).toEqual(noteSummary(SONG))
	})

	it("places MusicXML bar lines by meter and ties notes across them", async () => {
		const xml = await (await exportSong("musicxml")).text()
		const doc = new DOMParser().parseFromString(xml, "application/xml")
		const measures = [...doc.querySelectorAll('part[id="P1"] > measure')]
		const length = (measure: Element) =>
			[...measure.children].reduce(
				(sum, el) =>
					sum +
					(["forward", "note"].includes(el.localName)
						? Number(el.querySelector("duration")?.textContent ?? 0)
						: 0),
				0
			)
		expect(measures.slice(0, 5).map(length)).toEqual([1440, 1440, 1440, 1440, 1440])
		expect(
			measures.map((measure) => {
				const time = measure.querySelector("time")
				return time
					? `${time.querySelector("beats")?.textContent}/${time.querySelector("beat-type")?.textContent}`
					: ""
			})
		).toEqual(["3/4", "", "", "6/8", ...Array(measures.length - 4).fill("")])
		expect(measures[0].querySelector("key fifths")?.textContent).toBe("-3")
		// G4 from 4 s to 6 s crosses the 6/8 bar line at 5 s.
		expect(measures[2].querySelector('tie[type="start"]')).not.toBeNull()
		expect(measures[3].querySelector('tie[type="stop"]')).not.toBeNull()
	})

	it("places MuseScore bar lines by meter", async () => {
		const xml = await (await exportSong("mscx")).text()
		const doc = new DOMParser().parseFromString(xml, "application/xml")
		const measures = [...doc.querySelector("Score > Staff")!.children]
		expect(
			measures.map((measure) => {
				const signature = measure.querySelector("TimeSig")
				return signature
					? `${signature.querySelector("sigN")?.textContent}/${signature.querySelector("sigD")?.textContent}`
					: ""
			})
		).toEqual(["3/4", "", "", "6/8", ...Array(measures.length - 4).fill("")])
	})
})

describe("recording songs", () => {
	const events: AudioEvent[] = []
	const add = (number: number, channel: number, patch: number, start: number, end: number) => {
		for (const [type, at] of [
			[NOTE_ON, start],
			[NOTE_OFF, end]
		] as const) {
			const command = Object.assign(new AudioCommand(), {
				type,
				number,
				channel,
				patch,
				startAt: at,
				velocity: type === NOTE_ON ? 100 : 0,
				from: "Keys",
				chainId: `chain-${channel}`
			})
			events.push(new AudioEvent(command, at))
		}
	}
	add(60, 1, 4, 10, 10.5)
	add(64, 1, 4, 10.5, 11.25)
	add(48, 2, 32, 10, 12)
	add(67, 1, 4, 11.25, 11.3)
	const recording: NoteRecording = { name: "Take", duration: 12, events }

	/** recordingMIDI before songs: one track per channel and program at the timer's tempo */
	function previousMIDI(timer: { BPM: number }) {
		const midi = new Midi()
		midi.header.name = recording.name
		midi.header.setTempo(timer.BPM)
		const tracks = new Map<string, ReturnType<Midi["addTrack"]>>()
		for (const note of recordingNotes(recording, { sources: true })) {
			const key = `${note.channel}:${note.patch}`
			let track = tracks.get(key)
			if (!track) {
				track = midi.addTrack()
				track.channel = note.channel - 1
				track.instrument.number = note.patch
				track.name = `${note.source ?? recording.name} ${note.channel}`
				tracks.set(key, track)
			}
			track.addNote({
				midi: note.number,
				time: note.start,
				duration: note.duration,
				velocity: note.velocity / 127
			})
		}
		return midi
	}
	const describeMIDI = (midi: Midi) => ({
		name: midi.header.name,
		tempos: midi.header.tempos.map((tempo) => tempo.bpm),
		tracks: midi.tracks
			.filter((track) => track.notes.length)
			.map((track) => ({
				name: track.name,
				channel: track.channel,
				patch: track.instrument.number,
				notes: track.notes.map((note) => [
					note.midi,
					note.ticks,
					note.durationTicks,
					Math.round(note.velocity * 127)
				])
			}))
	})

	it("matches the previous single-tempo output", () => {
		const timer = { BPM: 96 }
		const song = songFromRecording(recording, timer)
		expect(song.tempos).toEqual([{ time: 0, bpm: 96 }])
		expect(song.meters).toEqual([{ time: 0, numerator: 4, denominator: 4 }])
		expect(
			songNotes(song).map(({ source, chainId, ...note }) => ({ ...note, source, chainId }))
		).toEqual(recordingNotes(recording, { sources: true, chains: true }))
		const current = describeMIDI(new Midi(recordingMIDI(recording, timer).toArray()))
		const previous = describeMIDI(new Midi(previousMIDI(timer).toArray()))
		expect(current.name).toBe(previous.name)
		expect(current.tempos).toEqual(previous.tempos)
		expect(current.tracks.map(({ notes, ...track }) => track)).toEqual(
			previous.tracks.map(({ notes, ...track }) => track)
		)
		for (const [index, track] of current.tracks.entries()) {
			expect(track.notes).toHaveLength(previous.tracks[index].notes.length)
			for (const [noteIndex, [number, ticks, length, velocity]] of track.notes.entries()) {
				const expected = previous.tracks[index].notes[noteIndex]
				expect([number, velocity]).toEqual([expected[0], expected[3]])
				expect(Math.abs(ticks - expected[1])).toBeLessThanOrEqual(1)
				expect(Math.abs(length - expected[2])).toBeLessThanOrEqual(1)
			}
		}
	})

	it("exports a recording through the song-based registry", async () => {
		const song = songFromRecording(recording, { BPM: 120 })
		const format = getExportFormat("midi")!
		const imported = (
			await importMusicalFile(await file(await format.export(song), "take.mid"), "midi")
		).song
		expect(noteSummary(imported)).toEqual(noteSummary(song))
		expect(trackNames(imported)).toEqual(["Keys 1", "Keys 2"])
	})
})

describe("tracker import", () => {
	const note = (number: number, start: number, end: number) => {
		const command = Object.assign(new AudioCommand(), {
			type: NOTE_ON,
			number,
			channel: 1,
			patch: 0,
			velocity: 100,
			endAt: end,
			from: "lead"
		})
		return Object.assign(new AudioEvent(command, start), { chainId: "lead" })
	}
	const imported = async (bytes: Uint8Array<ArrayBuffer>, name: string) =>
		(await importTrackerFile(await file(bytes, name))).commands
			.filter((command) => command.type === NOTE_ON)
			.map((command) => [command.number, command.startAt])
	// Whole samples per tick make tracker rows run about 0.4% fast at the importer's 8 kHz.
	const expectNotes = (actual: number[][], expected: number[][]) => {
		expect(actual.map(([number]) => number)).toEqual(expected.map(([number]) => number))
		for (const [index, [, start]] of expected.entries()) {
			expect(Math.abs(actual[index][1] - start)).toBeLessThan(0.1)
		}
	}

	it.each(TRACKER_EXPORT_FORMATS.map((format) => format.id))(
		"adds no restart notes at the end of a %s module",
		async (format) => {
			const recording = {
				name: "Tune",
				duration: 2,
				events: [note(60, 0, 0.5), note(64, 0.5, 1), note(67, 1, 2)]
			}
			const bytes = createTrackerModule(recording, { BPM: 120 }, format)
			expectNotes(await imported(bytes, `tune.${format}`), [
				[60, 0],
				[64, 0.5],
				[67, 1]
			])
		}
	)

	// Three 64-row MOD patterns at 120 BPM, eight seconds each
	const threePatterns = () => {
		const bytes = createTrackerModule(
			{
				name: "Jumps",
				duration: 24,
				events: [note(60, 0, 0.5), note(62, 1, 1.5), note(64, 8, 8.5), note(65, 16, 16.5)]
			},
			{ BPM: 120 },
			"mod"
		)
		const signature = new TextDecoder().decode(bytes.subarray(1080, 1084))
		const channels = signature === "M.K." ? 4 : Number(/^\d+/.exec(signature)?.[0])
		expect(channels).toBeGreaterThan(0)
		expect([...bytes.subarray(952, 952 + bytes[950])]).toEqual([0, 1, 2])
		const cell = (pattern: number, row: number, channel: number) =>
			1084 + pattern * 64 * channels * 4 + (row * channels + channel) * 4
		return { bytes, channels, cell }
	}

	it("follows an order jump", async () => {
		const { bytes, channels, cell } = threePatterns()
		const at = cell(0, 4, channels - 1)
		expect([bytes[at + 2] & 0x0f, bytes[at + 3]]).toEqual([0, 0])
		// B02 on row 4 jumps to order 2, skipping the rest of pattern 0 and all of pattern 1.
		bytes[at + 2] |= 0x0b
		bytes[at + 3] = 2
		expectNotes(await imported(bytes, "jump.mod"), [
			[60, 0],
			[65, 0.625]
		])
	})

	it("follows a repeated pattern in the order list", async () => {
		const { bytes } = threePatterns()
		bytes.set([0, 1, 0], 952)
		expectNotes(await imported(bytes, "repeat.mod"), [
			[60, 0],
			[62, 1],
			[64, 8],
			[60, 16],
			[62, 17]
		])
	})
})

describe("loaded songs", () => {
	it("export without the recorder, on the chain that loaded them", async () => {
		const chain = { inputs: [] as object[], options: { name: "Piano chain" } }
		const manager = {
			activeChain: chain,
			deviceOptions: {},
			addDevice: (target: typeof chain, input: object) => target.inputs.push(input),
			entries: [["chain-7", chain]]
		}
		await createMediaImporter(manager as never)(await exportSong("midi"))
		const [loaded] = loadedSongs(manager as never)
		expect(loaded).toMatchObject({
			name: "Meter Study",
			chain: "Piano chain",
			chainId: "chain-7"
		})
		expect(songNotes(loaded.song).every((note) => note.chainId === "chain-7")).toBe(true)
		const format = getExportFormat("midi")!
		const song = (
			await importMusicalFile(
				await file(await format.export(loaded.song), "loaded.mid"),
				"midi"
			)
		).song
		expectTiming(song)
		expect(song.key).toEqual({ fifths: -3, mode: "minor" })
		expect(trackNames(song)).toEqual(["Bass", "Lead Flute"])
	})
})