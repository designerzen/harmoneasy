import { PUBLISHED_PRESETS, publishedPreset, publishedPresetSetup } from "./preset-files"

export const SONG_PRESETS = PUBLISHED_PRESETS.filter(
	(entry) => entry.preset.category === "Songs"
).map((entry) => entry.preset)

export function songPresetPage(id: string) {
	const entry = publishedPreset(id)
	return entry?.preset.category === "Songs" ? structuredClone(entry.page) : undefined
}

export function songPresetSetup(id: string) {
	return songPresetPage(id) ? publishedPresetSetup(id) : undefined
}