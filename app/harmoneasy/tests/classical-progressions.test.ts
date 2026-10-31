import { describe, expect, it } from "vitest"
import {
	CLASSICAL_CONCEPTS,
	parseTheoryProgression,
	classicalBridgeRecipe,
	inferChord,
	diatonicTriads
} from "../../../packages/audiobus/tuning/classical-progressions"
import {
	voiceProgressionChord,
	voiceTheoryPath
} from "../../../packages/audiobus/tuning/progression-voicing"
import { melodicMediation } from "../../../packages/audiobus/tuning/melodic-mediation"
import { mod12 } from "../../../packages/audiobus/tuning/pitch-class-set"

describe("classical progression theory", () => {
	it("parses Roman qualities, durations, inversions and named slash chords", () => {
		const chords = parseTheoryProgression("I:4 vi:2 ii6 V7 I6/4 Cmaj7/E Dm/F")
		expect(chords.map((chord) => chord.pcs)).toEqual([
			[0, 4, 7],
			[0, 4, 9],
			[2, 5, 9],
			[2, 5, 7, 11],
			[0, 4, 7],
			[0, 4, 7, 11],
			[2, 5, 9]
		])
		expect(chords.map((chord) => chord.bass)).toEqual([0, 9, 5, 7, 7, 4, 5])
		expect(chords[0].beats).toBe(4)
		expect(chords[1].beats).toBe(2)
	})
	it("uses diatonic major sevenths on I/IV and dominant sevenths on V", () => {
		expect(parseTheoryProgression("I7 IV7 V7").map((chord) => chord.pcs)).toEqual([
			[0, 4, 7, 11],
			[0, 4, 5, 9],
			[2, 5, 7, 11]
		])
	})
	it("raises the harmonic-minor leading tone and distinguishes diminished and half-diminished sevenths", () => {
		const chords = parseTheoryProgression("i iiø65 V7 vii°7 VII", 0, "minor")
		expect(chords.map((chord) => chord.pcs)).toEqual([
			[0, 3, 7],
			[0, 2, 5, 8],
			[2, 5, 7, 11],
			[2, 5, 8, 11],
			[2, 5, 10]
		])
		expect(chords[1].bass).toBe(5)
		expect(parseTheoryProgression("viiø7")[0].pcs).toEqual([2, 5, 9, 11])
	})
	it("resolves applied chords recursively and parses seventh inversions", () => {
		const chords = parseTheoryProgression("V7/ii V65/ii V7/V/V vii°7/V V4/3 V4/2")
		expect(chords.map((chord) => chord.root)).toEqual([9, 9, 9, 6, 7, 7])
		expect(chords[1].bass).toBe(1)
		expect(chords[4].bass).toBe(2)
		expect(chords[5].bass).toBe(5)
	})
	it("spells the Neapolitan first inversion and all three augmented-sixth collections", () => {
		const chords = parseTheoryProgression("bII6 It+6 Fr+6 Ger+6")
		expect(chords.map((chord) => chord.pcs)).toEqual([
			[1, 5, 8],
			[0, 6, 8],
			[0, 2, 6, 8],
			[0, 3, 6, 8]
		])
		expect(chords.map((chord) => chord.bass)).toEqual([5, 8, 8, 8])
		const german = classicalBridgeRecipe("german-sixth", [60, 64, 67], [60, 64, 67], "major")
		expect(german.chords.map((chord) => chord.label)).toEqual(["Ger+6", "I64", "V7"])
		expect(german.chords[1].bass).toBe(7)
	})
	it("spells deceptive and half-cadence preparations relative to the actual destination", () => {
		expect(
			classicalBridgeRecipe("deceptive", [60, 64, 67], [57, 60, 64], "major").chords[0].root
		).toBe(7)
		expect(
			classicalBridgeRecipe("deceptive", [60, 63, 67], [56, 60, 63], "minor").chords[0].root
		).toBe(7)
		const half = classicalBridgeRecipe("phrygian-half", [60, 63, 67], [55, 59, 62], "major")
		expect(half.chords[0]).toMatchObject({ pcs: [0, 5, 8], bass: 8 })
	})
	it("finds actual shared diatonic pivots and exposes fallbacks for unsupported interpretations", () => {
		const pivot = classicalBridgeRecipe("pivot", [60, 64, 67], [55, 59, 62], "major")
		const shared = pivot.chords[0].pcs.join()
		expect(diatonicTriads(0, "major").some((chord) => chord.pcs.join() === shared)).toBe(true)
		expect(diatonicTriads(7, "major").some((chord) => chord.pcs.join() === shared)).toBe(true)
		expect(
			classicalBridgeRecipe("half", [60, 64, 67], [60, 63, 67], "minor").message
		).toContain("needs a major")
		expect(
			classicalBridgeRecipe("enharmonic-diminished", [60, 64, 67], [61, 65, 68], "major")
				.message
		).toContain("do not share")
		expect(
			classicalBridgeRecipe("common-tone-modulation", [60, 64, 67], [61, 65, 68], "major")
				.message
		).toContain("No common")
	})
	it.each(CLASSICAL_CONCEPTS.map((concept) => [concept.id]))(
		"builds bounded, valid major and minor preparations for %s",
		(id) => {
			for (const mode of ["major", "minor"] as const) {
				const plan = classicalBridgeRecipe(
					String(id),
					[60, 64, 67],
					mode === "minor" ? [62, 65, 69] : [61, 65, 68],
					mode
				)
				expect(plan.chords.length).toBeGreaterThan(0)
				expect(plan.chords.length).toBeLessThanOrEqual(12)
				for (const chord of plan.chords) {
					expect(
						chord.pcs.every((pc) => Number.isInteger(pc) && pc >= 0 && pc < 12)
					).toBe(true)
					expect(chord.pcs).toContain(chord.bass)
				}
			}
		}
	)
	it("recognizes inverted triads and rejects ambiguous clusters as uniquely identified harmony", () => {
		expect(inferChord([64, 67, 72])).toMatchObject({ root: 0, mode: "major", recognized: true })
		expect(inferChord([60, 61, 66])).toMatchObject({ recognized: false })
	})
	it("honours explicit destination roots instead of replacing them with detected triad roots", () => {
		expect(inferChord([60, 64, 67], 5)).toMatchObject({ root: 5, recognized: false })
		expect(inferChord([64, 67, 72], 0)).toMatchObject({ root: 0, recognized: true })
		expect(inferChord([])).toMatchObject({ root: 0, recognized: false })
	})
	it.each(["", "VIII", "I:0", "I:NaN", "V/banana", "C/F#", "V7/V/V/V/V", "nonsense", "I:1:2"])(
		"rejects invalid progression %s",
		(text) => {
			expect(() => parseTheoryProgression(text)).toThrow()
		}
	)
	it("preserves chord pitch classes and inversion bass in smooth voicings", () => {
		for (const chord of parseTheoryProgression("ii6 bII6 I64 V65 It+6 Fr+6 Ger+6")) {
			const voiced = voiceProgressionChord(chord, [48, 55, 64, 72], 36, 84, "smooth")
			expect(voiced.length).toBeGreaterThan(0)
			expect(mod12(voiced[0])).toBe(chord.bass)
			expect([...new Set(voiced.map(mod12))].sort((a, b) => a - b)).toEqual(chord.pcs)
			expect(
				voiced.every(
					(pitch, i) => pitch >= 36 && pitch <= 84 && (!i || pitch > voiced[i - 1])
				)
			).toBe(true)
		}
	})
	it("applies SATB ranges/spacing and returns no voicing when the range is impossible", () => {
		const chord = parseTheoryProgression("I")[0]
		const voiced = voiceProgressionChord(chord, [], 36, 84, "classical")
		expect(voiced).toHaveLength(4)
		expect(voiced[0]).toBeGreaterThanOrEqual(40)
		expect(voiced[3]).toBeLessThanOrEqual(81)
		expect(voiceTheoryPath([chord], [], 60, 61, "classical")).toEqual([])
	})
	it("connects melodies with actual diatonic or chromatic passing notes and retains exact chromatic destinations", () => {
		expect(
			melodicMediation([60], [67], "diatonic", 0, "major", 0.5, 1).steps.map(
				(step) => step.notes
			)
		).toEqual([[62], [64], [65], [67]])
		expect(
			melodicMediation([60], [64], "chromatic", 0, "major", 0.5, 1).steps.map(
				(step) => step.notes
			)
		).toEqual([[61], [62], [63], [64]])
		expect(
			melodicMediation([60], [66], "diatonic", 0, "major", 0.5, 1).steps.at(-1)!.notes
		).toEqual([66])
	})
	it("requires real preparation for a suspension and resolves 4–3 above the new bass", () => {
		const prepared = melodicMediation(
			[55, 60, 65],
			[60, 67, 76],
			"suspension",
			0,
			"major",
			1,
			1
		)
		expect(prepared.steps).toHaveLength(1)
		const valid = melodicMediation([60, 65, 77], [60, 67, 76], "suspension", 0, "major", 1, 1)
		expect(valid.steps.map((step) => step.notes)).toEqual([
			[60, 65, 77],
			[60, 67, 77],
			[60, 67, 76]
		])
		expect(valid.steps[1].notes.at(-1)! - valid.steps[2].notes.at(-1)!).toBe(1)
	})
	it("bounds long passing paths without silently dropping the target", () => {
		const path = melodicMediation([0], [127], "chromatic", 0, "major", 1, 1, 8)
		expect(path.steps).toHaveLength(1)
		expect(path.steps[0].notes).toEqual([127])
		expect(path.message).toContain("exceeds")
	})
})