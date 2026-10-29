import type { TransformerPreset } from "audiobus/io/preset-library"
import { elementDescription, elementIcon } from "./element-icons"

function textSpan(className: string, text: string) {
	const span = document.createElement("span")
	span.className = className
	span.textContent = text
	return span
}

function presetOption(preset: TransformerPreset): HTMLOptionElement {
	const option = document.createElement("option")
	option.value = preset.id
	const copy = document.createElement("span")
	copy.className = "chain-preset-copy"
	const name = document.createElement("strong")
	name.textContent = preset.name
	copy.append(
		name,
		document.createTextNode(" "),
		textSpan("chain-preset-description", preset.description),
		document.createTextNode(" "),
		textSpan("chain-preset-use-case", preset.useCase)
	)
	const steps = document.createElement("span")
	steps.className = "chain-preset-steps"
	for (const step of preset.steps) {
		const item = document.createElement("span")
		item.className = "chain-preset-step"
		const icon = document.createElement("span")
		icon.className = "element-icon"
		icon.setAttribute("aria-hidden", "true")
		icon.style.maskImage = `url("${elementIcon("transformer", step.type)}")`
		item.title = elementDescription("transformer", step.type, step.type)
		item.append(icon, document.createTextNode(step.summary || step.type))
		steps.append(document.createTextNode(" "), item)
	}
	copy.append(steps)
	option.append(copy)
	return option
}

// Keep customizable select markup outside React's option rendering.
export function createChainPresetPicker(id: string): HTMLSelectElement {
	const select = document.createElement("select")
	select.id = id
	select.className = "chain-preset-picker"
	const button = document.createElement("button")
	button.type = "button"
	button.append(document.createElement("selectedcontent"))
	select.append(button)
	return select
}

export function updateChainPresetOptions(select: HTMLSelectElement, presets: TransformerPreset[]) {
	const selection = select.value
	const options = document.createDocumentFragment()
	options.append(
		presetOption({
			id: "",
			name: "Default IOChain",
			category: "",
			description: "Start with the default chain settings.",
			useCase: "Choose a preset below to start with a specific playing style.",
			steps: [{ type: "identity", config: {}, summary: "Pass notes through unchanged" }]
		})
	)
	for (const category of new Set(presets.map((preset) => preset.category))) {
		const group = document.createElement("optgroup")
		group.label = category
		for (const preset of presets.filter((preset) => preset.category === category)) {
			group.append(presetOption(preset))
		}
		options.append(group)
	}
	// Preserve the button and its browser-managed selectedcontent.
	for (const child of Array.from(select.children)) {
		if (child.tagName !== "BUTTON") {
			child.remove()
		}
	}
	select.append(options)
	select.value = presets.some((preset) => preset.id === selection) ? selection : ""
}