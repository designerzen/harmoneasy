import { EVENT_CLICK } from "audiobus/events/event-constants"
import { EXPORT_FORMATS } from "audiobus/exporters/registry"

export interface ExportSongSource {
	id: string
	name: string
	chain: string
}

/** Populate the export dialog with source selection and format buttons. */
export function installExportMenu(
	root: Document,
	exportButton: HTMLElement | null,
	beforeNode: HTMLElement | null,
	callback: (id: string, source: string) => Promise<void>,
	sources: () => ExportSongSource[] = () => [],
	signal?: AbortSignal
): void {
	const menu = root.getElementById("export-options")
	if (!menu) {
		return
	}
	const label = root.createElement("label")
	label.textContent = "Export source "
	const select = root.createElement("select")
	select.id = "export-source"
	select.setAttribute("aria-label", "Export source")
	label.append(select)
	menu.prepend(label)
	const makeOption = (text: string, value: string) => {
		const option = root.createElement("option")
		option.textContent = text
		option.value = value
		return option
	}
	// Songs load and unload while the app runs, so list them each time the dialog opens.
	const refresh = () => {
		const previous = select.value
		select.replaceChildren(
			makeOption("Recording", "recording"),
			...sources().map((source) =>
				makeOption(`Loaded song: ${source.name} (${source.chain})`, source.id)
			)
		)
		select.value = [...select.options].some((option) => option.value === previous)
			? previous
			: "recording"
	}
	refresh()
	exportButton?.addEventListener(EVENT_CLICK, refresh, { signal })
	for (const format of EXPORT_FORMATS) {
		const button = root.createElement("button")
		button.type = "button"
		button.id = `btn-${format.id}-export`
		button.className = "export-option"
		button.textContent = `Export as ${format.label} (.${format.extension})`
		button.autofocus = format.id === "midi"
		button.addEventListener(EVENT_CLICK, () => callback(format.id, select.value), { signal })
		menu.insertBefore(button, beforeNode)
	}
}
