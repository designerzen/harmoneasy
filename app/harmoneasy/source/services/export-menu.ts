import { EVENT_CHANGE, EVENT_CLICK } from "audiobus/events/event-constants"
import { EXPORT_FORMATS, type ExportFormat } from "audiobus/exporters/registry"

export interface ExportSongSource {
	id: string
	name: string
	chain: string
}

type ExportKind = ExportFormat["kind"]

/** Section headings in the order they appear. */
const EXPORT_GROUPS: Record<ExportKind, string> = {
	notes: "MIDI and note data",
	score: "Sheet music and tablature",
	project: "DAW and vocal projects",
	text: "Text notation",
	tracker: "Tracker modules"
}

/** Where each format opens, so people can pick by destination rather than by acronym. */
const EXPORT_HINTS: Record<string, string> = {
	midi: "Any DAW, notation app or hardware sequencer",
	rmid: "MIDI in a RIFF wrapper for Windows players",
	"midi-csv": "Spreadsheets and the midicsv tools",
	notesequence: "Magenta and other machine-learning tools",
	"tone-json": "Tone.js and @tonejs/midi",
	jams: "Music research annotation tools",
	ust: "UTAU singing synth; lyrics set to “a”",
	svl: "Sonic Visualiser note layer",
	musicxml: "MuseScore, Sibelius, Finale and Dorico",
	mxl: "The same apps as MusicXML, in a smaller file",
	abc: "Folk-tune text notation and abcjs",
	lilypond: "Engraved scores with LilyPond",
	"guitar-pro": "Guitar Pro 7 and later, alphaTab",
	alphatex: "alphaTab text tablature",
	mscx: "MuseScore 4, readable XML",
	mscz: "MuseScore 4's usual file",
	dawproject: "Bitwig Studio, Studio One and Cubase",
	svp: "Synthesizer V Studio; lyrics set to “a”, no singer",
	ustx: "OpenUtau; lyrics set to “a”, no singer",
	ufdata: "UtaFormatix vocal-synth converter",
	lmms: "LMMS, played by a basic oscillator",
	"lmms-compressed": "LMMS's usual file, played by a basic oscillator",
	reaper: "REAPER, as MIDI items",
	"midi-markdown": "Readable note list for docs and chat prompts",
	mml: "Music Macro Language for chiptune players",
	rtttl: "Phone ringtones and Nokia composers"
}
const KIND_HINTS: Partial<Record<ExportKind, string>> = {
	tracker: "OpenMPT, MilkyTracker and Schism Tracker"
}

/** Populate the export dialog with source selection and grouped format buttons. */
export function installExportMenu(
	root: Document,
	exportButton: HTMLElement | null,
	sheetMusicButton: HTMLElement | null,
	callback: (id: string, source: string) => Promise<void>,
	sources: () => ExportSongSource[] = () => [],
	signal?: AbortSignal
): void {
	const menu = root.getElementById("export-options")
	if (!menu) {
		return
	}
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
	const field = make("div", "export-source")
	const label = make("label", undefined, "Export from")
	label.htmlFor = "export-source"
	const select = make("select")
	select.id = "export-source"
	const hint = make("p", "export-source-hint")
	hint.id = "export-source-hint"
	select.setAttribute("aria-describedby", hint.id)
	field.append(label, select, hint)
	menu.prepend(field)
	const makeOption = (text: string, value: string) => {
		const option = make("option", undefined, text)
		option.value = value
		return option
	}
	const describeSource = () => {
		hint.textContent =
			select.value === "recording"
				? "The notes captured on the timeline. Sheet music, AudioTool and OpenDAW always export the recording."
				: "A song loaded into the graph, with its own tempo, metadata and parts."
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
		describeSource()
	}
	refresh()
	exportButton?.addEventListener(EVENT_CLICK, refresh, { signal })
	select.addEventListener(EVENT_CHANGE, describeSource, { signal })

	const groupFor = (kind: ExportKind) => {
		const section = make("section", "export-group")
		section.dataset.exportKind = kind
		const heading = make("h3", undefined, EXPORT_GROUPS[kind])
		heading.id = `export-group-${kind}`
		section.setAttribute("aria-labelledby", heading.id)
		const grid = make("div", "export-grid")
		section.append(heading, grid)
		menu.append(section)
		return grid
	}
	for (const kind of Object.keys(EXPORT_GROUPS) as ExportKind[]) {
		const formats = EXPORT_FORMATS.filter((format) => format.kind === kind)
		if (!formats.length) {
			continue
		}
		const grid = groupFor(kind)
		// The sheet-music viewer leads the scores since it needs no other app.
		if (kind === "score" && sheetMusicButton) {
			grid.append(sheetMusicButton)
		}
		for (const format of formats) {
			const button = make("button", "export-option")
			button.type = "button"
			button.id = `btn-${format.id}-export`
			button.append(
				make("span", "export-option-label", format.label),
				make(
					"span",
					"export-option-meta",
					`.${format.extension} · ${EXPORT_HINTS[format.id] ?? KIND_HINTS[kind] ?? ""}`.replace(
						/ · $/,
						""
					)
				)
			)
			button.autofocus = format.id === "midi"
			button.addEventListener(EVENT_CLICK, () => callback(format.id, select.value), {
				signal
			})
			grid.append(button)
		}
	}
}