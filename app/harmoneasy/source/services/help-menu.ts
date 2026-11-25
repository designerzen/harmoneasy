import { createDropdown } from "control-surface/dropdown"
import "control-surface/dropdown.css"
import { EVENT_CLICK } from "audiobus/events/event-constants"
import { PLUGIN_DOWNLOAD_URL } from "./plugin-guide"

interface HelpAction {
	label: string
	/** Opens in a new tab, like the About dialog's links. */
	external?: boolean
	run(): void
}

const openLink = (url: string) => () => window.open(url, "_blank", "noopener,noreferrer")

/** The action bar's Help menu: About, the DAW plugin guide and the project's links. */
export function createHelpMenu(
	root: Document,
	{ openAbout, openPluginGuide }: { openAbout(): void; openPluginGuide(): void }
) {
	const bar = root.getElementById("action-bar")
	if (!bar) {
		return
	}
	const base = import.meta.env.BASE_URL
	const actions: HelpAction[] = [
		{ label: "About Harmoneasy", run: openAbout },
		{ label: "DAW plugin guide", run: openPluginGuide },
		{
			label: "Download DAW plugin (Windows VST3)",
			external: true,
			run: openLink(PLUGIN_DOWNLOAD_URL)
		},
		{
			label: "Commands and controls",
			run: () => root.getElementById("btn-command-palette")?.click()
		},
		{
			label: "Read the guide",
			external: true,
			run: openLink("https://github.com/designerzen/harmoneasy#readme")
		},
		{ label: "Play songs", external: true, run: openLink(`${base}play/`) },
		{ label: "Browse preset pages", external: true, run: openLink(`${base}presets/`) },
		{
			label: "Documentation for AI agents",
			external: true,
			run: openLink(`${base}docs/ai/`)
		},
		{
			label: "Report an issue",
			external: true,
			run: openLink("https://github.com/designerzen/harmoneasy/issues")
		},
		{
			label: "Source code",
			external: true,
			run: openLink("https://github.com/designerzen/harmoneasy")
		}
	]
	const menu = createDropdown("Help")
	menu.element.classList.add("help-menu")
	menu.trigger.id = "btn-help"
	menu.trigger.replaceChildren("Help")
	for (const action of actions) {
		const item = root.createElement("button")
		item.type = "button"
		item.textContent = action.label
		if (action.external) {
			const arrow = root.createElement("span")
			arrow.setAttribute("aria-hidden", "true")
			arrow.textContent = " ↗"
			const note = root.createElement("span")
			note.className = "sr-only"
			note.textContent = " (opens in a new tab)"
			item.append(arrow, note)
		}
		item.addEventListener(EVENT_CLICK, () => {
			menu.close(true)
			action.run()
		})
		menu.content.append(item)
	}
	bar.querySelector(".backlink")?.after(menu.element)
}