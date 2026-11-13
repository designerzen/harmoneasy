import type { PresetSetup, TransformerPreset } from "audiobus/io/preset-library"
import { INPUT_DEFINITIONS } from "audiobus/io/input-definitions"
import { OUTPUT_DEFINITIONS } from "audiobus/io/output-definitions"
import { publishedPreset } from "../../services/preset-files"

export interface PresetTag {
	id: string
	label: string
	group: string
}

const STYLES: Record<string, string> = {
	Chordifier: "Chords",
	"Voice-Leader": "Chords",
	"Chord-Bloom": "Chords",
	Arpeggiator: "Arpeggios",
	Strummer: "Strummed",
	Harp: "Strummed",
	"Chord-Arp": "Arpeggios",
	"Chord-Pattern": "Rhythmic",
	Harmoniser: "In key",
	"Note-Reverb": "Echoes",
	"Note-Delay": "Echoes",
	"Melody-Shadow": "Countermelodies",
	"Rhythm-Weave": "Rhythmic",
	"Euclidean-Gate": "Rhythmic",
	"Note-Repeater": "Rhythmic",
	"Register-Orbit": "Evolving",
	"Probability-Gate": "Generative",
	Randomiser: "Generative"
}

export function presetTags(item: TransformerPreset | PresetSetup): PresetTag[] {
	const published = "steps" in item ? publishedPreset(item.id) : undefined
	const workspace = "chains" in item ? item : published?.page.workspace
	const steps = "steps" in item ? item.steps : item.chains.flatMap((chain) => chain.steps)
	const tags = new Map<string, PresetTag>()
	const add = (group: string, value: string, label = value) => {
		const id = `${group.toLowerCase()}:${value.toLowerCase()}`
		tags.set(id, { id, label, group })
	}
	for (const device of workspace?.devices ?? []) {
		const { factory, type, options } = device.definition
		if (factory === "external") {
			continue
		}
		if (device.direction === "input") {
			add(
				"Inputs",
				type ?? factory,
				factory === "keyboard-input"
					? "Onscreen keyboard"
					: (INPUT_DEFINITIONS[type ?? ""]?.name ?? type ?? factory)
			)
		} else {
			add(
				"Sounds",
				type ?? factory,
				factory === "polyphonic"
					? "PolySynth"
					: (OUTPUT_DEFINITIONS[type ?? ""]?.name ?? type ?? factory)
			)
			if (factory === "polyphonic" && Number(options?.attack) >= 0.5) {
				add("Styles", "Pads")
			}
		}
	}
	const allSteps =
		published && published.page.catalogue?.kind !== "chain"
			? (workspace?.chains ?? []).flatMap((chain: Record<string, any>) =>
					JSON.parse(chain.transformers).map((value: string | Record<string, any>) =>
						typeof value === "string" ? JSON.parse(value) : value
					)
				)
			: steps
	for (const step of allSteps) {
		const style = STYLES[step.type]
		if (style) {
			add("Styles", style)
		}
		if (step.type === "Transposer" && Number((step.config ?? step).distance) <= -12) {
			add("Styles", "Bass")
		}
	}
	if ((workspace?.chains.length ?? 0) > 1) {
		add("Styles", "Layered")
	}
	for (const tag of published?.page.catalogue?.tags ?? []) {
		add("Tags", tag.trim(), tag.trim())
	}
	return [...tags.values()]
}