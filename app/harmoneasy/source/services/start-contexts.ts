import { createPresetBrowser } from "../components/graph/PresetBrowser"
import { presetSetup } from "../components/graph/preset-catalogue"
import type { PresetSetup } from "audiobus/io/preset-library"
import { EVENT_CLICK } from "audiobus/event-constants"
export * from "./start-context-catalogue"

export function createStartContexts(
	root: HTMLElement,
	onStart?: (setup: PresetSetup) => void | Promise<void>
) {
	let selected: PresetSetup | undefined
	const host = root.querySelector<HTMLElement>(".start-presets-content")!
	const toggle = root.querySelector<HTMLButtonElement>("#show-start-presets")!
	const toggleLabel = toggle.querySelector<HTMLElement>("[data-start-presets-label]")!
	const roomContext = root.querySelector<HTMLElement>("#start-room-context")!
	const dismissRoom = root.querySelector<HTMLButtonElement>("#dismiss-start-room")!
	const dismissInvitation = () => {
		roomContext.hidden = true
		toggle.focus({ preventScroll: true })
	}
	dismissRoom.addEventListener(EVENT_CLICK, dismissInvitation)
	host.replaceChildren()
	const choose = (setup: PresetSetup) => {
		selected = setup
		return onStart?.(setup)
	}
	const browser = createPresetBrowser({
		createChain: true,
		startup: true,
		onChooseSetup: choose,
		onApply: (preset) => choose(presetSetup(preset))
	})
	host.append(browser.element)
	const search = host.querySelector<HTMLInputElement>('input[type="search"]')!
	search.autofocus = false
	const togglePresets = () => {
		host.hidden = !host.hidden
		toggle.setAttribute("aria-expanded", String(!host.hidden))
		toggleLabel.textContent = host.hidden ? "Presets" : "Close presets"
		if (!host.hidden) {
			search.focus({ preventScroll: true })
		}
	}
	toggle.addEventListener(EVENT_CLICK, togglePresets)
	return {
		getSetup: () => selected,
		destroy() {
			dismissRoom.removeEventListener(EVENT_CLICK, dismissInvitation)
			toggle.removeEventListener(EVENT_CLICK, togglePresets)
			browser.destroy()
		}
	}
}
