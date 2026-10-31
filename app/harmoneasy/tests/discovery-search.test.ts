import { expect, it } from "vitest"
import { discoveryMatches } from "../source/components/graph/discovery-search"
import { choiceMatches } from "../source/components/graph/device-filters"

it("supports typos, transpositions, accents and terms across fields", () => {
	expect(discoveryMatches("arpegiator", "Arpeggiator")).toBe(true)
	expect(discoveryMatches("chrod midi", "Chord pads", "MIDI controller")).toBe(true)
	expect(discoveryMatches("cafe", "Café")).toBe(true)
	expect(discoveryMatches("midi2 native", "midi2-native")).toBe(true)
	expect(discoveryMatches("", "anything")).toBe(true)
	expect(discoveryMatches("no such sound", "Soft Echo Trail")).toBe(false)
	expect(discoveryMatches("cc", "acoustic")).toBe(false)
})

it("combines fuzzy discovery with strict classification filters", () => {
	const choice = {
		id: "step-sequencer",
		name: "Step Sequencer",
		description: "Melody patterns",
		category: "Sequencing",
		type: "generator" as const,
		subtype: "sequencer" as const
	}
	expect(choiceMatches(choice, "sequncer melody", "category:sequencing")).toBe(true)
	expect(choiceMatches(choice, "sequncer", "type:controller")).toBe(false)
	expect(choiceMatches(choice, "step sequencer", "subtype:sequencer")).toBe(true)
})