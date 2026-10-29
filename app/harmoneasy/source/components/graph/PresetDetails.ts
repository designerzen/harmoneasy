import { element, icon } from "./dom"
import { elementDescription, elementIcon } from "./element-icons"
import { createPresetArtwork } from "./PresetArtwork"
import { presetContext, presetSound } from "./preset-catalogue"
import type { TransformerPreset } from "audiobus/io/transformer-presets"

export function createPresetDetails(preset: TransformerPreset) {
	const article = element("article", "preset-details")
	article.append(
		createPresetArtwork({ preset }),
		element("span", "preset-category", preset.category),
		element("h3", "", preset.name),
		element("p", "", preset.description),
		element("h4", "", "Why use it"),
		element("p", "", preset.useCase)
	)
	if (presetSound(preset)) {
		article.append(element("h4", "", "Outputs"), element("p", "", presetSound(preset)))
	}
	const details = element("details", "preset-steps")
	details.open = true
	details.append(
		element(
			"summary",
			"",
			`How it works · ${preset.steps.length} ${preset.steps.length === 1 ? "step" : "steps"}`
		)
	)
	if (!preset.steps.length) {
		details.append(
			element(
				"p",
				"",
				"Notes pass through unchanged, preserving the pitch, timing and length you play."
			)
		)
	}
	const list = element("ol")
	for (const step of preset.steps) {
		const item = element("li")
		item.title = elementDescription("transformer", step.type, step.type)
		item.append(
			icon(elementIcon("transformer", step.type), item.title),
			document.createTextNode(step.summary)
		)
		list.append(item)
	}
	details.append(list)
	article.append(
		details,
		element(
			"p",
			"preset-hint",
			(presetContext(preset)
				? "A new chain includes only the outputs listed above. Applying to an existing chain keeps its current inputs and outputs."
				: "Keeps the notes you play as the starting point and processes them in the order above. Uses your chain’s input and instrument.") +
				" Change the key, tempo and transformer settings to suit your piece."
		)
	)
	return article
}