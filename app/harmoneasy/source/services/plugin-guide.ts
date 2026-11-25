import { EVENT_CLICK } from "audiobus/events/event-constants"

/** Rebuilt from main by .github/workflows/harmony-plugin.yml. */
export const PLUGIN_DOWNLOAD_URL =
	"https://github.com/designerzen/harmoneasy/releases/download/harmony-plugin/Harmoneasy-Harmony-Windows-VST3.zip"

/** Opens the Harmony workspace's DAW connection section, once a session has started. */
function openDawConnection(root: Document): boolean {
	const harmony = root.querySelector<HTMLButtonElement>(".btn-harmony")
	if (!harmony) {
		return false
	}
	harmony.click()
	const section = [
		...root.querySelectorAll<HTMLDetailsElement>(".harmony-workspace details")
	].find((details) => details.querySelector("summary")?.textContent === "DAW connection")
	if (section) {
		section.open = true
		section.querySelector("summary")?.focus()
	}
	return true
}

export function createPluginGuide(root: Document) {
	const dialog = root.querySelector<HTMLDialogElement>("#plugin-dialog")!
	const connect = root.querySelector<HTMLButtonElement>("#plugin-open-daw")!
	const hint = root.querySelector<HTMLElement>("#plugin-open-daw-hint")!
	const open = () => {
		const started = Boolean(root.querySelector(".btn-harmony"))
		connect.disabled = !started
		hint.hidden = started
		if (!dialog.open) {
			dialog.showModal()
		}
	}
	connect.addEventListener(EVENT_CLICK, () => {
		dialog.close()
		openDawConnection(root)
	})
	root.querySelectorAll<HTMLButtonElement>("[data-plugin-guide]").forEach((button) => {
		button.addEventListener(EVENT_CLICK, () => {
			button.closest("dialog")?.close()
			open()
		})
	})
	return { open }
}