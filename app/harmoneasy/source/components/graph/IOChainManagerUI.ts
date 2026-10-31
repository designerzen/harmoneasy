import type IOChainManager from "audiobus/io/IO-chain-manager"
import { applyPreset } from "./saved-presets"
import { createPresetBrowser } from "./PresetBrowser"
import { presetSetup } from "./preset-catalogue"
import { deviceId, deviceDefinition } from "audiobus/io/device-definition"

export function createIOChainManagerUI(manager: IOChainManager) {
	let adding = false
	return createPresetBrowser({
		manager,
		createChain: true,
		onApply: async (preset) => {
			if (adding) {
				return
			}
			adding = true
			try {
				const setup = preset.id ? presetSetup(preset) : undefined
				const sounds = setup?.devices.filter(
					(device) =>
						device.direction === "output" && device.definition.factory !== "external"
				)
				const id = sounds
					? await manager.createChainWithSounds(sounds.map((device) => device.definition))
					: await manager.createDefaultChain()
				const chain = manager.getChain(id)!
				if (preset.id) {
					applyPreset(chain, preset)
					chain.setName(preset.name)
					if (setup && sounds) {
						const outputs = chain.outputs.filter(
							(output) => deviceDefinition(output).factory !== "external"
						)
						const ids = new Map(
							sounds.map((sound, index) => [sound.id, deviceId(outputs[index])])
						)
						const surfaces = structuredClone(
							setup.chains[0].options.controlSurfaces ?? []
						)
						for (const surface of surfaces) {
							for (const connection of surface.connections) {
								connection.componentId =
									ids.get(connection.componentId) ?? connection.componentId
							}
							for (const widget of surface.widgets) {
								const [component, control] = JSON.parse(widget.key)
								widget.key = JSON.stringify([
									ids.get(component) ?? component,
									control
								])
							}
						}
						chain.setGraphOptions({
							controlSurfaces: surfaces,
							mainSurfaceId: setup.chains[0].options.mainSurfaceId
						})
					}
				}
				manager.setActiveChain(id)
			} finally {
				adding = false
			}
		}
	})
}