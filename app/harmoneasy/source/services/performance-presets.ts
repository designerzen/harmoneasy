import type { TransformerPreset } from "audiobus/io/preset-library"
import { PUBLISHED_PRESETS, publishedPreset, publishedPresetSetup } from "./preset-files"

export const PERFORMANCE_PRESETS = PUBLISHED_PRESETS.filter((entry) =>
	entry.preset.id.startsWith("performance:")
).map((entry) => entry.preset)

export function performancePresetSetup(preset: Pick<TransformerPreset, "id">) {
	return preset.id.startsWith("performance:") ? publishedPresetSetup(preset.id) : undefined
}

export function performanceHardwarePage(id: string) {
	const entry = publishedPreset(id)
	return entry?.route.startsWith("hardware/") ? structuredClone(entry.page) : undefined
}