import type { TransformerPreset } from "audiobus/io/preset-library"
import type { PresetPage } from "./preset-page"
import { completePresets, presetContext, presetSetup } from "../components/graph/preset-catalogue"
import { performanceHardwarePage } from "./performance-presets"
import { songPresetPage } from "./song-presets"

const slug = (value: string) =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")

/** Stable public routes are independent of display names and saved browser libraries. */
export function builtinPresetRoute(preset: TransformerPreset): string {
	if (preset.id.startsWith("performance:")) {
		const path = preset.id.slice("performance:".length)
		return path.startsWith("hardware/")
			? path
			: path.startsWith("genres/")
				? `presets/${path}`
				: `presets/inputs/${path}`
	}
	const context = presetContext(preset)
	if (preset.id.startsWith("activity:")) {
		return context?.category === "Genres"
			? `presets/genres/${context.id}`
			: `presets/activities/${preset.id.slice(9)}`
	}
	return `presets/${preset.category === "Genres" ? "genre-patterns" : slug(preset.category)}/${preset.id}`
}

export function builtinPresetPage(preset: TransformerPreset): PresetPage {
	const song = songPresetPage(preset.id)
	if (song) {
		return song
	}
	const hardware = performanceHardwarePage(preset.id)
	if (hardware) {
		return structuredClone(hardware) as PresetPage
	}
	const setup = presetSetup(preset)
	return {
		format: "harmoneasy-preset",
		version: 1,
		name: setup.name,
		description: setup.description,
		clock: setup.clock ?? {
			bpm: 110,
			swing: 0,
			divisions: 24,
			bars: 4
		},
		midiControls: { enabled: true, bindings: [] },
		workspace: {
			version: 2,
			activeChainId: setup.activeChainId,
			devices: setup.devices,
			chains: setup.chains.map(({ steps, ...chain }) => ({
				...chain,
				transformers: JSON.stringify(
					steps.map(({ type, config }) => JSON.stringify({ ...config, type }))
				),
				disabledInputs: [],
				disabledOutputs: []
			}))
		}
	}
}

export function builtinPresetPages(): Map<string, PresetPage> {
	const pages = new Map<string, PresetPage>()
	for (const preset of completePresets([])) {
		const route = builtinPresetRoute(preset)
		const page = builtinPresetPage(preset)
		pages.set(route, page)
		// Retain the original singular namespace, including hardware bookmarks.
		pages.set(`preset/${route.replace(/^presets\//, "")}`, page)
		if (route.startsWith("hardware/")) {
			pages.set(`presets/${route}`, page)
		}
		if (route.startsWith("presets/inputs/")) {
			pages.set(route.replace("presets/inputs/", "hardware/"), page)
		}
	}
	return pages
}