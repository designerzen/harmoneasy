import type IOChain from "audiobus/io/IO-chain"
import type { Transformer } from "audiobus/io/transformers/abstract-transformer"
import { tranformerFactory } from "audiobus/io/transformer-factory"
import { EVENT_CONFIGURATION_CHANGED } from "audiobus/events/event-constants"
import { editNodeValue, type NodeMenuAction } from "./node-menu"

export function transformerActions(chain: IOChain, transformer: Transformer): NodeMenuAction[] {
	const config = () => JSON.parse(transformer.exportConfig())
	const update = (key: string, value: string) => {
		transformer.setConfig(key, value)
		chain.dispatchEvent(new Event(EVENT_CONFIGURATION_CHANGED))
	}
	return [
		{
			label: "Clone",
			run() {
				const options = config()
				delete options.midiControlId
				options.displayName = `${options.displayName || transformer.name} copy`
				const transformers = [...chain.transformerManager.getTransformers()]
				const index = transformers.indexOf(transformer)
				if (index < 0) {
					return
				}
				const copy = tranformerFactory(transformer.type, options)
				transformers.splice(index + 1, 0, copy)
				chain.transformerManager.setTransformers(transformers)
				chain.dispatchEvent(new Event(EVENT_CONFIGURATION_CHANGED))
			}
		},
		{
			label: "Rename",
			run: () =>
				editNodeValue(
					"Rename transformer",
					config().displayName || transformer.name,
					"text",
					(value) => update("displayName", value)
				)
		},
		{
			label: "Recolor",
			run: () =>
				editNodeValue(
					"Transformer color",
					config().displayColor || "#5953ae",
					"color",
					(value) => update("displayColor", value)
				)
		}
	]
}