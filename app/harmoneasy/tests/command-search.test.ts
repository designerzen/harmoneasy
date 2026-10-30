import { describe, expect, it } from "vitest"
import {
	commandSearchField,
	commandSearchScore,
	normalizeCommandSearch
} from "../source/libs/command-search"

const score = (query: string, label: string, context = "", metadata = "") =>
	commandSearchScore(
		normalizeCommandSearch(query),
		[label, context, metadata].map(commandSearchField)
	)

describe("fuzzy command search", () => {
	it("matches prefixes, initialisms and compact missing-letter queries", () => {
		for (const [query, label] of [
			["metr", "Enable metronome"],
			["sp", "Start playback"],
			["mtrnm", "Enable metronome"],
			["xprt", "Export MIDI"]
		]) {
			expect(Number.isFinite(score(query, label))).toBe(true)
		}
	})

	it("tolerates insertions, deletions, substitutions and transpositions", () => {
		for (const query of ["temppo", "tmpo", "tenpo", "temop"]) {
			expect(Number.isFinite(score(query, "Tempo"))).toBe(true)
		}
		expect(Number.isFinite(score("metronomw", "Metronome"))).toBe(true)
		expect(Number.isFinite(score("metrnomee", "Metronome"))).toBe(true)
	})

	it("ranks exact names ahead of prefixes, partial matches, metadata and typos", () => {
		expect(score("tempo", "Tempo")).toBeLessThan(score("tempo", "Tempo up"))
		expect(score("tempo", "Tempo up")).toBeLessThan(score("tempo", "Set tempo"))
		expect(score("tempo", "Set tempo")).toBeLessThan(score("tempo", "Playback", "", "tempo"))
		expect(score("tempo", "Playback", "", "tempo")).toBeLessThan(score("tempo", "Tempa"))
	})

	it("combines query words across labels, context and choices in any order", () => {
		expect(Number.isFinite(score("synt cutof", "Cutoff", "Lead / Synth"))).toBe(true)
		expect(Number.isFinite(score("minor scale", "Scale", "", "Major Minor"))).toBe(true)
		expect(score("cutoff drums", "Cutoff", "Lead / Synth")).toBe(Infinity)
	})

	it("normalizes accents, punctuation, case and whitespace", () => {
		expect(score("  CAFE—VOLUME  ", "Café volume")).toBe(score("cafe volume", "Cafe volume"))
		expect(Number.isFinite(score("clock source", "Clock", "", "clockSource"))).toBe(true)
	})

	it("rejects unrelated text and short typo guesses and preserves empty search order", () => {
		expect(score("zzzz", "Tempo")).toBe(Infinity)
		expect(score("ten", "Tempo")).toBe(Infinity)
		expect(score("no such command", "Enable metronome")).toBe(Infinity)
		expect(score("", "Tempo")).toBe(0)
		expect(score("", "Scale")).toBe(0)
	})
})