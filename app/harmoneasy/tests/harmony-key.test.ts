import { describe, expect, it } from "vitest"
import {
	DEFAULT_HARMONY,
	constrainNoteToHarmony,
	harmonyFromKey,
	keyFromHarmony,
	parseHarmony
} from "../../../packages/audiobus/io/harmony"
import { pitchClasses } from "../../../packages/audiobus/tuning/pitch-class-set"

describe("harmonyFromKey", () => {
	it("matches the default C major harmony", () => {
		expect(harmonyFromKey("C", "MAJOR_SCALE")).toEqual(DEFAULT_HARMONY)
		expect(harmonyFromKey()).toEqual(DEFAULT_HARMONY)
	})

	it("builds absolute masks from a tonic and a scale name", () => {
		const aMinor = harmonyFromKey("A", "NATURAL_MINOR_SCALE")
		expect(aMinor.root).toBe(9)
		expect(pitchClasses(aMinor.scale)).toEqual([0, 2, 4, 5, 7, 9, 11])
		expect(pitchClasses(aMinor.chord)).toEqual([0, 4, 9])
		const gMajor = harmonyFromKey("G", "MAJOR_SCALE")
		expect(pitchClasses(gMajor.scale)).toEqual([0, 2, 4, 6, 7, 9, 11])
		expect(pitchClasses(gMajor.chord)).toEqual([2, 7, 11])
		expect(parseHarmony(gMajor)).toEqual(gMajor)
	})

	it("accepts numeric tonics, scale arrays and an explicit chord", () => {
		expect(harmonyFromKey(10, [0, 2, 4, 7, 9]).root).toBe(10)
		expect(harmonyFromKey(1, "PENTATONIC_MAJOR_SCALE").scale).toBe(
			harmonyFromKey("Db", [0, 2, 4, 7, 9]).scale
		)
		expect(harmonyFromKey("C", "MAJOR_SCALE", 137).chord).toBe(137)
		expect(() => harmonyFromKey("C", "MAJOR_SCALE", 5000)).toThrow()
	})

	it("treats free range as the whole chromatic scale", () => {
		const free = harmonyFromKey("free-range")
		expect(free.scale).toBe(4095)
		expect(harmonyFromKey("D", "CHROMATIC_SCALE").scale).toBe(4095)
		expect(pitchClasses(free.chord)).toEqual([0, 4, 7])
	})
})

describe("keyFromHarmony", () => {
	it("reads the tonic and scale back", () => {
		expect(keyFromHarmony(harmonyFromKey("Bb", "MIXOLYDIAN_SCALE"))).toMatchObject({
			tonic: "Bb",
			root: 10,
			scaleName: "MIXOLYDIAN_SCALE",
			scale: [0, 2, 4, 5, 7, 9, 10],
			freeRange: false
		})
		expect(keyFromHarmony(harmonyFromKey("A", "NATURAL_MINOR_SCALE"))).toMatchObject({
			tonic: "A",
			scaleName: "NATURAL_MINOR_SCALE"
		})
	})

	it("round trips every named scale that is sorted", () => {
		for (const name of [
			"MAJOR_SCALE",
			"HARMONIC_MINOR_SCALE",
			"BLUES_SCALE",
			"WHOLE_TONE_SCALE"
		]) {
			for (let root = 0; root < 12; root++) {
				const key = keyFromHarmony(harmonyFromKey(root, name))
				expect(key.root).toBe(root)
				expect(key.scaleName).toBe(name)
			}
		}
	})

	it("reports free range for a full scale and omits the name for unknown scales", () => {
		expect(keyFromHarmony(harmonyFromKey("free-range"))).toMatchObject({
			tonic: "free-range",
			freeRange: true,
			scaleName: "CHROMATIC_SCALE"
		})
		expect(keyFromHarmony({ root: 0, scale: 0b101, chord: 1 }).scaleName).toBeUndefined()
	})
})

describe("constrainNoteToHarmony", () => {
	const cMajor = harmonyFromKey("C", "MAJOR_SCALE")

	it("keeps notes that are in the scale", () => {
		expect(
			[60, 62, 64, 65, 67, 69, 71, 72].map((n) => constrainNoteToHarmony(n, cMajor))
		).toEqual([60, 62, 64, 65, 67, 69, 71, 72])
	})

	it("moves other notes to the nearest scale note, lower on a tie", () => {
		expect(constrainNoteToHarmony(61, cMajor)).toBe(60)
		expect(constrainNoteToHarmony(63, cMajor)).toBe(62)
		expect(constrainNoteToHarmony(66, cMajor)).toBe(65)
		expect(constrainNoteToHarmony(70, cMajor)).toBe(69)
		const aMinorPentatonic = harmonyFromKey("A", "PENTATONIC_MINOR_SCALE")
		expect(constrainNoteToHarmony(66, aMinorPentatonic)).toBe(67)
	})

	it("leaves everything alone in free range or with an empty scale, and stays within MIDI range", () => {
		const free = harmonyFromKey("free-range")
		expect(constrainNoteToHarmony(61, free)).toBe(61)
		expect(constrainNoteToHarmony(61, { root: 0, scale: 0, chord: 0 })).toBe(61)
		expect(constrainNoteToHarmony(1, harmonyFromKey("C", "MAJOR_SCALE"))).toBe(0)
		const onlyD = { root: 2, scale: 1 << 2, chord: 1 << 2 }
		expect(constrainNoteToHarmony(127, onlyD)).toBe(122)
		expect(constrainNoteToHarmony(0, onlyD)).toBe(2)
	})
})