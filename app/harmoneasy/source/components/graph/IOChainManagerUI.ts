import type IOChainManager from "audiobus/io/IO-chain-manager"
import { applyPreset } from "./saved-presets"
import { createPresetBrowser } from "./PresetBrowser"
import { presetContext } from "./preset-catalogue"

export function createIOChainManagerUI(manager: IOChainManager) {
	let adding = false
	return createPresetBrowser({
		createChain: true,
		onApply: async (preset) => {
			if (adding) {
				return
			}
			adding = true
			try {
				const context = presetContext(preset)
				const id = context
					? await manager.createChainWithSounds(
							context.outputs ?? [{ factory: "polyphonic" }]
						)
					: await manager.createDefaultChain()
				const chain = manager.getChain(id)!
				if (preset.id) {
					applyPreset(chain, preset)
					chain.setName(preset.name)
				}
				manager.setActiveChain(id)
			} finally {
				adding = false
			}
		}
	})
}