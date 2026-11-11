import { createPresetBrowser } from "../components/graph/PresetBrowser"
import { presetSetup } from "../components/graph/preset-catalogue"
import type { PresetSetup } from "audiobus/io/preset-library"
import { EVENT_CLICK } from "audiobus/event-constants"
import type { PresetPage } from "./preset-page"
import { configurationSteps } from "audiobus/io/preset-library"
export * from "./start-context-catalogue"

export function createStartContexts(
	root: HTMLElement,
	onStart?: (setup: PresetSetup) => void | Promise<void>
) {
	let selected: PresetSetup | undefined
	let hasPagePreset = false
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
		toggleLabel.textContent = host.hidden
			? hasPagePreset
				? "Load another preset"
				: "Presets"
			: "Close presets"
		if (!host.hidden) {
			search.focus({ preventScroll: true })
		}
	}
	toggle.addEventListener(EVENT_CLICK, togglePresets)
	return {
		getSetup: () => selected,
		setPresetPage(preset: PresetPage) {
			hasPagePreset = true
			const song = preset.workspace.chains.some((chain: { transformers: string }) =>
				configurationSteps(chain.transformers).some(
					(step) => step.type === "MIDI-File-Player"
				)
			)
			root.setAttribute("aria-labelledby", "start-preset-name")
			root.dataset.startContext = song ? "song" : "preset"
			root.querySelector<HTMLElement>("#start-preset-label")!.textContent = song
				? "Ready to play"
				: "Ready to start"
			root.querySelector<HTMLElement>("#start-preset-context")!.hidden = false
			root.querySelector<HTMLElement>("#start-preset-name")!.textContent = preset.name
			root.querySelector<HTMLElement>("#start-preset-description")!.textContent =
				preset.description
			root.querySelector<HTMLElement>(".btn-continue-session span")!.textContent = song
				? "Start playing"
				: "Start this preset"
			root.querySelector<HTMLElement>("#start-wizard")!.hidden = song
			toggle.hidden = song
			for (const item of root.querySelectorAll<HTMLElement>(".start-footer > *")) {
				item.hidden = item.hasAttribute("data-start-song-back") ? !song : song
			}
			if (host.hidden) {
				toggleLabel.textContent = "Load another preset"
			}
		},
		destroy() {
			dismissRoom.removeEventListener(EVENT_CLICK, dismissInvitation)
			toggle.removeEventListener(EVENT_CLICK, togglePresets)
			browser.destroy()
		}
	}
}