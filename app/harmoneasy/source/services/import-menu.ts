import {
	detectImportFile,
	FILE_IMPORT_FORMATS,
	IMPORT_FILE_ACCEPT,
	type DetectedImportFile,
	type ImportFormat
} from "audiobus/importers/file-import"
import {
	EVENT_CLICK,
	EVENT_CHANGE,
	EVENT_CLOSE,
	EVENT_ABORT,
	EVENT_DRAG_OVER,
	EVENT_DRAG_LEAVE,
	EVENT_DROP
} from "audiobus/events/event-constants"

type ImportKind = ImportFormat["kind"]

const MAX_AUDIO_LOOP_BYTES = 4 * 1024 * 1024

/** Where each kind of file lands, shown before and after files are chosen. */
const DESTINATIONS: Record<ImportKind, { title: string; summary: string; limit: string }> = {
	notes: {
		title: "Playable notes",
		summary:
			"MIDI, scores, tabs, tracker modules and DAW or vocal projects become a song you can play through your instruments.",
		limit: "Up to 64 MB"
	},
	audio: {
		title: "Loop Player",
		summary: "Audio clips load into a Loop Player that follows the transport.",
		limit: "Up to 4 MB"
	},
	bundle: {
		title: "MIDI inputs / WAM2 instruments",
		summary: "Bundles add Web Audio Module instruments or MIDI inputs to the graph.",
		limit: "Up to 64 MB"
	},
	soundfont: {
		title: "Rompler soundfont",
		summary: "SoundFonts are read in place by a new Rompler instrument.",
		limit: "Up to 1 GB"
	}
}

/** Notes on what each project format brings across, shown with the supported types. */
const PROJECT_LIMITS = [
	"Vocal projects load note pitches and timing.",
	"LMMS imports song-level piano-roll patterns at a fixed tempo.",
	"MuseScore loads written notes without expanding repeats or ornaments.",
	"REAPER loads embedded MIDI; glue slip-edited clips and crop items to their active take first.",
	"Audio tracks, plugins and effects in projects are not imported."
]

const formatBytes = (bytes: number): string =>
	bytes < 1024
		? `${bytes} B`
		: bytes < 1024 * 1024
			? `${Math.round(bytes / 1024)} KB`
			: `${(bytes / (1024 * 1024)).toFixed(1)} MB`

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

/** Preview detected file types, then use the same automatic loader as file drops. */
export function installImportMenu(
	root: Document,
	trigger: HTMLElement,
	receive: (file: File) => void,
	signal: AbortSignal
): HTMLDialogElement {
	const make = <K extends keyof HTMLElementTagNameMap>(
		tag: K,
		className?: string,
		text?: string
	): HTMLElementTagNameMap[K] => {
		const element = root.createElement(tag)
		if (className) {
			element.className = className
		}
		if (text !== undefined) {
			element.textContent = text
		}
		return element
	}

	const dialog = root.createElement("dialog")
	dialog.id = "import-file-dialog"
	dialog.className = "file-dialog"
	dialog.dataset.importMenu = ""
	dialog.setAttribute("closedby", "any")
	dialog.setAttribute("aria-labelledby", "import-file-title")
	dialog.setAttribute("aria-describedby", "import-file-description")

	const header = make("header"),
		title = make("h2", undefined, "Import files"),
		description = make(
			"p",
			"file-dialog-lede",
			"Bring in music, audio loops, instruments and soundfonts. Each file is checked by its contents, so it loads in the right place even if it has been renamed."
		)
	title.id = "import-file-title"
	description.id = "import-file-description"
	header.append(title, description)

	const closeForm = make("form"),
		closeIcon = make("button", "btn-close close-icon")
	closeForm.method = "dialog"
	closeIcon.type = "submit"
	closeIcon.setAttribute("aria-label", "Close")
	closeForm.append(closeIcon)

	// Drop zone: the whole dialog accepts drops, this panel shows where and how.
	const input = make("input")
	input.type = "file"
	input.multiple = true
	input.accept = IMPORT_FILE_ACCEPT
	input.hidden = true
	input.setAttribute("aria-label", "Choose music, audio or instrument files")
	const browse = make("button", "primary", "Choose files…")
	browse.type = "button"
	browse.autofocus = true
	const zone = make("div", "import-drop")
	zone.append(
		make("p", "import-drop-title", "Drop files here"),
		make("p", "import-drop-hint", "or pick one or more from your device"),
		browse,
		input
	)

	// Selected files with what was detected and where each will go.
	const queue = make("section", "import-queue")
	queue.setAttribute("aria-labelledby", "import-queue-title")
	queue.hidden = true
	const queueTitle = make("h3", undefined, "Selected files")
	queueTitle.id = "import-queue-title"
	const list = make("ul", "import-files")
	list.setAttribute("aria-label", "Detected file types")
	queue.append(queueTitle, list)

	// Destinations, so people know what will happen before choosing anything.
	const guide = make("section", "import-destinations")
	guide.setAttribute("aria-labelledby", "import-destinations-title")
	const guideTitle = make("h3", undefined, "Where files go")
	guideTitle.id = "import-destinations-title"
	const cards = make("ul")
	for (const [kind, destination] of Object.entries(DESTINATIONS) as [
		ImportKind,
		(typeof DESTINATIONS)[ImportKind]
	][]) {
		const card = make("li")
		card.dataset.kind = kind
		const examples = FILE_IMPORT_FORMATS.filter((format) => format.kind === kind)
			.flatMap((format) => format.extensions)
			.slice(0, 6)
			.map((extension) => `.${extension}`)
			.join(" ")
		card.append(
			make("strong", undefined, destination.title),
			make("p", undefined, destination.summary),
			make("p", "import-destination-meta", `${destination.limit} · ${examples}`)
		)
		cards.append(card)
	}
	guide.append(guideTitle, cards)

	// Every registered format, grouped by destination.
	const details = make("details", "import-formats"),
		summary = make(
			"summary",
			undefined,
			`Supported file types (${FILE_IMPORT_FORMATS.length} formats)`
		),
		formats = make("dl")
	for (const [kind, destination] of Object.entries(DESTINATIONS) as [
		ImportKind,
		(typeof DESTINATIONS)[ImportKind]
	][]) {
		formats.append(make("dt", "import-formats-group", destination.title))
		for (const format of FILE_IMPORT_FORMATS.filter((entry) => entry.kind === kind)) {
			const extensions = make("dd")
			for (const extension of format.extensions) {
				extensions.append(make("code", undefined, `.${extension}`))
			}
			formats.append(make("dt", undefined, format.label), extensions)
		}
	}
	const scope = make("ul", "import-formats-notes")
	scope.setAttribute("aria-label", "What projects bring across")
	for (const note of PROJECT_LIMITS) {
		scope.append(make("li", undefined, note))
	}
	details.append(summary, formats, scope)

	const footer = make("footer"),
		status = make("p", "file-dialog-status", "No files selected."),
		cancel = make("button", "secondary", "Cancel"),
		load = make("button", "primary", "Import files")
	status.setAttribute("role", "status")
	cancel.type = "button"
	load.type = "button"
	load.disabled = true
	footer.append(status, cancel, load)

	dialog.append(header, closeForm, zone, queue, guide, details, footer)
	root.body.append(dialog)

	let generation = 0
	let ready: File[] = []
	let total = 0
	const updateSummary = () => {
		load.disabled = ready.length === 0
		load.textContent = ready.length === 1 ? "Import file" : "Import files"
		queue.hidden = list.childElementCount === 0
		status.textContent = total
			? `${ready.length} of ${plural(total, "file")} ready to import.`
			: "No files selected."
	}
	const reset = () => {
		generation++
		ready = []
		total = 0
		list.replaceChildren()
		updateSummary()
	}
	const describe = (file: File, detected?: DetectedImportFile, error?: unknown) => {
		const row = make("li")
		row.dataset.state = error ? "error" : "ready"
		const name = make("span", "import-file-name", file.name)
		name.title = file.name
		const result = make("span", "import-file-result")
		if (error) {
			result.textContent = error instanceof Error ? error.message : String(error)
		} else {
			const kind = detected!.format.kind
			row.dataset.kind = kind
			result.textContent = `${detected!.format.label} → ${DESTINATIONS[kind].title}`
		}
		// Screen readers hear the whole row as one sentence.
		const sentence = make("span", "sr-only", ": ")
		const remove = make("button", "btn-close close-icon")
		remove.type = "button"
		remove.setAttribute("aria-label", `Remove ${file.name}`)
		remove.addEventListener(
			EVENT_CLICK,
			() => {
				const next = row.nextElementSibling ?? row.previousElementSibling
				row.remove()
				ready = ready.filter((entry) => entry !== file)
				total--
				updateSummary()
				;((next?.querySelector("button") as HTMLElement | null) ?? browse).focus()
			},
			{ signal }
		)
		row.append(name, sentence, result, make("span", "import-file-size", formatBytes(file.size)))
		row.append(remove)
		return row
	}
	const classify = async (files: File[]) => {
		reset()
		const request = generation
		total = files.length
		status.textContent = files.length ? "Detecting file types…" : "No files selected."
		for (const file of files) {
			let detected: DetectedImportFile | undefined, error: unknown
			try {
				detected = await detectImportFile(file)
				if (detected.format.kind === "audio" && file.size > MAX_AUDIO_LOOP_BYTES) {
					throw new Error("Audio loops must be at most 4 MB")
				}
			} catch (reason) {
				error = reason
			}
			if (request !== generation || signal.aborted) {
				return
			}
			list.append(describe(file, detected, error))
			if (!error) {
				ready.push(file)
			}
			queue.hidden = false
		}
		if (request !== generation || signal.aborted) {
			return
		}
		updateSummary()
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
	cancel.addEventListener(EVENT_CLICK, () => dialog.close(), { signal })
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
			dialog.dataset.dragging = ""
		},
		{ signal }
	)
	dialog.addEventListener(
		EVENT_DRAG_LEAVE,
		(event) => {
			// Moving between children fires dragleave too; only clear when leaving the dialog.
			if (!dialog.contains(event.relatedTarget as Node | null)) {
				delete dialog.dataset.dragging
			}
		},
		{ signal }
	)
	dialog.addEventListener(
		EVENT_DROP,
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			delete dialog.dataset.dragging
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
			delete dialog.dataset.dragging
			reset()
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