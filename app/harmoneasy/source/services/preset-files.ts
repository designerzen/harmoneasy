import type { TransformerPreset } from "audiobus/io/preset-library"
import { presetPageSetup, type PresetPage } from "./preset-page"
import { presetFileRoute, presetFilePages } from "../../scripts/preset-file-routes.js"

const files = import.meta.glob<PresetPage>("../../presets/**/*.json", {
	eager: true,
	import: "default"
})
export const PUBLISHED_PRESETS = Object.entries(files)
	.map(([path, page]) => {
		const route = presetFileRoute(path.slice("../../presets/".length))
		const setup = presetPageSetup(page, page.catalogue?.id ?? `published:${route}`)
		const category = route.startsWith("hardware/")
			? "Hardware"
			: route.startsWith("presets/genres/")
				? "Genres"
				: route.startsWith("presets/songs/")
					? "Songs"
					: "Community presets"
		const preset: TransformerPreset = {
			id: setup.id,
			name: page.name,
			description: page.description,
			category: page.catalogue?.category ?? category,
			useCase: page.catalogue?.useCase ?? page.description,
			steps: setup.chains[0]?.steps ?? [],
			...(page.catalogue?.options ? { options: page.catalogue.options } : {})
		}
		return { route, page, preset }
	})
	.sort(
		(a, b) =>
			(a.page.catalogue?.order ?? Infinity) - (b.page.catalogue?.order ?? Infinity) ||
			a.route.localeCompare(b.route)
	)

export function publishedPreset(id: string) {
	return PUBLISHED_PRESETS.find((entry) => entry.preset.id === id)
}

export function publishedPresetPages(): Map<string, PresetPage> {
	return presetFilePages(
		Object.entries(files).map(([path, page]) => [
			path.slice("../../presets/".length),
			structuredClone(page)
		])
	)
}

export function publishedPresetSetup(id: string) {
	const entry = publishedPreset(id)
	return entry
		? presetPageSetup(entry.page, id.startsWith("activity:") ? id.slice(9) : id)
		: undefined
}

export function isWorkspacePreset(preset: Pick<TransformerPreset, "id">) {
	const entry = publishedPreset(preset.id)
	return Boolean(entry && entry.page.catalogue?.kind !== "chain")
}