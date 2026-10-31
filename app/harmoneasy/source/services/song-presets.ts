import onlyWayIsUp from "../../public/preset/songs/only-way-is-up/preset.json"
import type { PresetSetup, TransformerPreset } from "audiobus/io/preset-library"
import type { PresetPage } from "./preset-page"

const songs = [{ id: "only-way-is-up", page: onlyWayIsUp }]
const steps = (transformers: string) =>
	JSON.parse(transformers).map((value: string) => {
		const { type, ...config } = JSON.parse(value)
		return {
			type,
			config,
			summary: "Advance one melody note per key press and loop indefinitely."
		}
	})

export const SONG_PRESETS: TransformerPreset[] = songs.map(({ id, page }) => ({
	id,
	name: page.name,
	category: "Songs",
	description: page.description,
	useCase: "Play a complete melody at your own pace with any playing key.",
	steps: steps(page.workspace.chains[0].transformers)
}))

export function songPresetPage(id: string): PresetPage | undefined {
	const song = songs.find((item) => item.id === id)
	return song ? (structuredClone(song.page) as PresetPage) : undefined
}

export function songPresetSetup(id: string): PresetSetup | undefined {
	const page = songPresetPage(id)
	if (!page) {
		return
	}
	return {
		id,
		name: page.name,
		description: page.description,
		clock: page.clock,
		activeChainId: page.workspace.activeChainId,
		devices: page.workspace.devices,
		chains: page.workspace.chains.map(({ transformers, ...chain }: Record<string, any>) => ({
			...chain,
			steps: steps(transformers)
		}))
	}
}