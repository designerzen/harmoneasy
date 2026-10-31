import { describe, expect, it } from "vitest"
import {
	parseHarmony,
	parseSections,
	DEFAULT_HARMONY,
	sectionAt,
	inferHarmony,
	chordTab,
	STRING_TUNINGS,
	fretboard
} from "../../../packages/audiobus/io/harmony"
import {
	defaultMusicTools,
	parseMusicTools,
	parseProgression
} from "../../../packages/audiobus/io/music-tools"
import {
	classicalVoicing,
	SATB_RANGES
} from "../../../packages/audiobus/tuning/classical-voice-leading"
import { TransformerChordTrack } from "../../../packages/audiobus/io/transformers/transformer-chord-track"
import { TransformerVoiceLeader } from "../../../packages/audiobus/io/transformers/transformer-voice-leader"
import { musicalCommand } from "../../../packages/audiobus/io/event-clip"
import { NOTE_ON, NOTE_OFF } from "../../../packages/audiobus/commands"

const command = (number: number, type = NOTE_ON, startAt = 0) =>
	musicalCommand({
		type,
		number,
		velocity: type === NOTE_ON ? 90 : 0,
		channel: 1,
		from: "keys",
		startAt
	})
const clock = (now = 0) => ({ now, BPM: 120 }) as any

describe("independent harmonic state", () => {
	it("migrates existing projects without inventing scale values in old chord steps", () => {
		const old = {
			version: 1,
			progression: [{ name: "C", mask: 145, root: 0, beats: 4 }],
			macros: defaultMusicTools().macros,
			grooves: []
		}
		const parsed = parseMusicTools(old)
		expect(parsed.harmony).toEqual(DEFAULT_HARMONY)
		expect(parsed.sections).toEqual([])
		expect(parsed.progression[0]).not.toHaveProperty("scale")
		expect(parseProgression([{ ...old.progression[0], scale: 1453 }])[0].scale).toBe(1453)
		expect(() => parseHarmony({ root: 12, scale: 1, chord: 1 })).toThrow()
		expect(() => parseHarmony({ root: 0, scale: 4096, chord: 1 })).toThrow()
	})
	it("validates saved song sections, wraps durations and rejects duplicate identifiers", () => {
		const a = { ...DEFAULT_HARMONY, id: "verse", name: "Verse", beats: 4, x: 0.2, y: 0.3 }
		const b = { ...a, id: "chorus", scale: 1453, chord: 137, beats: 8 }
		const sections = parseSections([a, b])
		expect(sectionAt(sections, 4)?.id).toBe("chorus")
		expect(sectionAt(sections, 12)?.id).toBe("verse")
		expect(sectionAt(sections, -1)?.id).toBe("chorus")
		expect(() => parseSections([a, a])).toThrow()
		expect(() => parseSections([{ ...a, x: Infinity }])).toThrow()
	})
	it("follows separate scales and chords and releases original pitches after harmony changes", () => {
		const scale = new TransformerChordTrack({ source: "live", follow: "scale" })
		const chord = new TransformerChordTrack({ source: "live", follow: "chord" })
		expect(scale.transform([command(62)], clock())[0].number).toBe(62)
		expect(chord.transform([command(62)], clock())[0].number).toBe(60)
		scale.setHarmony({ root: 1, scale: 2, chord: 2 })
		expect(scale.transform([command(62, NOTE_OFF, 1)], clock(1))[0].number).toBe(62)
		expect(scale.transform([command(62, NOTE_ON, 2)], clock(2))[0].number).toBe(61)
	})
})
describe("harmonic evidence and fretboards", () => {
	it("keeps compatible scale candidates and adopts a chord contained in the scale", () => {
		const notes = [60, 62, 64, 65, 67, 69, 71].map((number) => ({ number }))
		const candidates = inferHarmony(notes)
		expect(candidates.some((c) => c.name === "C Major" && c.coverage === 1)).toBe(true)
		for (const c of candidates) {
			expect(c.chord & c.scale).toBe(c.chord)
		}
		expect(inferHarmony([])).toEqual([])
	})
	it("produces playable chord positions for all supported tunings", () => {
		for (const tuning of Object.values(STRING_TUNINGS)) {
			const shape = chordTab(tuning, 145)
			let covered = 0
			shape.forEach((fret, i) => {
				if (fret === null) {
					return
				}
				expect(fret).toBeGreaterThanOrEqual(0)
				expect(fret).toBeLessThanOrEqual(4)
				covered |= 1 << ((tuning[i] + fret) % 12)
			})
			expect(covered).toBe(145)
			expect(fretboard(tuning, 145)[0]).toHaveLength(13)
		}
	})
})
describe("classical voicing", () => {
	const rules = {
		lower: 40,
		upper: 81,
		leap: 7,
		common: true,
		root: 0,
		leadingTone: true,
		parallels: true
	}
	it("enforces SATB ranges, no crossings, chord coverage, spacing and no parallel perfect intervals", () => {
		let previous: number[] = []
		for (const notes of [
			[60, 64, 67],
			[60, 65, 69],
			[59, 62, 67],
			[60, 64, 67]
		]) {
			const next = classicalVoicing(notes, previous, rules)
			expect(next).toHaveLength(4)
			next.forEach((note, i) => {
				expect(note).toBeGreaterThanOrEqual(SATB_RANGES[i][0])
				expect(note).toBeLessThanOrEqual(SATB_RANGES[i][1])
				if (i) {
					expect(note).toBeGreaterThan(next[i - 1])
				}
				if (i > 1) {
					expect(note - next[i - 1]).toBeLessThanOrEqual(12)
				}
				for (let j = 0; j < i && previous.length; j++) {
					const before = (previous[i] - previous[j]) % 12,
						after = (note - next[j]) % 12
					if ([0, 7].includes(before) && before === after) {
						expect(
							Math.sign(note - previous[i]) === Math.sign(next[j] - previous[j]) &&
								note !== previous[i]
						).toBe(false)
					}
				}
			})
			for (const note of notes) {
				expect(next.some((n) => n % 12 === note % 12)).toBe(true)
			}
			previous = next
		}
		expect(classicalVoicing([60, 64, 67], [], { ...rules, lower: 100, upper: 110 })).toEqual([])
	})
	it("generates four parts from a triad and releases every generated voice", () => {
		const transformer = new TransformerVoiceLeader({
			style: "classical",
			collect: 0,
			lower: 40
		})
		// A small collection window gathers the chord before choosing its voicing.
		transformer.setConfig("collect", 10)
		transformer.transform(
			[60, 64, 67].map((n) => command(n)),
			clock()
		)
		const starts = transformer.tick(0.02, clock(0.02))
		expect(starts.filter((c) => c.type === NOTE_ON)).toHaveLength(4)
		const ends = transformer.transform(
			[60, 64, 67].map((n) => command(n, NOTE_OFF, 1)),
			clock(1)
		)
		expect(
			ends
				.filter((c) => c.type === NOTE_OFF)
				.map((c) => c.number)
				.sort()
		).toEqual(starts.map((c) => c.number).sort())
	})
})