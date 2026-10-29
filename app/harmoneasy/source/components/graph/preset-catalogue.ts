import { DEFAULT_PRESET_LIBRARY } from "audiobus/io/transformer-presets"
import type { TransformerPreset } from "audiobus/io/preset-library"
import { START_CONTEXTS, createContextSetup } from "../../services/start-context-catalogue"
import { OUTPUT_DEFINITIONS } from "audiobus/io/output-definitions"

export const ACTIVITY_PRESETS: TransformerPreset[] = START_CONTEXTS.map((context) => ({
	id: `activity:${context.id}`,
	name: context.name,
	category:
		context.category === "Accessibility"
			? context.category
			: `Activities · ${context.category}`,
	description: context.description,
	useCase: context.next,
	steps: createContextSetup(context).chains[0].steps
}))

export function presetContext(preset: Pick<TransformerPreset, "id">) {
	const activity = START_CONTEXTS.find((context) => preset.id === `activity:${context.id}`)
	if (activity) {
		return activity
	}
	// Factory genre presets share the sounds of their corresponding starter.
	const factory = DEFAULT_PRESET_LIBRARY.presets.find((item) => item.id === preset.id)
	return factory?.category === "Genres"
		? START_CONTEXTS.find(
				(context) => context.category === "Genres" && context.presets.includes(factory.id)
			)
		: undefined
}

export function presetSetup(preset: TransformerPreset) {
	const context = presetContext(preset)
	const setup = createContextSetup(
		context ?? {
			id: preset.id,
			name: preset.name,
			category: preset.category,
			description: preset.description,
			next: preset.useCase,
			presets: []
		}
	)
	setup.chains[0].steps = structuredClone(preset.steps)
	setup.chains[0].options = { ...setup.chains[0].options, ...preset.options }
	if (!preset.id.startsWith("activity:")) {
		setup.id = preset.id
		setup.name = preset.name
		setup.description = preset.description
		setup.chains[0].options.name = preset.name
	}
	return setup
}

export function presetSound(preset: TransformerPreset) {
	const context = presetContext(preset)
	return context
		? (context.outputs
				?.map((output) =>
					output.type
						? (OUTPUT_DEFINITIONS[output.type]?.name ?? output.type)
						: "PolySynth"
				)
				.join(" + ") ?? "PolySynth")
		: undefined
}

export function completePresets(saved: TransformerPreset[]) {
	return [
		...DEFAULT_PRESET_LIBRARY.presets.filter(
			(preset) => !saved.some((item) => item.id === preset.id)
		),
		...saved,
		...ACTIVITY_PRESETS
	]
}