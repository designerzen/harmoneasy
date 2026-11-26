// @vitest-environment happy-dom
import { describe, expect, it } from "vitest"
import { File as NodeFile } from "node:buffer"
// chiptune3 is a dependency of audiobus, not the app
import createOpenMPT from "../../../packages/audiobus/node_modules/chiptune3/libopenmpt.worklet.js"
import {
	TRACKER_EXPORT_FORMATS,
	createTrackerModule,
	exportTrackerRecording,
	type TrackerExportId,
	type TrackerSample,
	type TrackerSampleSet
} from "audiobus/exporters/adapter-tracker"
import { createMEDFileFromAudioEventRecording } from "audiobus/exporters/adapter-med-file"
import { importTrackerFile } from "audiobus/importers/import-tracker-file"
import { buildTrackerSong, foldNote, trackerTiming } from "audiobus/formats/tracker/tracker-grid"
import { DRUM_VOICES, drumVoiceOf } from "audiobus/formats/tracker/tracker-drums"
import {
	chooseStorageRate,
	prepareSample,
	sampleSignature
} from "audiobus/formats/tracker/tracker-samples"
import { trackerInstrumentKey } from "audiobus/formats/tracker/tracker-types"
import { synthesiseTrackerSample, GM_FAMILIES } from "audiobus/formats/tracker/tracker-timbres"
import { MED_SPEC } from "audiobus/formats/med/med-exporter"
import { MOD_SPEC } from "audiobus/formats/tracker/mod-writer"
import { XM_SPEC } from "audiobus/formats/tracker/xm-writer"
import { S3M_SPEC } from "audiobus/formats/tracker/s3m-writer"
import { IT_SPEC } from "audiobus/formats/tracker/it-writer"
import AudioCommand from "audiobus/commands/audio-command"
import AudioEvent from "audiobus/models/audio-event"
import { NOTE_ON } from "audiobus/commands/commands"

interface OpenMPTExtra {
	HEAPU8: Uint8Array
	_malloc(size: number): number
	_free(pointer: number): void
	UTF8ToString(pointer: number): string
	_openmpt_free_string(pointer: number): void
	_openmpt_module_create_from_memory(
		a: number,
		b: number,
		c: number,
		d: number,
		e: number
	): number
	_openmpt_module_destroy(song: number): void
	_openmpt_module_get_num_samples(song: number): number
	_openmpt_module_get_num_instruments(song: number): number
	_openmpt_module_get_sample_name(song: number, index: number): number
	_openmpt_module_get_duration_seconds(song: number): number
	_openmpt_module_get_num_channels(song: number): number
	_openmpt_module_read_float_mono(song: number, rate: number, frames: number, out: number): number
}
const engine = createOpenMPT() as unknown as Promise<OpenMPTExtra>

const load = async (bytes: Uint8Array) => {
	const m = await engine
	const data = m._malloc(bytes.length)
	m.HEAPU8.set(bytes, data)
	const song = m._openmpt_module_create_from_memory(data, bytes.length, 0, 0, 0)
	m._free(data)
	if (!song) {
		throw new Error("libopenmpt could not load the module")
	}
	const text = (pointer: number) => {
		const value = m.UTF8ToString(pointer)
		m._openmpt_free_string(pointer)
		return value
	}
	return {
		samples: m._openmpt_module_get_num_samples(song),
		instruments: m._openmpt_module_get_num_instruments(song),
		channels: m._openmpt_module_get_num_channels(song),
		duration: m._openmpt_module_get_duration_seconds(song),
		sampleName: (index: number) => text(m._openmpt_module_get_sample_name(song, index)),
		sampleNames() {
			return Array.from({ length: this.samples }, (_, index) => this.sampleName(index))
		},
		/** Mono audio from the start of the song */
		render(seconds: number, rate = 44100) {
			const frames = Math.round(rate * seconds)
			const out = m._malloc(frames * 4)
			const read = m._openmpt_module_read_float_mono(song, rate, frames, out)
			const audio = new Float32Array(m.HEAPU8.buffer.slice(out, out + read * 4))
			m._free(out)
			return audio
		},
		destroy: () => m._openmpt_module_destroy(song)
	}
}

const RATE = 44100
const peak = (audio: Float32Array, fromSeconds = 0, toSeconds = Infinity) => {
	let max = 0
	const to = Math.min(audio.length, Math.floor(toSeconds * RATE))
	for (let i = Math.floor(fromSeconds * RATE); i < to; i++) {
		max = Math.max(max, Math.abs(audio[i]))
	}
	return max
}

/** Frequency from the spacing of rising zero crossings between 0.25 s and 0.9 s */
const frequency = (audio: Float32Array) => {
	const crossings: number[] = []
	for (let i = Math.floor(RATE * 0.25); i < Math.floor(RATE * 0.9); i++) {
		if (audio[i - 1] <= 0 && audio[i] > 0) {
			crossings.push(i - 1 + -audio[i - 1] / (audio[i] - audio[i - 1]))
		}
	}
	return ((crossings.length - 1) * RATE) / (crossings.at(-1)! - crossings[0])
}
const cents = (measured: number, expected: number) => 1200 * Math.log2(measured / expected)
const midiHz = (note: number) => 440 * 2 ** ((note - 69) / 12)
const rms = (data: Float32Array) =>
	Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length)

const event = (
	number: number,
	channel: number,
	patch: number,
	chainId: string,
	start: number,
	end: number,
	velocity = 100
) => {
	const command = Object.assign(new AudioCommand(), {
		type: NOTE_ON,
		number,
		channel,
		patch,
		velocity,
		endAt: end,
		from: chainId
	})
	return Object.assign(new AudioEvent(command, start), { chainId })
}

const SPECS = {
	med: MED_SPEC,
	mod: MOD_SPEC,
	xm: XM_SPEC,
	s3m: S3M_SPEC,
	it: IT_SPEC
} as const
// This fixture needs at least five voices; legacy formats with fewer voices have their own suite.
const FORMAT_IDS = TRACKER_EXPORT_FORMATS.map((format) => format.id).filter(
	(format): format is keyof typeof SPECS => format in SPECS
)
const EXPLICIT_NOTE_ENDS: readonly TrackerExportId[] = ["xm", "s3m", "it"]

// 120 BPM: four rows per beat, so a row is 0.125 s
const LEAD = { chain: "chain-lead", channel: 1, patch: 73 }
const PAD = { chain: "chain-pad", channel: 2, patch: 89 }
const DRUMS = { chain: "chain-drums", channel: 10, patch: 0 }
const FIXTURE = [
	// Two chains with different programs: a flute melody and a held pad with a chord
	[60, LEAD, 0, 0.5],
	[64, LEAD, 0.5, 1],
	[67, LEAD, 1, 1.5],
	[72, LEAD, 1.5, 2.5],
	[52, PAD, 0, 4],
	[60, PAD, 2.5, 3.5],
	[64, PAD, 2.5, 3.5],
	[67, PAD, 2.5, 3.5],
	// A channel 10 part
	[36, DRUMS, 0, 0.25],
	[42, DRUMS, 0.25, 0.375],
	[38, DRUMS, 0.5, 0.625],
	[42, DRUMS, 0.75, 0.875],
	[36, DRUMS, 1, 1.125],
	[38, DRUMS, 1.5, 1.625],
	[49, DRUMS, 2, 3]
] as const
const recording = {
	name: "Fixture",
	duration: 5,
	events: FIXTURE.map(([number, { chain, channel, patch }, start, end]) =>
		event(number, channel, patch, chain, start, end)
	)
}
// The two pitched chains each have an instrument. The drum chain plays four drum voices (kick, closed
// hat, snare, crash): formats with a keymap hold them as one kit instrument, the others as one each.
const DRUM_VOICES_PLAYED = new Set([36, 42, 38, 49].map((key) => drumVoiceOf(key).id)).size
const KEYMAP_FORMATS: readonly TrackerExportId[] = ["xm", "it"]
const DISTINCT_SAMPLES = 2 + DRUM_VOICES_PLAYED
const instrumentsFor = (format: TrackerExportId) =>
	KEYMAP_FORMATS.includes(format) ? 3 : DISTINCT_SAMPLES

const sine = (baseNote: number, name = "Captured sine"): TrackerSample => {
	// 84 frames per cycle and ten cycles per loop, so the loop is exactly periodic
	const period = 84
	const data = new Float32Array(period * 10)
	for (let i = 0; i < data.length; i++) {
		data[i] = Math.sin((2 * Math.PI * i) / period)
	}
	return {
		name,
		data,
		sampleRate: midiHz(baseNote) * period,
		baseNote,
		loopStart: 0,
		loopLength: data.length
	}
}
const sampleMap = (
	chain: string,
	channel: number,
	patch: number,
	sample: TrackerSample | TrackerSampleSet
) => new Map([[trackerInstrumentKey({ chainId: chain, channel, patch }), sample]])
/** A looped sine whose phase, and so whose data, differs for every index */
const variedSine = (index: number): TrackerSample => {
	const period = 84
	return {
		...sine(60, `Sine ${index}`),
		data: Float32Array.from({ length: period * 10 }, (_, i) =>
			Math.sin((2 * Math.PI * i) / period + index * 0.07)
		)
	}
}
/** A different timbre for each of `count` chains playing the same patch */
const distinctChains = (count: number) =>
	new Map(
		Array.from(
			{ length: count },
			(_, i) =>
				[
					trackerInstrumentKey({ chainId: `chain-${i}`, channel: 1, patch: 0 }),
					variedSine(i)
				] as const
		)
	)
const single = (note: number) => ({
	name: "Single",
	duration: 2,
	events: [event(note, 1, 0, "solo", 0, 1)]
})
/** Notes the app's tracker importer reads back. When a song has no end marker the engine reports
 * the restart row for the last few milliseconds, which the importer turns into notes, so those
 * are dropped here.
 */
const importNotes = async (bytes: Uint8Array, name: string) => {
	const module = await load(bytes)
	const { duration } = module
	module.destroy()
	const result = await importTrackerFile(new NodeFile([bytes], name) as unknown as File)
	return result.commands.filter(
		(command) => command.type === NOTE_ON && command.startAt < duration - 0.05
	)
}

describe.each(FORMAT_IDS)("%s export", (format) => {
	const bytes = () => createTrackerModule(recording, { BPM: 120 }, format)

	it("re-imports with the recorded pitches, order, timing and the right instruments", async () => {
		const imported = (await importNotes(bytes(), `fixture.${format}`))
			.map((command) => ({
				number: command.number,
				start: command.startAt,
				end: command.endAt,
				patch: command.patch
			}))
			.sort((a, b) => a.start - b.start || a.number - b.number)
		const expected = FIXTURE.map(([number, owner, start, end]) => ({
			number: foldNote(number, SPECS[format].noteRange),
			owner,
			start,
			end
		})).sort((a, b) => a.start - b.start || a.number - b.number)

		expect(imported).toHaveLength(expected.length)
		imported.forEach((note, index) => {
			expect(note.number).toBe(expected[index].number)
			expect(note.start).toBeCloseTo(expected[index].start, 1)
			if (EXPLICIT_NOTE_ENDS.includes(format)) {
				expect(note.end).toBeCloseTo(expected[index].end, 1)
			}
		})
		// Each chain plays through its own instrument. A drum chain is one kit instrument where the
		// format has a keymap and one instrument per drum voice where it does not.
		const patches = new Map<string, Set<number>>()
		imported.forEach((note, index) => {
			const owner = expected[index].owner
			const key =
				owner !== DRUMS
					? owner.chain
					: KEYMAP_FORMATS.includes(format)
						? "drums"
						: `drum ${expected[index].number}`
			patches.set(key, (patches.get(key) ?? new Set()).add(note.patch))
		})
		for (const used of patches.values()) {
			expect(used.size).toBe(1)
		}
		expect(patches.size).toBe(instrumentsFor(format))
		expect(new Set([...patches.values()].map((used) => [...used][0])).size).toBe(
			instrumentsFor(format)
		)
	})

	it("carries one sample per distinct timbre and renders audible audio", async () => {
		const module = await load(bytes())
		try {
			if (format === "mod") {
				// A MOD always has 31 sample slots; the unused ones have no name
				expect(module.sampleNames().filter(Boolean)).toHaveLength(DISTINCT_SAMPLES)
			} else {
				expect(module.samples).toBe(DISTINCT_SAMPLES)
			}
			if (format === "xm" || format === "it") {
				expect(module.instruments).toBe(instrumentsFor(format))
			}
			expect(module.channels).toBeGreaterThanOrEqual(5)
			const audio = module.render(4.8)
			expect(peak(audio)).toBeGreaterThan(0.03)
			// The kick and the first lead note start the song
			expect(peak(audio, 0, 0.2)).toBeGreaterThan(0.03)
			// Only the held pad is still sounding at the end of the held note
			expect(peak(audio, 3.6, 3.9)).toBeGreaterThan(0.005)
			// After the held note ends, the module falls quiet
			expect(peak(audio, 4.5)).toBeLessThan(0.02)
		} finally {
			module.destroy()
		}
	})

	it("uses a supplied timbre instead of the synthesised one", async () => {
		const samples = sampleMap(LEAD.chain, LEAD.channel, LEAD.patch, sine(60, "Captured piano"))
		const module = await load(createTrackerModule(recording, { BPM: 120 }, format, { samples }))
		try {
			const names = module.sampleNames()
			expect(names).toContain("Captured piano")
			expect(names).not.toContain("Pipe 74")
			expect(names.some((name) => name.startsWith("Pad "))).toBe(true)
		} finally {
			module.destroy()
		}
	})

	it.each([60, 72])("plays a supplied sine sample in tune at MIDI %i", async (note) => {
		const samples = sampleMap("solo", 1, 0, sine(60))
		const module = await load(
			createTrackerModule(single(note), { BPM: 120 }, format, { samples })
		)
		try {
			expect(Math.abs(cents(frequency(module.render(1)), midiHz(note)))).toBeLessThan(25)
		} finally {
			module.destroy()
		}
	})

	it("folds notes the format cannot reach by whole octaves", async () => {
		const [low, high] = SPECS[format].noteRange
		const requested = [Math.max(0, low - 5), Math.min(127, high + 9)]
		const song = {
			name: "Fold",
			duration: 2,
			events: requested.map((note, index) =>
				event(note, 1, 0, "solo", index * 0.5, index * 0.5 + 0.4)
			)
		}
		const imported = await importNotes(
			createTrackerModule(song, { BPM: 120 }, format),
			"fold.bin"
		)
		const numbers = imported.map((c) => c.number)
		expect(numbers).toEqual(requested.map((note) => foldNote(note, SPECS[format].noteRange)))
		for (const [index, note] of numbers.entries()) {
			expect(note).toBeGreaterThanOrEqual(low)
			expect(note).toBeLessThanOrEqual(high)
			expect(Math.abs(requested[index] - note) % 12).toBe(0)
		}
	})

	it.each([20, 90, 300])("keeps four rows per beat at %i BPM", async (bpm) => {
		const beat = 60 / bpm
		const song = {
			name: "Tempo",
			duration: 10,
			events: [
				event(60, 1, 0, "solo", 0, beat * 0.9),
				event(62, 1, 0, "solo", beat * 2, beat * 2.9),
				event(64, 1, 0, "solo", beat * 4, beat * 4.9)
			]
		}
		const imported = await importNotes(
			createTrackerModule(song, { BPM: bpm }, format),
			"tempo.bin"
		)
		const starts = imported.map((c) => c.startAt)
		expect(starts).toHaveLength(3)
		// Tracker tempos are whole numbers, so allow a few per cent of drift
		expect(starts[1] / (beat * 2)).toBeGreaterThan(0.96)
		expect(starts[1] / (beat * 2)).toBeLessThan(1.04)
		expect(starts[2] / (beat * 4)).toBeGreaterThan(0.96)
		expect(starts[2] / (beat * 4)).toBeLessThan(1.04)
	})

	it("rejects an empty recording", async () => {
		await expect(
			exportTrackerRecording({ name: "Empty", duration: 1, events: [] }, { BPM: 120 }, format)
		).rejects.toThrow("Record some notes before exporting a tracker module")
	})

	it("returns a blob from the adapter", async () => {
		const blob = await exportTrackerRecording(recording, { BPM: 120 }, format)
		expect(blob.size).toBe(bytes().length)
	})
})

describe("format limits", () => {
	const chord = (count: number) => ({
		name: "Chord",
		duration: 2,
		events: Array.from({ length: count }, (_, i) => event(40 + (i % 40), 1, 0, "solo", 0, 1))
	})

	it.each([
		["mod", 32],
		["xm", 32],
		["s3m", 32],
		["it", 64],
		["med", 64]
	] as const)("accepts up to the %s channel limit and rejects more", (format, limit) => {
		expect(() => createTrackerModule(chord(limit), { BPM: 120 }, format)).not.toThrow()
		expect(() => createTrackerModule(chord(limit + 1), { BPM: 120 }, format)).toThrow(
			/notes at once/
		)
	})

	it.each([
		["mod", 31],
		["med", 63],
		["s3m", 99],
		["it", 99],
		["xm", 128]
	] as const)("rejects more than %s instruments (%i)", (format, limit) => {
		const song = {
			name: "Many",
			duration: 2,
			events: Array.from({ length: limit + 1 }, (_, i) =>
				event(60, 1, 0, `chain-${i}`, i * 0.25, i * 0.25 + 0.2)
			)
		}
		// Chains that sound different are different instruments; ones that sound alike are not
		const samples = distinctChains(limit + 1)
		expect(() => createTrackerModule(song, { BPM: 120 }, format, { samples })).toThrow(
			/instruments/
		)
		expect(() => createTrackerModule(song, { BPM: 120 }, format)).not.toThrow()
	})

	it("uses four ProTracker channels when they are enough and an even count otherwise", async () => {
		const six = await load(createTrackerModule(chord(5), { BPM: 120 }, "mod"))
		expect(six.channels).toBe(6)
		six.destroy()
		const four = await load(createTrackerModule(chord(3), { BPM: 120 }, "mod"))
		expect(four.channels).toBe(4)
		four.destroy()
	})

	it("picks a speed and tempo that keep four rows per beat", () => {
		const limits = { minTempo: 32, maxTempo: 255, maxSpeed: 31 }
		expect(trackerTiming(120, limits)).toEqual({ speed: 6, tempo: 120 })
		const slow = trackerTiming(20, limits)
		expect(slow.tempo).toBeGreaterThanOrEqual(32)
		expect((slow.speed * 2.5) / slow.tempo).toBeCloseTo(15 / 20, 1)
		const fast = trackerTiming(400, limits)
		expect(fast.tempo).toBeLessThanOrEqual(255)
		expect((fast.speed * 2.5) / fast.tempo).toBeCloseTo(15 / 400, 2)
	})

	it("stores the identical empty patterns of a long gap once", async () => {
		const song = {
			name: "Long",
			duration: 70,
			events: [event(60, 1, 0, "solo", 0, 0.4), event(62, 1, 0, "solo", 60, 60.4)]
		}
		const bytes = createTrackerModule(song, { BPM: 120 }, "xm")
		const module = await load(bytes)
		expect(module.duration).toBeGreaterThan(60)
		module.destroy()
		// 61 s at 8 rows a second is eight patterns, but only three differ
		const patterns = new DataView(bytes.buffer, bytes.byteOffset).getUint16(70, true)
		expect(patterns).toBeLessThan(5)
	})

	it("rejects recordings too long for the order list", () => {
		const song = {
			name: "Endless",
			duration: 5000,
			events: Array.from({ length: 200 }, (_, i) =>
				event(60 + (i % 7), 1, 0, "solo", i * 25, i * 25 + 0.4)
			)
		}
		expect(() => createTrackerModule(song, { BPM: 120 }, "mod")).toThrow(/too long/)
	})
})

describe("MED adapter", () => {
	it("returns a loadable MMD1 buffer from createMEDFileFromAudioEventRecording", async () => {
		const buffer = await createMEDFileFromAudioEventRecording(recording, { BPM: 120 })
		expect(buffer).toBeInstanceOf(ArrayBuffer)
		expect(new TextDecoder().decode(new Uint8Array(buffer, 0, 4))).toBe("MMD1")
		expect(new DataView(buffer).getUint32(4, false)).toBe(buffer.byteLength)
		const module = await load(new Uint8Array(buffer))
		expect(module.samples).toBe(DISTINCT_SAMPLES)
		module.destroy()
	})

	it("accepts captured timbres as a third argument", async () => {
		const samples = sampleMap(PAD.chain, PAD.channel, PAD.patch, sine(60, "Live pad"))
		const buffer = await createMEDFileFromAudioEventRecording(
			recording,
			{ BPM: 120 },
			{ samples }
		)
		const module = await load(new Uint8Array(buffer))
		const names = module.sampleNames()
		module.destroy()
		expect(names).toContain("Live pad")
	})

	it("rejects an empty recording", async () => {
		await expect(
			createMEDFileFromAudioEventRecording(
				{ name: "x", duration: 1, events: [] },
				{ BPM: 120 }
			)
		).rejects.toThrow("Record some notes before exporting a tracker module")
	})
})

describe("synthesised timbres", () => {
	const programs = Array.from({ length: 128 }, (_, patch) =>
		synthesiseTrackerSample({ channel: 1, patch })
	)
	const range = (from: number, to: number) =>
		Array.from({ length: to - from + 1 }, (_, i) => from + i)
	// Organ, bowed strings, ensembles, brass, reeds, pipes, synth leads and synth pads keep sounding
	const SUSTAINED = [...range(16, 23), ...range(40, 44), ...range(48, 54), ...range(56, 95)]
	// Pianos, mallets, plucked strings, basses, pizzicato, harp, timpani and the orchestra hit decay
	const DECAYING = [...range(0, 15), ...range(24, 39), 45, 46, 47, 55, 98, 102, 112, 113, 114]

	it("is deterministic", () => {
		for (const patch of [0, 24, 52, 80, 96, 120]) {
			const first = synthesiseTrackerSample({ channel: 1, patch })
			const second = synthesiseTrackerSample({ channel: 1, patch })
			expect(second.name).toBe(first.name)
			expect(second.data).toEqual(first.data)
			expect(second.loopStart).toBe(first.loopStart)
		}
		expect(synthesiseTrackerSample({ channel: 10, patch: 0, number: 38 }).data).toEqual(
			synthesiseTrackerSample({ channel: 10, patch: 0, number: 38 }).data
		)
	})

	it("is finite, audible and within range for every program", () => {
		for (const [patch, sample] of programs.entries()) {
			expect(sample.sampleRate).toBeGreaterThan(0)
			expect(sample.data.length).toBeGreaterThan(100)
			expect(sample.data.length).toBeLessThan(sample.sampleRate * 3)
			let max = 0
			let finite = true
			for (const value of sample.data) {
				finite &&= Number.isFinite(value)
				max = Math.max(max, Math.abs(value))
			}
			expect(finite, `program ${patch}`).toBe(true)
			expect(max, `program ${patch}`).toBeGreaterThan(0.9)
			expect(max).toBeLessThanOrEqual(1.0001)
			expect(rms(sample.data), `program ${patch}`).toBeGreaterThan(0.01)
			expect(sample.baseNote).toBeGreaterThanOrEqual(0)
			expect(sample.baseNote).toBeLessThanOrEqual(127)
		}
	})

	it("sounds different in each General MIDI family", () => {
		const families = GM_FAMILIES.map((_, family) => programs[family * 8])
		const fingerprints = new Set(
			families.map((sample) => {
				let crossings = 0
				for (let i = 1; i < sample.data.length; i++) {
					crossings += sample.data[i - 1] <= 0 !== sample.data[i] <= 0 ? 1 : 0
				}
				return [
					sample.data.length,
					Math.round((crossings / sample.data.length) * 200),
					Math.round(rms(sample.data) * 50),
					sample.loopLength === undefined ? "one-shot" : "loop"
				].join(":")
			})
		)
		expect(fingerprints.size).toBe(16)
		for (let a = 0; a < families.length; a++) {
			for (let b = a + 1; b < families.length; b++) {
				const length = Math.min(families[a].data.length, families[b].data.length, 4000)
				let different = 0
				for (let i = 0; i < length; i++) {
					different += Math.abs(families[a].data[i] - families[b].data[i]) > 0.05 ? 1 : 0
				}
				expect(different, `${GM_FAMILIES[a]} vs ${GM_FAMILIES[b]}`).toBeGreaterThan(
					length / 4
				)
			}
		}
	})

	it("loops sustained families and leaves decaying ones one-shot", () => {
		for (const [patch, sample] of programs.entries()) {
			if (SUSTAINED.includes(patch)) {
				expect(sample.loopLength, `program ${patch}`).toBeDefined()
			}
			if (DECAYING.includes(patch)) {
				expect(sample.loopLength, `program ${patch}`).toBeUndefined()
			}
		}
	})

	it("keeps every loop inside the data, on a zero crossing, and click-free at the wrap", () => {
		for (const [patch, sample] of programs.entries()) {
			if (sample.loopLength === undefined) {
				continue
			}
			const start = sample.loopStart!
			const end = start + sample.loopLength
			expect(end, `program ${patch}`).toBe(sample.data.length)
			// Long enough to hold several cycles of the pitch it was tuned to
			expect(sample.loopLength, `program ${patch}`).toBeGreaterThan(200)
			let largestStep = 0
			for (let i = start + 1; i < end; i++) {
				largestStep = Math.max(largestStep, Math.abs(sample.data[i] - sample.data[i - 1]))
			}
			// Wrapping from the last frame to the first is one more step of the same periodic wave
			const wrapStep = Math.abs(sample.data[start] - sample.data[end - 1])
			expect(wrapStep, `program ${patch}`).toBeLessThanOrEqual(largestStep * 1.001 + 1e-6)
			// Pitched loops start on a zero; noise loops on the sample after an upward crossing
			expect(
				Math.abs(sample.data[start]) < 1e-3 ||
					(sample.data[start - 1] <= 0 && sample.data[start] > 0),
				`program ${patch}`
			).toBe(true)
		}
	})

	it("plays each drum key as its own sound at its own pitch", () => {
		const drum = (number: number) => synthesiseTrackerSample({ channel: 10, patch: 0, number })
		const kick = drum(36)
		const snare = drum(38)
		const hat = drum(42)
		const openHat = drum(46)
		const tom = drum(45)
		const crash = drum(49)
		const sounds = [kick, snare, hat, openHat, tom, crash]
		for (const [index, sound] of sounds.entries()) {
			expect(sound.loopLength).toBeUndefined()
			expect(rms(sound.data)).toBeGreaterThan(0.02)
			for (const other of sounds.slice(index + 1)) {
				expect(sound.data).not.toEqual(other.data)
			}
		}
		expect([kick, snare, hat, tom].map((sound) => sound.baseNote)).toEqual([36, 38, 42, 45])
		expect(crash.data.length).toBeGreaterThan(openHat.data.length)
		expect(openHat.data.length).toBeGreaterThan(hat.data.length)
		// Every General MIDI percussion key yields something
		for (let number = 35; number <= 87; number++) {
			expect(rms(drum(number).data), `drum ${number}`).toBeGreaterThan(0.01)
			expect(drum(number).baseNote).toBe(number)
		}
	})
})
describe("timbre reuse", () => {
	const range = (from: number, to: number) =>
		Array.from({ length: to - from + 1 }, (_, i) => from + i)
	const drumSong = (numbers: readonly number[]) => ({
		name: "Drums",
		duration: numbers.length * 0.25 + 1,
		events: numbers.map((number, i) => event(number, 10, 0, "drums", i * 0.25, i * 0.25 + 0.2))
	})
	const countSamples = (module: Awaited<ReturnType<typeof load>>, format: TrackerExportId) =>
		format === "mod" ? module.sampleNames().filter(Boolean).length : module.samples
	const note = (chainId: string, number: number, velocity: number, start: number) => ({
		chainId,
		number,
		channel: 1,
		patch: 0,
		velocity,
		start,
		duration: 0.4
	})

	describe.each(FORMAT_IDS)("%s", (format) => {
		it("fits a 47-key drum part into a few drum voice samples", async () => {
			const module = await load(
				createTrackerModule(drumSong(range(35, 81)), { BPM: 120 }, format)
			)
			try {
				const samples = countSamples(module, format)
				expect(samples).toBeGreaterThan(8)
				expect(samples).toBeLessThanOrEqual(DRUM_VOICES.length)
				expect(samples).toBeLessThan(47)
				if (KEYMAP_FORMATS.includes(format)) {
					expect(module.instruments).toBe(1)
				}
				expect(peak(module.render(12))).toBeGreaterThan(0.03)
			} finally {
				module.destroy()
			}
		})

		it("plays a kick key and a hat key as different sounds", async () => {
			const song = {
				name: "Kit",
				duration: 3,
				events: [event(36, 10, 0, "drums", 0, 0.2), event(42, 10, 0, "drums", 1, 1.1)]
			}
			const module = await load(createTrackerModule(song, { BPM: 120 }, format))
			try {
				const audio = module.render(2)
				const window = (from: number, to: number) =>
					audio.slice(Math.floor(from * RATE), Math.floor(to * RATE))
				const kick = window(0, 0.2)
				const hat = window(1, 1.1)
				expect(rms(kick)).toBeGreaterThan(0.01)
				expect(rms(hat)).toBeGreaterThan(0.002)
				// A kick is low and smooth; a hat is mostly high-frequency noise
				const brightness = (data: Float32Array) =>
					rms(data.slice(1).map((value, i) => value - data[i])) / rms(data)
				expect(brightness(hat)).toBeGreaterThan(brightness(kick) * 3)
			} finally {
				module.destroy()
			}
		})

		it("stores chains that play the same patch once", async () => {
			const chains = (count: number) => ({
				name: "Chains",
				duration: 4,
				events: Array.from({ length: count }, (_, i) =>
					event(60 + i, i % 2 ? 3 : 1, 0, `chain-${i}`, i * 0.5, i * 0.5 + 0.4)
				)
			})
			const module = await load(createTrackerModule(chains(4), { BPM: 120 }, format))
			try {
				expect(countSamples(module, format)).toBe(1)
				if (KEYMAP_FORMATS.includes(format)) {
					expect(module.instruments).toBe(1)
				}
			} finally {
				module.destroy()
			}
			// Four chains cost little more than one
			const one = createTrackerModule(chains(1), { BPM: 120 }, format).length
			expect(createTrackerModule(chains(4), { BPM: 120 }, format).length).toBeLessThan(
				one * 1.5
			)
		})

		it("uses captured drum voices for their keys and synthesises the rest", async () => {
			const set: TrackerSampleSet = {
				samples: [sine(36, "Cap kick"), sine(42, "Cap hat")],
				keymap: new Map([
					[35, 0],
					[36, 0],
					[42, 1]
				])
			}
			const song = drumSong([35, 36, 42, 38])
			const module = await load(
				createTrackerModule(song, { BPM: 120 }, format, {
					samples: sampleMap("drums", 10, 0, set)
				})
			)
			try {
				const names = module.sampleNames().filter(Boolean)
				expect(names).toContain("Cap kick")
				expect(names).toContain("Cap hat")
				expect(names).toContain("Snare 38")
				expect(names).not.toContain("Kick 36")
				// Both kick keys share the captured kick
				expect(countSamples(module, format)).toBe(3)
			} finally {
				module.destroy()
			}
		})

		it("lets a single captured sample voice only the drum it was played at", async () => {
			const module = await load(
				createTrackerModule(drumSong([36, 42]), { BPM: 120 }, format, {
					samples: sampleMap("drums", 10, 0, sine(36, "Only kick"))
				})
			)
			try {
				const names = module.sampleNames().filter(Boolean)
				expect(names).toContain("Only kick")
				expect(names).toContain("Closed hat 42")
			} finally {
				module.destroy()
			}
		})

		it("plays captured zones as one keymapped instrument or one instrument per zone", async () => {
			const zones: TrackerSampleSet = {
				samples: [sine(48, "Low zone"), sine(72, "High zone")]
			}
			const song = {
				name: "Zones",
				duration: 3,
				events: [event(50, 1, 0, "solo", 0, 0.4), event(70, 1, 0, "solo", 0.5, 0.9)]
			}
			const module = await load(
				createTrackerModule(song, { BPM: 120 }, format, {
					samples: sampleMap("solo", 1, 0, zones)
				})
			)
			try {
				expect(module.sampleNames().filter(Boolean)).toEqual(
					expect.arrayContaining(["Low zone", "High zone"])
				)
				expect(countSamples(module, format)).toBe(2)
				if (KEYMAP_FORMATS.includes(format)) {
					expect(module.instruments).toBe(1)
				}
			} finally {
				module.destroy()
			}
		})

		it.each([50, 70])("plays each zone in tune at MIDI %i", async (number) => {
			const zones: TrackerSampleSet = {
				samples: [sine(48, "Low zone"), sine(72, "High zone")]
			}
			const module = await load(
				createTrackerModule(single(number), { BPM: 120 }, format, {
					samples: sampleMap("solo", 1, 0, zones)
				})
			)
			try {
				expect(Math.abs(cents(frequency(module.render(1)), midiHz(number)))).toBeLessThan(
					25
				)
			} finally {
				module.destroy()
			}
		})
	})

	it("shares one stored sample between instruments in an IT module", async () => {
		const samples = new Map([
			[trackerInstrumentKey({ chainId: "a", channel: 1, patch: 0 }), sine(60, "Loud")],
			[
				trackerInstrumentKey({ chainId: "b", channel: 1, patch: 0 }),
				{ ...sine(60, "Quiet"), volume: 0.5 }
			]
		])
		const song = {
			name: "Shared",
			duration: 3,
			events: [event(60, 1, 0, "a", 0, 0.4), event(60, 1, 0, "b", 0.5, 0.9)]
		}
		const shared = await load(createTrackerModule(song, { BPM: 120 }, "it", { samples }))
		expect([shared.instruments, shared.samples]).toEqual([2, 1])
		shared.destroy()
		const own = await load(createTrackerModule(song, { BPM: 120 }, "xm", { samples }))
		expect([own.instruments, own.samples]).toEqual([2, 2])
		own.destroy()
	})

	it("keeps cell volumes right when instruments merge", () => {
		const song = buildTrackerSong(
			[note("a", 60, 127, 0), note("b", 62, 64, 0.5)],
			120,
			XM_SPEC,
			"Merge"
		)
		expect(song.instruments).toHaveLength(1)
		const cells = song.cells.flat().filter((cell) => cell && !cell.off)
		const { gain } = song.instruments[0]
		expect(cells).toEqual([
			{ off: false, note: 60, instrument: 1, volume: Math.round(64 * gain) },
			{ off: false, note: 62, instrument: 1, volume: Math.round((64 / 127) * 64 * gain) }
		])
	})

	it("uses zones only while the instrument limit allows", () => {
		const chains = (count: number) =>
			Array.from({ length: count }, (_, i) => [
				{ ...note(`c${i}`, 50, 100, i), duration: 0.2 },
				{ ...note(`c${i}`, 70, 100, i + 0.5), duration: 0.2 }
			]).flat()
		const samples = (count: number) =>
			new Map(
				Array.from({ length: count }, (_, i) => [
					trackerInstrumentKey({ chainId: `c${i}`, channel: 1, patch: 0 }),
					{
						samples: [
							{ ...variedSine(i), baseNote: 48 },
							{ ...variedSine(i + 100), baseNote: 72 }
						]
					} satisfies TrackerSampleSet
				])
			)
		// Fifteen chains with two zones each are thirty instruments in a MOD; twenty would be forty
		expect(
			buildTrackerSong(chains(15), 120, MOD_SPEC, "t", samples(15)).instruments
		).toHaveLength(30)
		expect(
			buildTrackerSong(chains(20), 120, MOD_SPEC, "t", samples(20)).instruments
		).toHaveLength(20)
		// A format with a keymap keeps the zones in one instrument either way
		const song = buildTrackerSong(chains(20), 120, XM_SPEC, "t", samples(20))
		expect(song.instruments).toHaveLength(20)
		expect(song.instruments.every((instrument) => instrument.samples.length === 2)).toBe(true)
	})

	it("groups every General MIDI percussion key into a voice of the kit", () => {
		expect(DRUM_VOICES.length).toBeLessThanOrEqual(16)
		for (let key = 35; key <= 87; key++) {
			expect(drumVoiceOf(key).keys, `key ${key}`).toContain(key)
			expect(DRUM_VOICES, `key ${key}`).toContain(drumVoiceOf(key))
		}
		expect(drumVoiceOf(36)).toBe(drumVoiceOf(35))
		// Closed and pedal hats are one voice; the open hat is its own
		expect(drumVoiceOf(44)).toBe(drumVoiceOf(42))
		expect(drumVoiceOf(46)).not.toBe(drumVoiceOf(42))
	})
})

describe("sample preparation", () => {
	const decaying = Float32Array.from(
		{ length: RATE * 2 },
		(_, i) => Math.sin(i * 0.05) * Math.exp((-i / RATE) * 9)
	)
	// The wave falls below -54 dB (0.002) after ln(500) / 9, about 0.69 s

	it("trims a decayed one-shot tail and fades the cut instead of clicking", () => {
		const { sample } = prepareSample({
			name: "Decay",
			data: decaying,
			sampleRate: RATE,
			baseNote: 60
		})
		expect(sample.data.length).toBeGreaterThan(RATE * 0.6)
		expect(sample.data.length).toBeLessThan(RATE * 0.8)
		expect(sample.data[sample.data.length - 1]).toBe(0)
		// Everything cut off was quieter than -54 dB
		expect(
			decaying
				.slice(sample.data.length)
				.reduce((most, value) => Math.max(most, Math.abs(value)), 0)
		).toBeLessThan(0.0021)
	})

	it("leaves a one-shot that is still sounding, and a loop, at full length", () => {
		const held = Float32Array.from({ length: RATE }, (_, i) => Math.sin(i * 0.05))
		const oneShot = prepareSample({ name: "Held", data: held, sampleRate: RATE, baseNote: 60 })
		expect(oneShot.sample.data.length).toBe(RATE)
		const looped = prepareSample(sine(60))
		expect(looped.sample.data.length).toBe(840)
		expect(looped.sample.loopLength).toBe(840)
	})

	it("stores a low sound at a low rate and a bright one at the rate it needs", () => {
		const limits = { minRate: 4000, maxRate: 22050 }
		const hum = sine(60)
		expect(chooseStorageRate(hum, 60, limits)).toBe(4000)
		let seed = 1
		const noise = Float32Array.from({ length: 22050 }, () => {
			seed = (seed * 1664525 + 1013904223) >>> 0
			return seed / 2 ** 31 - 1
		})
		const hiss: TrackerSample = { name: "Hiss", data: noise, sampleRate: 22050, baseNote: 60 }
		expect(chooseStorageRate(hiss, 60, limits)).toBe(22050)
		// Played an octave above its base note, half the audible band is out of reach
		const raised = chooseStorageRate(hiss, 72, limits)
		expect(raised).toBeLessThan(22050)
		expect(raised).toBeGreaterThan(16000)
	})

	it("fingerprints samples by their data, rate, loop and pitch", () => {
		const base = sine(60)
		expect(sampleSignature({ ...base, name: "Renamed" })).toBe(sampleSignature(base))
		expect(sampleSignature({ ...base, baseNote: 61 })).not.toBe(sampleSignature(base))
		expect(sampleSignature(variedSine(1))).not.toBe(sampleSignature(variedSine(2)))
		expect(sampleSignature({ ...base, loopStart: undefined, loopLength: undefined })).not.toBe(
			sampleSignature(base)
		)
	})
})

describe("trimming to the time played", () => {
	/** A one-shot that never decays, so only the notes played can shorten it */
	const held = (): TrackerSample => ({
		name: "Held",
		data: Float32Array.from({ length: RATE * 2 }, (_, i) => Math.sin(i * 0.05)),
		sampleRate: RATE,
		baseNote: 60
	})
	const played = (number: number, duration: number, chainId = "solo", start = 0) => ({
		chainId,
		number,
		channel: 1,
		patch: 0,
		velocity: 100,
		start,
		duration
	})
	const lengths = (
		notes: ReturnType<typeof played>[],
		spec: typeof MOD_SPEC,
		samples?: ReadonlyMap<string, TrackerSample>
	) =>
		buildTrackerSong(notes, 120, spec, "t", samples).instruments.map(
			(instrument) => instrument.samples[0].sample.data.length
		)
	const heldFor = (chainId: string) =>
		new Map([[trackerInstrumentKey({ chainId, channel: 1, patch: 0 }), held()]])

	it("trims a synthesised piano after short notes and keeps it for long ones", () => {
		const full = prepareSample(synthesiseTrackerSample({ channel: 1, patch: 0 })).sample.data
			.length
		for (const spec of [XM_SPEC, IT_SPEC, MOD_SPEC, S3M_SPEC, MED_SPEC]) {
			const [short] = lengths([played(60, 0.2)], spec)
			expect(short, spec.id).toBeLessThan(full * 0.4)
			// A held note outlasts the sample, so all of it is kept
			expect(lengths([played(60, 3)], spec), spec.id).toEqual([full])
		}
	})

	it("lets envelope formats ring through the release but cuts the others at the note end", () => {
		const [cut] = lengths([played(60, 0.5)], MOD_SPEC, heldFor("solo"))
		const [released] = lengths([played(60, 0.5)], XM_SPEC, heldFor("solo"))
		// Four rows of 0.125 s, then the release of a one-shot instrument (about 0.35 s)
		expect(cut).toBeGreaterThan(RATE * 0.5)
		expect(cut).toBeLessThan(RATE * 0.55)
		expect(released).toBeGreaterThan(RATE * 0.85)
		expect(released).toBeLessThan(RATE * 0.9)
	})

	it("fades the cut instead of ending on a click", () => {
		const [sample] = buildTrackerSong(
			[played(60, 0.5)],
			120,
			MOD_SPEC,
			"t",
			heldFor("solo")
		).instruments
		const { data } = sample.samples[0].sample
		expect(data[data.length - 1]).toBe(0)
		// The fade is a few milliseconds long and the sound before it is untouched
		expect(Math.abs(data[Math.round(RATE * 0.5)])).toBeCloseTo(
			Math.abs(Math.sin(Math.round(RATE * 0.5) * 0.05)),
			5
		)
		expect(data.length - RATE * 0.5 * 1.02).toBeLessThan(RATE * 0.011)
	})

	it("reads a sample faster for notes above its base note", () => {
		const at = (number: number) => lengths([played(number, 0.5)], MOD_SPEC, heldFor("solo"))[0]
		const base = at(60)
		expect(base).toBeGreaterThan(RATE * 0.5)
		// An octave up consumes twice the frames in the same time; an octave down, half
		expect(at(72) / base).toBeGreaterThan(1.9)
		expect(at(72) / base).toBeLessThan(2.05)
		expect(at(48) / base).toBeGreaterThan(0.45)
		expect(at(48) / base).toBeLessThan(0.55)
		// A sample is never cut below its highest note, whichever plays first
		const mixed = lengths(
			[played(72, 0.5, "solo", 0), played(48, 0.5, "solo", 1), played(60, 0.5, "solo", 2)],
			MOD_SPEC,
			heldFor("solo")
		)
		expect(mixed).toEqual([at(72)])
	})

	it("keeps the longest read of every instrument that shares a sample", () => {
		const samples = new Map([
			[trackerInstrumentKey({ chainId: "short", channel: 1, patch: 0 }), held()],
			[
				trackerInstrumentKey({ chainId: "long", channel: 1, patch: 0 }),
				{ ...held(), volume: 0.5 }
			]
		])
		const notes = [played(60, 0.25, "short", 0), played(60, 1, "long", 1)]
		const song = buildTrackerSong(notes, 120, XM_SPEC, "t", samples)
		// The two chains differ in level, so they are two instruments over one sample
		expect(song.instruments).toHaveLength(2)
		const [first, second] = song.instruments.map((instrument) => instrument.samples[0].sample)
		expect(sampleSignature(first)).toBe(sampleSignature(second))
		const [aloneShort] = lengths([notes[0]], XM_SPEC, samples)
		const [aloneLong] = lengths([notes[1]], XM_SPEC, samples)
		expect(aloneLong).toBeGreaterThan(aloneShort)
		expect(first.data.length).toBe(aloneLong)
		expect(second.data.length).toBe(aloneLong)
	})

	it("leaves a looped sample alone", () => {
		const samples = sampleMap("solo", 1, 0, sine(60))
		expect(lengths([played(60, 0.25)], XM_SPEC, samples)).toEqual([840])
	})
})

describe("MOD finetune", () => {
	it.each([48, 60, 83])(
		"tunes samples a semitone down and still plays MIDI %i in tune",
		async (number) => {
			const bytes = createTrackerModule(single(number), { BPM: 120 }, "mod", {
				samples: sampleMap("solo", 1, 0, sine(60))
			})
			// The first sample header starts at byte 20; its finetune byte follows the name and length
			expect(bytes[20 + 24]).toBe(0x08)
			const module = await load(bytes)
			try {
				expect(Math.abs(cents(frequency(module.render(1)), midiHz(number)))).toBeLessThan(
					10
				)
			} finally {
				module.destroy()
			}
			expect(
				(await importNotes(bytes, "finetune.mod")).map((command) => command.number)
			).toEqual([number])
		}
	)

	it("stores a pitched sample about 5.6% shorter than finetune 0 would", () => {
		const long: TrackerSample = {
			name: "Long",
			data: Float32Array.from({ length: RATE }, (_, i) => Math.sin(i * 0.05)),
			sampleRate: RATE,
			baseNote: 60
		}
		const bytes = createTrackerModule(
			{ name: "Long", duration: 3, events: [event(60, 1, 0, "solo", 0, 3)] },
			{ BPM: 120 },
			"mod",
			{ samples: sampleMap("solo", 1, 0, long) }
		)
		const words = new DataView(bytes.buffer, bytes.byteOffset).getUint16(20 + 22, false)
		// One second at the finetuned rate of MIDI 60: 3546894.6 / 428 * 2^(-1/12) frames
		expect(words * 2).toBeGreaterThan(7800)
		expect(words * 2).toBeLessThan(7900)
	})
})