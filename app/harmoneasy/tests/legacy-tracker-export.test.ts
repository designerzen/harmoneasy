// @vitest-environment happy-dom
import { describe, expect, it } from "vitest"
import { File as NodeFile } from "node:buffer"
import createOpenMPT from "../../../packages/audiobus/node_modules/chiptune3/libopenmpt.worklet.js"
import {
	createTrackerModule,
	TRACKER_EXPORT_FORMATS,
	trackerInstrumentKey
} from "audiobus/exporters/adapter-tracker"
import {
	MTM_SPEC,
	DSM_SPEC,
	ULT_SPEC,
	C669_SPEC,
	OKT_SPEC
} from "audiobus/formats/tracker/legacy-writers"
import { EXPORT_FORMATS } from "audiobus/exporters/registry"
import { STM_SPEC, AMF_SPEC, PTM_SPEC } from "audiobus/formats/tracker/additional-writers"
import { detectImportFile } from "audiobus/importers/file-import"
import { importTrackerFile } from "audiobus/importers/import-tracker-file"
import { foldNote } from "audiobus/formats/tracker/tracker-grid"
import { NOTE_ON } from "audiobus/commands/commands"
import AudioCommand from "audiobus/commands/audio-command"
import AudioEvent from "audiobus/models/audio-event"

const SPECS = {
	mtm: MTM_SPEC,
	dsm: DSM_SPEC,
	ult: ULT_SPEC,
	"669": C669_SPEC,
	okt: OKT_SPEC,
	stm: STM_SPEC,
	amf: AMF_SPEC,
	ptm: PTM_SPEC
}
const engine = createOpenMPT()
const event = (number: number, start: number, end: number, chainId = "lead", velocity = 100) =>
	Object.assign(
		new AudioEvent(
			Object.assign(new AudioCommand(), {
				type: NOTE_ON,
				number,
				channel: 1,
				patch: 0,
				endAt: end,
				velocity,
				from: chainId
			}),
			start
		),
		{ chainId }
	)
const sampleRate = 8363
const sine = {
	name: "Captured sine",
	baseNote: 60,
	sampleRate,
	data: Float32Array.from(
		{ length: sampleRate },
		(_, index) => Math.sin((index * 2 * Math.PI * 261.625565) / sampleRate) * 0.8
	),
	loopStart: 0,
	loopLength: sampleRate
}
const samples = new Map([[trackerInstrumentKey({ chainId: "lead", channel: 1, patch: 0 }), sine]])
const notes = async (bytes: Uint8Array, name: string) =>
	(await importTrackerFile(new NodeFile([bytes], name) as unknown as File)).commands.filter(
		(command) => command.type === NOTE_ON
	)

it("rejects STM material with more than 64 distinct patterns", () => {
	const material = {
		name: "Many patterns",
		duration: 510,
		events: Array.from({ length: 65 }, (_, index) => {
			const start = index * 7.68 + (index % 64) * 0.12
			return event(60 + (index % 3), start, start + 0.06)
		})
	}
	expect(() => createTrackerModule(material, { BPM: 125 }, "stm")).toThrow(/64 distinct patterns/)
})

describe.each(Object.keys(SPECS) as (keyof typeof SPECS)[])(
	"%s native tracker export",
	(format) => {
		it("is registered for the export menu and exposes its real extension", () => {
			expect(TRACKER_EXPORT_FORMATS).toContainEqual(
				expect.objectContaining({ id: format, extension: format })
			)
			expect(EXPORT_FORMATS).toContainEqual(
				expect.objectContaining({ id: format, kind: "tracker" })
			)
		})
		it("detects exported tracker content after its extension is removed", async () => {
			const bytes = createTrackerModule(
				{ name: "Detection", duration: 2, events: [event(60, 0, 1)] },
				{ BPM: 120 },
				format
			)
			expect(
				(await detectImportFile(new NodeFile([bytes], "renamed.bin") as unknown as File))
					.format.id
			).toBe("tracker")
		})
		it("round-trips pitches, pattern order and timing through the actual decoder", async () => {
			const song = {
				name: "Across patterns",
				duration: 20,
				events: [event(60, 0, 0.5), event(64, 1, 1.5), event(67, 9, 9.5), event(69, 17, 18)]
			}
			const imported = await notes(
				createTrackerModule(song, { BPM: 120 }, format, { samples }),
				`song.${format}`
			)
			expect(imported.map((note) => note.number)).toEqual([60, 64, 67, 69])
			for (const [index, start] of [0, 1, 9, 17].entries()) {
				expect(Math.abs(imported[index].startAt - start)).toBeLessThan(0.15)
			}
		})
		it.each([48, 60, 72])(
			"embeds the supplied sample, plays MIDI %i in tune, and stops it at the note end",
			async (number) => {
				const material = {
					name: "Pitch",
					duration: 4,
					events: [event(number, 0, 1, "lead", 32), event(64, 3, 3.5)]
				}
				const bytes = createTrackerModule(material, { BPM: 120 }, format, { samples })
				const m = await engine
				const data = m._malloc(bytes.length)
				m.HEAPU8.set(bytes, data)
				const song = m._openmpt_module_create_from_memory(data, bytes.length, 0, 0, 0)
				m._free(data)
				expect(song).toBeTruthy()
				const pointer = m._malloc(44100 * 3 * 4)
				try {
					const name = (
						m as typeof m & {
							_openmpt_module_get_sample_name(song: number, sample: number): number
						}
					)._openmpt_module_get_sample_name(song, 0)
					try {
						expect(m.UTF8ToString(name)).toBe(
							format === "stm" ? "Captured sin" : "Captured sine"
						)
					} finally {
						m._openmpt_free_string(name)
					}
					const frames = m._openmpt_module_read_float_mono(
						song,
						44100,
						44100 * 3,
						pointer
					)
					const audio = new Float32Array(
						m.HEAPU8.buffer.slice(pointer, pointer + frames * 4)
					)
					const crossings: number[] = []
					for (let index = 4410; index < 35280; index++) {
						if (audio[index - 1] <= 0 && audio[index] > 0) {
							crossings.push(index)
						}
					}
					const frequency =
						((crossings.length - 1) * 44100) / (crossings.at(-1)! - crossings[0])
					expect(
						Math.abs(1200 * Math.log2(frequency / (440 * 2 ** ((number - 69) / 12))))
					).toBeLessThan(25)
					expect(audio.length).toBe(44100 * 3)
					const peak = (from: number, to: number) =>
						audio
							.subarray(Math.round(from * 44100), Math.round(to * 44100))
							.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0)
					// Empty rows must preserve a quiet note's volume, rather than resetting it to full.
					const levelRatio = peak(0.3, 0.4) / peak(0.025, 0.075)
					expect(levelRatio).toBeGreaterThan(0.95)
					expect(levelRatio).toBeLessThan(1.05)
					expect(audio.subarray(4410, 8820).some((value) => Math.abs(value) > 0.01)).toBe(
						true
					)
					expect(
						audio.subarray(110250, 123480).every((value) => Math.abs(value) < 0.005)
					).toBe(true)
				} finally {
					m._free(pointer)
					m._openmpt_module_destroy(song)
				}
			}
		)
		it("accepts its channel limit and rejects a chord that cannot fit", () => {
			const chord = (count: number) => ({
				name: "Chord",
				duration: 2,
				events: Array.from({ length: count }, (_, index) => event(60 + (index % 12), 0, 1))
			})
			expect(() =>
				createTrackerModule(chord(SPECS[format].maxChannels), { BPM: 120 }, format)
			).not.toThrow()
			expect(() =>
				createTrackerModule(chord(SPECS[format].maxChannels + 1), { BPM: 120 }, format)
			).toThrow(/notes at once/)
		})
		it("encodes both pitch boundaries and folds pitches outside its range", async () => {
			const range = SPECS[format].noteRange
			const pitches = [range[0], range[1], 0, 127]
			const material = {
				name: "Limits",
				duration: 3,
				events: pitches.map((pitch, index) => event(pitch, index * 0.5, index * 0.5 + 0.25))
			}
			const imported = await notes(
				createTrackerModule(material, { BPM: 120 }, format),
				`limits.${format}`
			)
			expect(imported.map((note) => note.number)).toEqual(
				pitches.map((pitch) => foldNote(pitch, range))
			)
		})
		it("rejects empty material", () => {
			expect(() =>
				createTrackerModule(
					{ name: "Empty", duration: 1, events: [] },
					{ BPM: 120 },
					format
				)
			).toThrow(/Record some notes/)
		})
	}
)