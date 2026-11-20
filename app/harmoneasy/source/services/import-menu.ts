import {
	detectImportFile,
	FILE_IMPORT_FORMATS,
	IMPORT_FILE_ACCEPT,
	type DetectedImportFile
} from "audiobus/importers/file-import"
import {
	EVENT_CLICK,
	EVENT_CHANGE,
	EVENT_CLOSE,
	EVENT_ABORT,
	EVENT_DRAG_OVER,
	EVENT_DROP
} from "audiobus/events/event-constants"

/** Preview detected file types, then use the same automatic loader as file drops. */
export function installImportMenu(
	root: Document,
	trigger: HTMLElement,
	receive: (file: File) => void,
	signal: AbortSignal
): HTMLDialogElement {
	const dialog = root.createElement("dialog")
	dialog.id = "import-file-dialog"
	dialog.dataset.importMenu = ""
	dialog.setAttribute("aria-labelledby", "import-file-title")
	const header = root.createElement("header"),
		title = root.createElement("h5")
	title.id = "import-file-title"
	title.textContent = "Import File"
	header.append(title)
	const description = root.createElement("p")
	description.textContent =
		"Choose or drop files. Their contents determine how they load: music as playable notes, audio as a Loop Player, and WAM2 bundles as instruments. Audio loops can be up to 4 MB; other files up to 64 MB."
	const input = root.createElement("input")
	input.type = "file"
	input.multiple = true
	input.accept = IMPORT_FILE_ACCEPT
	input.hidden = true
	input.setAttribute("aria-label", "Choose music, audio or instrument files")
	const browse = root.createElement("button")
	browse.type = "button"
	browse.textContent = "Choose files…"
	browse.autofocus = true
	const status = root.createElement("p")
	status.setAttribute("role", "status")
	status.textContent = "No files selected."
	const list = root.createElement("ul")
	list.setAttribute("aria-label", "Detected file types")
	const details = root.createElement("details"),
		summary = root.createElement("summary"),
		formats = root.createElement("ul")
	summary.textContent = "Supported file types"
	for (const format of FILE_IMPORT_FORMATS) {
		const row = root.createElement("li")
		row.textContent = `${format.label}: ${format.extensions.map((extension) => `.${extension}`).join(", ")}`
		formats.append(row)
	}
	details.append(summary, formats)
	const scope = root.createElement("p")
	scope.textContent =
		"Vocal projects load note pitches and timing. LMMS imports song-level piano-roll patterns at a fixed tempo; Beat/Bassline arrangements, audio, effects and automation are not imported."
	details.append(scope)
	const actions = root.createElement("menu"),
		load = root.createElement("button")
	load.type = "button"
	load.textContent = "Import files"
	load.disabled = true
	actions.append(load)
	const closeForm = root.createElement("form"),
		close = root.createElement("button")
	closeForm.method = "dialog"
	close.type = "submit"
	close.textContent = "Cancel"
	closeForm.append(close)
	dialog.append(header, description, browse, input, status, list, details, actions, closeForm)
	root.body.append(dialog)
	let generation = 0
	let ready: File[] = []
	const classify = async (files: File[]) => {
		const request = ++generation
		ready = []
		list.replaceChildren()
		load.disabled = true
		status.textContent = files.length ? "Detecting file types…" : "No files selected."
		for (const file of files) {
			let detected: DetectedImportFile | undefined, error: unknown
			try {
				detected = await detectImportFile(file)
				if (detected.format.kind === "audio" && file.size > 4 * 1024 * 1024) {
					throw new Error("Audio loops must be at most 4 MB")
				}
			} catch (reason) {
				error = reason
			}
			if (request !== generation || signal.aborted) {
				return
			}
			const row = root.createElement("li")
			if (error) {
				row.textContent = `${file.name}: ${error instanceof Error ? error.message : String(error)}`
			} else {
				const kind = detected!.format.kind
				const destination =
					kind === "notes"
						? "Playable notes"
						: kind === "audio"
							? "Loop Player"
							: "MIDI inputs / WAM2 instruments"
				row.textContent = `${file.name}: ${detected!.format.label} → ${destination}`
				ready.push(file)
			}
			list.append(row)
		}
		if (request !== generation || signal.aborted) {
			return
		}
		load.disabled = ready.length === 0
		load.textContent = ready.length === 1 ? "Import file" : "Import files"
		status.textContent = `${ready.length} of ${files.length} files ready to import.`
	}
	trigger.addEventListener(
		EVENT_CLICK,
		() => {
			if (!dialog.open) {
				dialog.showModal()
			}
		},
		{ signal }
	)
	browse.addEventListener(EVENT_CLICK, () => input.click(), { signal })
	input.addEventListener(
		EVENT_CHANGE,
		() => {
			const files = Array.from(input.files ?? [])
			input.value = ""
			void classify(files)
		},
		{ signal }
	)
	dialog.addEventListener(
		EVENT_DRAG_OVER,
		(event) => {
			event.preventDefault()
			event.stopPropagation()
		},
		{ signal }
	)
	dialog.addEventListener(
		EVENT_DROP,
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			void classify(Array.from(event.dataTransfer?.files ?? []))
		},
		{ signal }
	)
	load.addEventListener(
		EVENT_CLICK,
		() => {
			if (load.disabled) {
				return
			}
			const selected = ready.slice()
			dialog.close()
			selected.forEach((file) => receive(file))
		},
		{ signal }
	)
	dialog.addEventListener(
		EVENT_CLOSE,
		() => {
			generation++
			ready = []
			list.replaceChildren()
			load.disabled = true
			status.textContent = "No files selected."
		},
		{ signal }
	)
	signal.addEventListener(
		EVENT_ABORT,
		() => {
			generation++
			dialog.remove()
		},
		{ once: true }
	)
	return dialog
}