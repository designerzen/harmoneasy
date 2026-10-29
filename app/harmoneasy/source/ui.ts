import { formatTimeStampFromSeconds } from "netronome"
import NoteVisualiser from "audiobus/ui/note-visualiser.js"
import NoteTimelineVisualiser from "audiobus/ui/note-timeline-visualiser"
import SVGKeyboard from "audiobus/ui/keyboard-svg.ts"
import { createOpenDAWExportDialog } from "./services/opendaw-export-dialog"
import { EVENT_CLICK, EVENT_CHANGE, EVENT_ABORT } from "audiobus/event-constants"
import { installMediaDrop } from "./services/media-drop"

import type NoteModel from "audiobus/note-model.ts"
import type { IAudioOutput } from "audiobus/io/outputs/output-interface.ts"
import { convertNoteNumberToColour } from "audiobus/conversion/note-to-colour.ts"

const DOM_ID_CLOCK = "clock"
const DOM_ID_SELECTOR_SCALE = "scale-selector"
const DOM_ID_ROOT_SELECTOR = "root-selector"
const DOM_ID_SELECTOR_MIDI_CHANNEL = "midi-channel-selector"
const DOM_ID_RANGE_TEMPO = "tempo"
const DOM_ID_BPM = "bpm"
const DOM_ID_RANGE_SWING = "swing"
const DOM_ID_SWING_OUTPUT = "swing-output"
const DOM_ID_BUTTON_TEMPO_UP = "btn-tempo-up"
const DOM_ID_BUTTON_TEMPO_DOWN = "btn-tempo-down"
const DOM_ID_RANGE_VOLUME = "volume"
const DOM_ID_VOLUME_OUTPUT = "volume-output"
const DOM_ID_BUTTON_VOLUME_UP = "btn-volume-up"
const DOM_ID_BUTTON_VOLUME_DOWN = "btn-volume-down"
const DOM_ID_BUTTON_CONNECT_BLUETOOTH = "btn-connect-to-ble"
const DOM_ID_BUTTON_TOGGLE_WEBMIDI = "btn-toggle-webmidi"

const DOM_ID_BUTTON_IMPORT = "btn-import"
const DOM_ID_BUTTON_EXPORT_MIDI_FILE = "btn-midi-export"
const DOM_ID_BUTTON_EXPORT_MED = "btn-med-export"
const DOM_ID_BUTTON_EXPORT_MIDI_MARKDOWN = "btn-midi-markdown-export"
const DOM_ID_BUTTON_EXPORT_MUSICXML = "btn-musicxml-export"
const DOM_ID_BUTTON_EXPORT_VEXFLOW = "btn-vexflow-export"
const DOM_ID_BUTTON_EXPORT_AUDIOTOOL = "btn-audiotool-export"
const DOM_ID_BUTTON_EXPORT_OPENDAW = "btn-opendaw-export"
const DOM_ID_BUTTON_EXPORT_DAWPROJECT = "btn-dawproject-export"
const DOM_ID_BUTTON_EXPORT = "btn-export"
const DOM_ID_EXPORT_DIALOG = "export-dialog"

const DOM_ID_BUTTON_KILL_SWITCH = "btn-kill-switch"
const DOM_ID_BUTTON_RESET = "btn-reset"
const DOM_ID_BLE_MANUAL_FIELDSET = "ble-manual-send-fieldset"
const DOM_ID_BLE_MANUAL_INPUT = "ble-manual-input"
const DOM_ID_BUTTON_SEND_BLE_MANUAL = "btn-send-ble-manual"
const DOM_ID_BUTTON_RANDOM_TIMBRE = "btn-random-timbre"
const DOM_ID_EXPORT_OVERLAY = "export-overlay"

const DOM_ID_NOTE_VISUALISER_CANVAS = "note-visualiser"

const DOM_ID_DIALOG_ERROR = "error-dialog"
const DOM_ID_DIALOG_INFO = "info-dialog"

const DOM_ID_BUTTON_SETTINGS = "btn-settings"
const DOM_ID_DIALOG_SETTINGS = "settings-dialog"
const DOM_ID_TIMER_TYPE_SELECT = "timer-type-select"

const DEFAULT_OPTIONS = {
	verticalNoteBars: false
}

export default class UI implements IAudioOutput {
	static ID: number = 0

	options: typeof DEFAULT_OPTIONS
	abortController = new AbortController()
	clockAnimationFrame = -1

	elementClock: HTMLElement | null
	elementScaleSelector: HTMLSelectElement | null
	elementRootSelector: HTMLSelectElement | null
	elementMIDIChannelSelector: HTMLSelectElement | null
	elementTempo: HTMLInputElement | null
	elementBPM: HTMLElement | null
	elementSwing: HTMLInputElement | null
	elementSwingOutput: HTMLOutputElement | null
	elementButtonTempoUp: HTMLElement | null
	elementButtonTempoDown: HTMLElement | null
	elementVolume: HTMLInputElement | null
	elementVolumeOutput: HTMLElement | null
	elementButtonVolumeUp: HTMLElement | null
	elementButtonVolumeDown: HTMLElement | null
	elementButtonBluetoothConnect: HTMLElement | null
	elementButtonWebMIDI: HTMLElement | null
	elementBLEManualFields: HTMLElement | null
	elementBLEManualInput: HTMLInputElement | null
	elementBLEManualSendButton: HTMLElement | null
	elementButtonKillSwitch: HTMLElement | null
	elementButtonReset: HTMLElement | null
	elementButtonExport: HTMLElement | null
	elementExportDialog: HTMLDialogElement | null
	elementMidiImportButton: HTMLElement | null
	elementMidiExportButton: HTMLElement | null
	elementMEDExportButton: HTMLElement | null
	elementMidiMarkdownExportButton: HTMLElement | null
	elementMusicXMLExportButton: HTMLElement | null
	elementVexFlowExportButton: HTMLElement | null
	elementAudioToolExportButton: HTMLElement | null
	elementOpenDAWExportButton: HTMLElement | null
	elementDawProjectExportButton: HTMLElement | null
	elementButtonRandomTimbre: HTMLElement | null
	elementOverlayExport: HTMLDialogElement | null
	elementInfoDialog: HTMLDialogElement | null
	elementErrorDialog: HTMLDialogElement | null
	elementButtonSettings: HTMLElement | null
	elementSettingsDialog: HTMLDialogElement | null
	elementTimerTypeSelect: HTMLSelectElement | null
	noteVisualiserCanvas: HTMLCanvasElement | null
	noteVisualiser: NoteVisualiser
	noteTimeline: NoteTimelineVisualiser

	#keyboard?: SVGKeyboard
	keyboardElement: any

	get name(): string {
		return "FrontEnd"
	}

	get keyboard(): SVGKeyboard | undefined {
		return this.#keyboard
	}
	get uuid(): string {
		return "Output-UI-" + UI.ID++
	}
	get description(): string {
		return "Front End"
	}
	get isConnected(): boolean {
		return !!this.#keyboard
	}
	get isHidden(): boolean {
		return true
	}
	constructor(keyboardNotes: Array<NoteModel>, options = DEFAULT_OPTIONS) {
		this.options = { ...DEFAULT_OPTIONS, ...options }

		this.elementClock = document.getElementById(DOM_ID_CLOCK)
		this.elementScaleSelector = document.getElementById(
			DOM_ID_SELECTOR_SCALE
		) as HTMLSelectElement | null
		this.elementRootSelector = document.getElementById(
			DOM_ID_ROOT_SELECTOR
		) as HTMLSelectElement | null
		this.elementMIDIChannelSelector = document.getElementById(
			DOM_ID_SELECTOR_MIDI_CHANNEL
		) as HTMLSelectElement | null
		this.elementTempo = document.getElementById(DOM_ID_RANGE_TEMPO) as HTMLInputElement | null
		this.elementBPM = document.getElementById(DOM_ID_BPM)
		this.elementSwing = document.getElementById(DOM_ID_RANGE_SWING) as HTMLInputElement | null
		this.elementSwingOutput = document.getElementById(
			DOM_ID_SWING_OUTPUT
		) as HTMLOutputElement | null
		this.elementButtonTempoUp = document.getElementById(DOM_ID_BUTTON_TEMPO_UP)
		this.elementButtonTempoDown = document.getElementById(DOM_ID_BUTTON_TEMPO_DOWN)
		this.elementVolume = document.getElementById(DOM_ID_RANGE_VOLUME) as HTMLInputElement | null
		this.elementVolumeOutput = document.getElementById(DOM_ID_VOLUME_OUTPUT)
		this.elementButtonVolumeUp = document.getElementById(DOM_ID_BUTTON_VOLUME_UP)
		this.elementButtonVolumeDown = document.getElementById(DOM_ID_BUTTON_VOLUME_DOWN)

		this.elementButtonBluetoothConnect = document.getElementById(
			DOM_ID_BUTTON_CONNECT_BLUETOOTH
		)

		this.elementButtonWebMIDI = document.getElementById(DOM_ID_BUTTON_TOGGLE_WEBMIDI)
		this.elementBLEManualFields = document.getElementById(DOM_ID_BLE_MANUAL_FIELDSET)
		this.elementBLEManualInput = document.getElementById(
			DOM_ID_BLE_MANUAL_INPUT
		) as HTMLInputElement | null
		this.elementBLEManualSendButton = document.getElementById(DOM_ID_BUTTON_SEND_BLE_MANUAL)
		this.elementButtonKillSwitch = document.getElementById(DOM_ID_BUTTON_KILL_SWITCH)
		this.elementButtonReset = document.getElementById(DOM_ID_BUTTON_RESET)
		this.elementButtonExport = document.getElementById(DOM_ID_BUTTON_EXPORT)
		this.elementExportDialog = document.getElementById(
			DOM_ID_EXPORT_DIALOG
		) as HTMLDialogElement | null

		this.elementMidiImportButton = document.getElementById(DOM_ID_BUTTON_IMPORT)
		this.elementMidiExportButton = document.getElementById(DOM_ID_BUTTON_EXPORT_MIDI_FILE)
		this.elementMEDExportButton = document.getElementById(DOM_ID_BUTTON_EXPORT_MED)
		this.elementMidiMarkdownExportButton = document.getElementById(
			DOM_ID_BUTTON_EXPORT_MIDI_MARKDOWN
		)
		this.elementMusicXMLExportButton = document.getElementById(DOM_ID_BUTTON_EXPORT_MUSICXML)
		this.elementVexFlowExportButton = document.getElementById(DOM_ID_BUTTON_EXPORT_VEXFLOW)
		this.elementAudioToolExportButton = document.getElementById(DOM_ID_BUTTON_EXPORT_AUDIOTOOL)
		this.elementOpenDAWExportButton = document.getElementById(DOM_ID_BUTTON_EXPORT_OPENDAW)
		this.elementDawProjectExportButton = document.getElementById(
			DOM_ID_BUTTON_EXPORT_DAWPROJECT
		)

		this.elementButtonRandomTimbre = document.getElementById(DOM_ID_BUTTON_RANDOM_TIMBRE)

		this.elementOverlayExport = document.getElementById(
			DOM_ID_EXPORT_OVERLAY
		) as HTMLDialogElement | null
		this.elementInfoDialog = document.getElementById(
			DOM_ID_DIALOG_INFO
		) as HTMLDialogElement | null
		this.elementErrorDialog = document.getElementById(
			DOM_ID_DIALOG_ERROR
		) as HTMLDialogElement | null

		this.elementButtonSettings = document.getElementById(DOM_ID_BUTTON_SETTINGS)
		this.elementSettingsDialog = document.getElementById(
			DOM_ID_DIALOG_SETTINGS
		) as HTMLDialogElement | null
		this.elementTimerTypeSelect = document.getElementById(
			DOM_ID_TIMER_TYPE_SELECT
		) as HTMLSelectElement | null

		document.getElementById("btn-transport-details")?.addEventListener(
			EVENT_CLICK,
			() => {
				const panel = document.getElementById(
					"recordings-panel"
				) as HTMLDetailsElement | null
				if (panel) {
					panel.open = true
				}
				document.getElementById("recordings")?.scrollIntoView({ behavior: "smooth" })
			},
			{ signal: this.abortController.signal }
		)

		this.noteVisualiserCanvas = document.getElementById(
			DOM_ID_NOTE_VISUALISER_CANVAS
		) as HTMLCanvasElement | null
		this.noteVisualiser = new NoteVisualiser(
			keyboardNotes,
			this.noteVisualiserCanvas ?? document.createElement("canvas"),
			this.options.verticalNoteBars,
			0
		) // ALL_KEYBOARD_NOTES
		this.noteTimeline = new NoteTimelineVisualiser(
			document.getElementById("note-timeline") as HTMLCanvasElement
		)
		// wallpaperCanvas.addEventListener( "dblclick", e => scale === SCALES[ (SCALES.indexOf(scale) + 1) % SCALES.length] )

		this.setupDragAndDrop()
	}

	/**
	 * Register callback for when the export button is clicked to open the export menu
	 */
	whenExportMenuRequestedRun(callback: Function): void {
		if (!this.elementExportDialog) {
			return
		}

		if (this.elementButtonExport && this.elementExportDialog!) {
			this.elementButtonExport.addEventListener(
				"click",
				() => {
					this.elementExportDialog!.hidden = false
					this.elementExportDialog!.showModal()
					if (callback) {
						callback()
					}
				},
				{ signal: this.abortController.signal }
			)
		}
	}

	private onMediaDropped?: (media: File | string) => void

	private setupDragAndDrop(): void {
		installMediaDrop(
			document,
			(media) => this.onMediaDropped?.(media),
			this.abortController.signal
		)
	}

	whenMediaDroppedRun(callback: (media: File | string) => void): void {
		this.onMediaDropped = callback
	}

	whenMIDIFileDroppedRun(callback: (file: File) => void): void {
		this.onMediaDropped = (media) => {
			if (typeof media !== "string") {
				callback(media)
			}
		}
	}

	/**
	 * setTempo(tempo)
	 * @param {Number} tempo
	 */
	setTempo(tempo: number) {
		if (!this.elementTempo) {
			return
		}
		if (!this.elementBPM) {
			return
		}

		this.elementTempo!.value = String(tempo)
		this.elementBPM!.textContent = String(tempo)
	}

	setSwing(swing: number) {
		if (this.elementSwing) {
			this.elementSwing.value = String(swing)
		}
		if (this.elementSwingOutput) {
			this.elementSwingOutput.value = `${Math.round(swing * 100)}%`
		}
	}

	setPlaying(isPlaying: boolean) {
		if (!this.elementTempo) {
			return
		}

		this.elementTempo!.classList.toggle("playing", isPlaying)
		const start = document.querySelector<HTMLButtonElement>("#btn-transport-start")
		const stop = document.querySelector<HTMLButtonElement>("#btn-transport-stop")
		const reset = document.querySelector<HTMLButtonElement>("#btn-transport-reset")
		const activeButton = document.activeElement
		if (start) {
			start.disabled = isPlaying
			start.hidden = isPlaying
		}
		if (stop) {
			stop.disabled = !isPlaying
			stop.hidden = !isPlaying
		}
		if (isPlaying && activeButton === start) {
			stop?.focus()
		}
		if (!isPlaying && activeButton === stop) {
			start?.focus()
		}
		document.getElementById("midi-transport-control")?.classList.toggle("playing", isPlaying)
		if (reset) {
			reset.disabled = false
		}
		const status = document.getElementById("transport-status")
		if (status) {
			status.textContent = isPlaying ? "Playing" : "Stopped"
		}
	}

	whenTransportRequestedRun(callback: (action: "start" | "stop" | "reset") => void) {
		for (const action of ["start", "stop", "reset"] as const) {
			document
				.getElementById(`btn-transport-${action}`)
				?.addEventListener("click", () => callback(action), {
					signal: this.abortController.signal
				})
		}
	}

	resetClock() {
		cancelAnimationFrame(this.clockAnimationFrame)
		if (this.elementClock) {
			this.elementClock.textContent = formatTimeStampFromSeconds(0)
		}
	}

	setVolume(value: number): void {
		const volumeInput = document.querySelector<HTMLInputElement>("#volume")
		const volumeOutput = document.querySelector<HTMLOutputElement>("#volume-output")
		if (volumeInput) {
			volumeInput.value = String(value)
		}
		if (volumeOutput) {
			volumeOutput.textContent = String(Math.round(value))
		}
	}

	// Dialogs ----------------------------------------------------------------------
	private openDAWExportDialog?: (script: string) => void

	showOpenDAWExportDialog(script: string) {
		this.openDAWExportDialog ??= createOpenDAWExportDialog(
			document,
			this.abortController.signal
		)
		this.openDAWExportDialog(script)
	}

	showInfoDialog(title: string, message: string) {
		if (!this.elementInfoDialog) {
			return
		}

		const heading = this.elementInfoDialog?.querySelector("h5")
		if (heading) {
			heading.textContent = title
		}
		const messageElement = this.elementInfoDialog?.querySelector("#info-message")
		if (messageElement) {
			messageElement.innerHTML = message
		}
		this.elementInfoDialog!.hidden = false
		this.elementInfoDialog!.showModal()
		// this.elementInfoDialog.showModal()
	}

	/**
	 * Displays an error on the screen
	 * @param {String} errorMessage
	 * @param {Boolean} _fatal - does this break the app?
	 */
	showError(errorMessage: string, solution = "", _fatal = false) {
		if (!this.elementErrorDialog) {
			return
		}

		const elementIssue = this.elementErrorDialog?.querySelector<HTMLElement>("#error-message")
		const elementSolution =
			this.elementErrorDialog?.querySelector<HTMLElement>("#error-solution")

		if (!elementIssue || !elementSolution) {
			return
		}
		elementIssue.innerHTML = errorMessage
		if (solution && solution.length > 0) {
			elementSolution.innerHTML = solution
			elementSolution.hidden = false
		} else {
			elementSolution.hidden = true
		}

		this.elementErrorDialog!.hidden = false
		this.elementErrorDialog!.showModal()
		console.error(errorMessage)
	}

	// Bluetooth --------------------------------------------------------------------

	whenBluetoothDeviceRequestedRun(callback: Function) {
		if (this.elementButtonBluetoothConnect) {
			this.elementButtonBluetoothConnect.addEventListener(
				"click",
				() => {
					if (callback) {
						callback()
					}
				},
				{ signal: this.abortController.signal }
			)
		}
	}

	setBluetoothButtonText(text: string = "Connect Bluetooth") {
		if (!this.elementButtonBluetoothConnect) {
			return
		}

		this.elementButtonBluetoothConnect!.textContent = text
	}

	/**
	 * Show error/status message in the devices panel
	 * @param {String} message
	 */
	showBluetoothStatus(message: string) {
		if (!this.elementButtonBluetoothConnect) {
			return
		}

		this.elementButtonBluetoothConnect!.textContent = message
	}

	/**
	 * Register a callback that will be invoked when the user requests a manual BLE send.
	 * The callback receives the raw input string (commas allowed) so the caller can parse it
	 * into a Uint8Array or other form for sending.
	 * @param {Function} callback (value: string) => void
	 */
	whenUserRequestsManualBLECodesRun(callback: Function) {
		if (!this.elementBLEManualInput) {
			return
		}

		if (!(this.elementBLEManualSendButton && this.elementBLEManualInput!)) {
			return
		}
		const doSend = () => {
			const raw = String(this.elementBLEManualInput!.value || "").trim()
			if (callback) {
				callback(raw)
			}
		}
		this.elementBLEManualSendButton.addEventListener("click", () => doSend(), {
			signal: this.abortController.signal
		})
		// allow Enter key in the input to trigger send
		this.elementBLEManualInput!.addEventListener(
			"keydown",
			(e) => {
				if (e.key === "Enter") {
					e.preventDefault()
					doSend()
				}
			},
			{ signal: this.abortController.signal }
		)
	}

	/**
	 * Toggle visibility of the manual BLE input and send button.
	 * @param {boolean} visible
	 */
	setBLEManualInputVisible(visible: boolean) {
		if (this.elementBLEManualFields) {
			this.elementBLEManualFields.hidden = !visible
		}
	}

	/**
	 * Convenience method to reveal the manual BLE input once a Bluetooth connection is established.
	 */
	showBLEManualInputOnBluetoothConnected() {
		this.setBLEManualInputVisible(true)
	}

	setWebMIDIButtonText(text: string = "Enable WebMIDI") {
		if (this.elementButtonWebMIDI) {
			this.elementButtonWebMIDI.textContent = text
		}
	}

	whenWebMIDIToggledRun(callback: Function) {
		if (this.elementButtonWebMIDI) {
			this.elementButtonWebMIDI.addEventListener(
				"click",
				(e) => {
					if (callback) {
						callback(e)
					}
				},
				{ signal: this.abortController.signal }
			)
		}
	}

	// Exporting --------------------------------------------------------------------
	showExportOverlay(_text: string = "") {
		if (!this.elementOverlayExport) {
			return
		}

		this.elementOverlayExport!.hidden = false
	}

	hideExportOverlay() {
		if (!this.elementOverlayExport) {
			return
		}

		this.elementOverlayExport!.hidden = true
	}

	setExportOverlayText(text: string) {
		const message = this.elementOverlayExport?.querySelector("p")
		if (message) {
			message.textContent = text
		}
	}

	// Interaction --------------------------------------

	/**
	 * Upload files through the same importer used for dropped media.
	 */
	whenFileImportRequestedRun(callback: (file: File) => void): void {
		if (!this.elementMidiImportButton) {
			return
		}
		const fileInput = document.createElement("input")
		fileInput.type = "file"
		fileInput.multiple = true
		fileInput.setAttribute("aria-label", "Upload music files or WAM2 plugin bundles")
		fileInput.accept =
			".mid,.midi,audio/midi,.zip,.wam,.wam2,.musicxml,.xml,.dawproject,.mod,.xm,.it,.s3m,.669,.far,.stm,.ult,.mtm,.dmf,.ptm,.okt,.mptm,.nst"
		fileInput.style.display = "none"
		document.body.appendChild(fileInput)
		this.abortController.signal.addEventListener(EVENT_ABORT, () => fileInput.remove(), {
			once: true
		})

		// When button is clicked, trigger the file input
		this.elementMidiImportButton.addEventListener(
			EVENT_CLICK,
			() => {
				fileInput.click()
			},
			{ signal: this.abortController.signal }
		)

		// When file is selected, call the callback
		fileInput.addEventListener(
			EVENT_CHANGE,
			(e) => {
				const files = (e.target as HTMLInputElement).files
				for (const file of Array.from(files ?? [])) {
					callback(file)
				}
				// Reset the input so the same file can be selected again
				fileInput.value = ""
			},
			{ signal: this.abortController.signal }
		)
	}

	/**
	 * Backwards compatibility - route to new method
	 */
	whenMIDIFileImportRequestedRun(callback: (files: FileList) => void): void {
		this.whenFileImportRequestedRun((file: File) => {
			const fileList = new DataTransfer()
			fileList.items.add(file)
			callback(fileList.files)
		})
	}

	// Export Buttons
	whenAudioToolExportRequestedRun(callback: Function) {
		if (this.elementAudioToolExportButton) {
			this.elementAudioToolExportButton.addEventListener(
				"click",
				async (e) => {
					;(this.elementExportDialog as HTMLDialogElement | null)?.close()
					if (callback) {
						await callback(e)
					}
				},
				{ signal: this.abortController.signal }
			)
		}
	}

	/**
	 *
	 * @param callback
	 */
	whenMIDIFileExportRequestedRun(callback: Function) {
		if (this.elementMidiExportButton) {
			this.elementMidiExportButton.addEventListener(
				"click",
				async (e) => {
					this.showExportOverlay()
					if (callback) {
						await callback(e)
					}
					this.hideExportOverlay()
				},
				{ signal: this.abortController.signal }
			)
		}
	}

	/**
	 *
	 * @param callback
	 */
	whenMEDExportRequestedRun(callback: Function) {
		if (this.elementMEDExportButton) {
			this.elementMEDExportButton.addEventListener(
				"click",
				async (e) => {
					this.showExportOverlay()
					if (callback) {
						await callback(e)
					}
					this.hideExportOverlay()
				},
				{ signal: this.abortController.signal }
			)
		}
	}

	/**
	 *
	 * @param callback
	 */
	whenMIDIMarkdownExportRequestedRun(callback: Function) {
		if (this.elementMidiMarkdownExportButton) {
			this.elementMidiMarkdownExportButton.addEventListener(
				"click",
				async (e) => {
					if (callback) {
						await callback(e)
					}
				},
				{ signal: this.abortController.signal }
			)
		}
	}

	/**
	 *
	 * @param callback
	 */
	whenMusicXMLExportRequestedRun(callback: Function) {
		if (this.elementMusicXMLExportButton) {
			this.elementMusicXMLExportButton.addEventListener(
				"click",
				async (e) => {
					this.showExportOverlay()
					if (callback) {
						await callback(e)
					}
					this.hideExportOverlay()
				},
				{ signal: this.abortController.signal }
			)
		}
	}

	/**
	 *
	 * @param callback
	 */
	whenVexFlowExportRequestedRun(callback: Function) {
		if (this.elementVexFlowExportButton) {
			this.elementVexFlowExportButton.addEventListener(
				"click",
				async (e) => {
					this.showExportOverlay()
					if (callback) {
						await callback(e)
					}
					this.hideExportOverlay()
				},
				{ signal: this.abortController.signal }
			)
		}
	}

	/**
	 *
	 * @param callback
	 */
	whenOpenDAWExportRequestedRun(callback: Function) {
		if (this.elementOpenDAWExportButton) {
			this.elementOpenDAWExportButton.addEventListener(
				"click",
				async (e) => {
					this.showExportOverlay()
					if (callback) {
						await callback(e)
					}
					this.hideExportOverlay()
				},
				{ signal: this.abortController.signal }
			)
		}
	}

	/**
	 *
	 * @param callback
	 */
	whenDawProjectExportRequestedRun(callback: Function) {
		if (this.elementDawProjectExportButton) {
			this.elementDawProjectExportButton.addEventListener(
				"click",
				async (e) => {
					this.showExportOverlay()
					if (callback) {
						await callback(e)
					}
					this.hideExportOverlay()
				},
				{ signal: this.abortController.signal }
			)
		}
	}

	/**
	 *
	 * @param callback
	 */
	whenRandomTimbreRequestedRun(callback: Function) {
		if (this.elementButtonRandomTimbre) {
			this.elementButtonRandomTimbre.addEventListener(
				"click",
				(e) => {
					if (callback) {
						callback(e)
					}
				},
				{ signal: this.abortController.signal }
			)
		}
	}

	/**
	 * Register a callback for when the kill switch (all notes off) button is clicked
	 * @param {Function} callback () => void
	 */
	whenKillSwitchRequestedRun(callback: Function) {
		if (this.elementButtonKillSwitch) {
			this.elementButtonKillSwitch.addEventListener(
				"pointerdown",
				(e) => {
					if (callback) {
						callback(e)
					}
				},
				{ signal: this.abortController.signal }
			)
		}
	}

	/**
	 * Register a callback for when the reset button is clicked
	 * Clears all AudioCommands from memory and OPFS storage
	 * @param {Function} callback () => void
	 */
	whenResetRequestedRun(callback: Function) {
		if (!this.elementButtonReset) {
			return
		}

		const question =
			"Are you sure? This will delete all recorded AudioCommands from memory and saved in storage. It will also reset the clock."
		this.elementButtonReset.addEventListener(
			"click",
			(e) => {
				const confirmed = confirm(question)
				if (confirmed) {
					if (callback) {
						callback(e)
					}
				}
			},
			{ signal: this.abortController.signal }
		)
	}

	whenSwingChangesRun(callback: (swing: number) => void) {
		this.elementSwing?.addEventListener(
			"input",
			() => {
				const swing = this.elementSwing!.valueAsNumber
				this.setSwing(swing)
				callback(swing)
			},
			{ signal: this.abortController.signal }
		)
	}

	/**
	 * Register a callback for when the tempo slider is moved
	 * @param {Function} callback (tempo: number) => void
	 */
	whenTempoChangesRun(callback: Function) {
		if (!this.elementTempo) {
			return
		}
		if (!this.elementBPM) {
			return
		}

		if (this.elementTempo!) {
			this.elementTempo!.addEventListener(
				"input",
				() => {
					const tempo = this.elementTempo!.value
					if (callback) {
						callback(tempo)
					}
					this.elementBPM!.textContent = tempo
				},
				{ signal: this.abortController.signal }
			)
		}
	}

	/**
	 * Register a callback for when the tempo up button is clicked
	 * @param {Function} callback () => void
	 */
	whenTempoUpRequestedRun(callback: Function) {
		if (this.elementButtonTempoUp) {
			this.elementButtonTempoUp.addEventListener(
				"click",
				(e) => {
					if (callback) {
						callback(e)
					}
				},
				{ signal: this.abortController.signal }
			)
		}
	}

	/**
	 * Register a callback for when the tempo down button is clicked
	 * @param {Function} callback () => void
	 */
	whenTempoDownRequestedRun(callback: Function) {
		if (this.elementButtonTempoDown) {
			this.elementButtonTempoDown.addEventListener(
				"click",
				(e) => {
					if (callback) {
						callback(e)
					}
				},
				{ signal: this.abortController.signal }
			)
		}
	}

	/**
	 *
	 * @param {Function} callback
	 */
	whenVolumeChangesRun(callback: Function) {
		if (!this.elementVolume) {
			return
		}

		if (this.elementVolume!) {
			this.elementVolume!.addEventListener(
				"input",
				() => {
					const volume = this.elementVolume!.value
					if (callback) {
						callback(volume)
					}
					if (this.elementVolumeOutput) {
						this.elementVolumeOutput.textContent = volume
					}
				},
				{ signal: this.abortController.signal }
			)
		}
	}

	/**
	 * Register a callback for when the volume up button is clicked
	 * @param {Function} callback () => void
	 */
	whenVolumeUpRequestedRun(callback: Function) {
		if (this.elementButtonVolumeUp) {
			this.elementButtonVolumeUp.addEventListener(
				"click",
				(e) => {
					if (callback) {
						callback(e)
					}
				},
				{ signal: this.abortController.signal }
			)
		}
	}

	/**
	 * Register a callback for when the volume down button is clicked
	 * @param {Function} callback () => void
	 */
	whenVolumeDownRequestedRun(callback: Function) {
		if (this.elementButtonVolumeDown) {
			this.elementButtonVolumeDown.addEventListener(
				"click",
				(e) => {
					if (callback) {
						callback(e)
					}
				},
				{ signal: this.abortController.signal }
			)
		}
	}

	/**
	 * Register a callback when MIDI channel selection changes.
	 * @param {Function} callback (channel: number) => void
	 */
	whenMIDIChannelSelectedRun(callback: Function) {
		if (!this.elementMIDIChannelSelector) {
			return
		}

		if (this.elementMIDIChannelSelector!) {
			this.elementMIDIChannelSelector!.addEventListener(
				"change",
				() => {
					const channel = Number(this.elementMIDIChannelSelector!.value)
					if (callback) {
						callback(channel)
					}
				},
				{ signal: this.abortController.signal }
			)
		}
	}

	/**
	 * When the note visualiser is double pressed call
	 * @param callback
	 */
	whenNoteVisualiserDoubleClickedRun(callback: Function) {
		if (this.noteVisualiserCanvas) {
			this.noteVisualiserCanvas.addEventListener("dblclick", (e) => callback && callback(e), {
				signal: this.abortController.signal
			})
		}
	}

	updateClock(values: Record<string, any>, audioCommandQuantity: number = 0) {
		if (!this.elementClock) {
			return
		}

		const { divisionsElapsed, bar, bars, barsElapsed, elapsed } = values

		cancelAnimationFrame(this.clockAnimationFrame)

		this.clockAnimationFrame = requestAnimationFrame(() => {
			this.elementClock!.textContent = formatTimeStampFromSeconds(elapsed)
			this.elementClock!.title = `Bar ${bar}, beat ${bars}, ${barsElapsed} bars elapsed; ${divisionsElapsed} divisions; ${audioCommandQuantity ?? 0} events`
		})
	}

	// IAudioOutput -------------------------------------------

	/**
	 * Show Note On
	 * @param {Number} note
	 */
	noteOn(noteNumber: number, velocity: number) {
		const colour = convertNoteNumberToColour(noteNumber)
		this.noteVisualiser.noteOn(noteNumber, velocity, colour)
		this.noteTimeline.noteOn(noteNumber, velocity, colour)
		// console.info("UI::NoteOn", {noteNumber, velocity, colour})
	}

	/**
	 * Show Note Off
	 * @param {Number} note
	 */
	noteOff(noteNumber: number) {
		this.noteVisualiser.noteOff(noteNumber)
		this.noteTimeline.noteOff(noteNumber)
		// console.info("UI::NoteOff", noteNumber )
	}

	/**
	 * Brute force!
	 */
	allNotesOff() {
		this.noteVisualiser.allNotesOff()
		this.noteTimeline.allNotesOff()
	}

	setMetronomeEnabled(enabled: boolean) {
		const button = document.getElementById("btn-metronome") as HTMLButtonElement | null
		if (!button) {
			return
		}
		button.disabled = false
		button.setAttribute("aria-pressed", String(enabled))
		button.title = enabled ? "Disable metronome" : "Enable metronome"
	}

	whenMetronomeRequestedRun(callback: () => void) {
		document.getElementById("btn-metronome")?.addEventListener("click", callback, {
			signal: this.abortController.signal
		})
	}

	/**
	 * Register a callback for when the settings button is clicked
	 */
	whenSettingsRequestedRun(callback: Function) {
		if (this.elementButtonSettings) {
			this.elementButtonSettings.addEventListener(
				"click",
				() => {
					this.elementSettingsDialog?.showModal()
					if (callback) {
						callback()
					}
				},
				{ signal: this.abortController.signal }
			)
		}
	}

	/**
	 * Register a callback for when the timer type select changes
	 */
	whenTimerTypeChangesRun(callback: Function) {
		if (this.elementTimerTypeSelect) {
			this.elementTimerTypeSelect.addEventListener(
				"change",
				(e) => {
					const timerType = (e.target as HTMLSelectElement).value
					if (callback) {
						callback(timerType)
					}
				},
				{ signal: this.abortController.signal }
			)
		}
	}

	/**
	 * Set the current timer type in the select element
	 */
	setTimerType(timerType: string) {
		if (
			this.elementTimerTypeSelect &&
			this.elementTimerTypeSelect instanceof HTMLSelectElement
		) {
			this.elementTimerTypeSelect.value = timerType
		}
	}

	/**
	 * Render VexFlow score in a modal dialog
	 * @param renderer Function to render VexFlow to container
	 * @param recorder Audio event recorder instance
	 * @param timer Timer instance
	 * @param htmlCreator Function to create downloadable HTML
	 * @param htmlSaver Function to save HTML blob to file system
	 */
	async renderVexFlowModal(
		renderer: (container: HTMLElement, recorder: any, timer: any) => void,
		recorder: any,
		timer: any,
		htmlCreator: (recorder: any, timer: any) => Promise<Blob>,
		htmlSaver: (blob: Blob, filename: string) => void
	) {
		// Create a modal container for the score
		const modalContainer = document.createElement("div")
		modalContainer.style.cssText = "width: 100%; height: 100%; overflow-y: auto; padding: 20px;"

		try {
			renderer(modalContainer, recorder, timer)

			// Create download button
			const downloadBtn = document.createElement("button")
			downloadBtn.textContent = "Download as HTML"
			downloadBtn.style.cssText =
				"margin-top: 20px; padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;"
			downloadBtn.onclick = async () => {
				const blob = await htmlCreator(recorder, timer)
				htmlSaver(blob, recorder.name)
			}

			modalContainer.appendChild(downloadBtn)

			// Show in info dialog - pass the DOM node directly to preserve event listeners
			const infoMessage = document.querySelector("#info-message")
			if (infoMessage) {
				infoMessage.innerHTML = ""
				infoMessage.appendChild(modalContainer)
				const title = document.querySelector("#info-dialog h5")
				if (title) {
					title.textContent = "Musical Score"
				}
				const dialog = document.querySelector<HTMLDialogElement>("#info-dialog")
				if (dialog) {
					dialog.hidden = false
					dialog.showModal()
				}
			} else {
				this.showInfoDialog("Musical Score", modalContainer.innerHTML)
			}
			console.info("Exporting Data to VexFlow", { recorder })
		} catch (error) {
			console.error("Error rendering VexFlow score", error)
			this.showInfoDialog(
				"Error",
				"Failed to render VexFlow score. Check console for details."
			)
		}
	}

	/**
	 * Clean up
	 */
	destroy() {
		this.noteVisualiser.destroy()
		this.noteTimeline.destroy()
		this.#keyboard?.destroy()
		this.abortController.abort()
	}
}