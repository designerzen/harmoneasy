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
	type TrackerSample
} from "audiobus/exporters/adapter-tracker"
import { createMEDFileFromAudioEventRecording } from "audiobus/exporters/adapter-med-file"
import { importTrackerFile } from "audiobus/importers/import-tracker-file"
import { foldNote, trackerTiming } from "audiobus/formats/tracker/tracker-grid"
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

const FORMAT_IDS = TRACKER_EXPORT_FORMATS.map((format) => format.id)
const SPECS = {
	med: MED_SPEC,
	mod: MOD_SPEC,
	xm: XM_SPEC,
	s3m: S3M_SPEC,
	it: IT_SPEC
} as const
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
const DISTINCT_INSTRUMENTS = 2 + new Set([36, 42, 38, 49]).size

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
const sampleMap = (chain: string, channel: number, patch: number, sample: TrackerSample) =>
	new Map([[trackerInstrumentKey({ chainId: chain, channel, patch }), sample]])
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

	it("re-imports with the recorded pitches, order, timing and separate instruments", async () => {
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
		// Each chain, and each drum sound, plays through its own instrument
		const patches = new Map<string, Set<number>>()
		imported.forEach((note, index) => {
			const owner = expected[index].owner
			const key = owner === DRUMS ? `drum ${expected[index].number}` : owner.chain
			patches.set(key, (patches.get(key) ?? new Set()).add(note.patch))
		})
		for (const used of patches.values()) {
			expect(used.size).toBe(1)
		}
		expect(patches.size).toBe(DISTINCT_INSTRUMENTS)
		expect(new Set([...patches.values()].map((used) => [...used][0])).size).toBe(
			DISTINCT_INSTRUMENTS
		)
	})

	it("carries one embedded sample per instrument and renders audible audio", async () => {
		const module = await load(bytes())
		try {
			if (format === "mod") {
				// A MOD always has 31 sample slots; the unused ones have no name
				expect(module.sampleNames().filter(Boolean)).toHaveLength(DISTINCT_INSTRUMENTS)
			} else {
				expect(module.samples).toBe(DISTINCT_INSTRUMENTS)
			}
			if (format === "xm" || format === "it") {
				expect(module.instruments).toBe(DISTINCT_INSTRUMENTS)
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
		expect(() => createTrackerModule(song, { BPM: 120 }, format)).toThrow(/instruments/)
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
		expect(module.samples).toBe(DISTINCT_INSTRUMENTS)
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