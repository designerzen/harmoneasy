import { DEFAULT_PRESET_LIBRARY } from "../../services/factory-preset-data"
import type { TransformerPreset } from "audiobus/io/preset-library"
import { START_CONTEXTS, createContextSetup } from "../../services/start-context-catalogue"
import { presetVoice, setupSurfaces } from "../../services/preset-instruments"
import { OUTPUT_DEFINITIONS } from "../../../../../packages/audiobus/io/output-definitions"
import { PUBLISHED_PRESETS, publishedPresetSetup } from "../../services/preset-files"

export const ACTIVITY_PRESETS: TransformerPreset[] = PUBLISHED_PRESETS.filter((entry) =>
	entry.preset.id.startsWith("activity:")
).map((entry) => entry.preset)

const factorySignatures = new Map(
	DEFAULT_PRESET_LIBRARY.presets.map((preset) => [preset.id, JSON.stringify(preset)])
)

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
	const published = publishedPresetSetup(preset.id)
	if (published) {
		if (published.chains.length === 1) {
			published.chains[0].steps = structuredClone(preset.steps)
			published.chains[0].options = { ...published.chains[0].options, ...preset.options }
		}
		return published
	}
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
	if (!context?.outputs && !preset.id.startsWith("activity:")) {
		setup.devices.find((device) => device.id === "synth")!.definition = presetVoice(
			preset.steps
		)
	}
	if (!preset.id.startsWith("activity:")) {
		setup.id = preset.id
		setup.name = preset.name
		setup.description = preset.description
		setup.chains[0].options.name = preset.name
	}
	return setupSurfaces(setup)
}

export function presetSound(preset: TransformerPreset) {
	return presetSetup(preset)
		.devices.filter(
			(device) => device.direction === "output" && device.definition.factory !== "external"
		)
		.map(({ definition }) =>
			definition.factory === "polyphonic"
				? `PolySynth (${definition.options?.shape ?? "default"})`
				: (OUTPUT_DEFINITIONS[definition.type ?? ""]?.name ?? definition.type)
		)
		.join(" + ")
}

export function completePresets(saved: TransformerPreset[]) {
	const custom = saved.filter(
		(preset) => factorySignatures.get(preset.id) !== JSON.stringify(preset)
	)
	return [
		...PUBLISHED_PRESETS.map((entry) => entry.preset).filter(
			(preset) => !custom.some((item) => item.id === preset.id)
		),
		...custom
	]
}