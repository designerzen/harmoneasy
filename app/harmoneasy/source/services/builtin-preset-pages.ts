import type { TransformerPreset } from "audiobus/io/preset-library"
import type { PresetPage } from "./preset-page"
import { publishedPreset, publishedPresetPages } from "./preset-files"

export function builtinPresetRoute(preset: Pick<TransformerPreset, "id">): string {
	const entry = publishedPreset(preset.id)
	if (!entry) {
		throw new Error(`Preset has no published file: ${preset.id}`)
	}
	return entry.route
}

export function builtinPresetPage(preset: Pick<TransformerPreset, "id">): PresetPage {
	const entry = publishedPreset(preset.id)
	if (!entry) {
		throw new Error(`Preset has no published file: ${preset.id}`)
	}
	return structuredClone(entry.page)
}

export const builtinPresetPages = publishedPresetPages