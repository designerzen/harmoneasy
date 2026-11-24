import AudioCommand from "audiobus/commands/audio-command"
import type { IAudioCommand } from "audiobus/commands/audio-command-interface"
import { NOTE_OFF, NOTE_ON } from "audiobus/commands/commands"
import {
	EVENT_CHANGE,
	EVENT_CLICK,
	EVENT_HARMONY_CHANGED,
	EVENT_KEY_DOWN,
	EVENT_KEY_UP,
	EVENT_POINTER_CANCEL,
	EVENT_POINTER_DOWN,
	EVENT_POINTER_LEAVE,
	EVENT_POINTER_UP
} from "audiobus/events/event-constants"
import type IOChainManager from "audiobus/io/IO-chain-manager"
import InputAudioEvent from "audiobus/io/events/input-audio-event"
import { DEFAULT_HARMONY, NOTE_NAMES, type HarmonicState } from "audiobus/io/harmony"
import { mod12, pitchClasses } from "audiobus/tuning/pitch-class-set"
import {
	EVENT_ACCESSIBILITY_CHANGED,
	applySensoryPreset,
	type AccessibilityController
} from "./accessibility"
import type { AccessProfile } from "./access-profile"
import { describeHarmony } from "./classroom-session"
import { attachCameraGestures, createDwellController } from "./dwell-controller"
import {
	createSwitchScanner,
	type AuditoryCueMode,
	type SwitchReleaseMode
} from "./switch-scanner"

export type FocusStageMode = "scale" | "chords" | "step"
export type FocusStagePadCount = 1 | 4 | 8

export interface StagePad {
	index: number
	label: string
	sublabel: string
	symbol: string
	shortcut: string
	notes: number[]
	ariaLabel: string
}

const PAD_SYMBOLS = ["●", "▲", "■", "◆", "★", "✚", "⬟", "⬢"] as const
const ROMAN_NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII", "I′"] as const

function scalePitchesFrom(harmony: HarmonicState, baseMidi = 60, count = 12): number[] {
	const classes = pitchClasses(harmony.scale)
	const ordered = classes.length ? classes : [0, 2, 4, 5, 7, 9, 11]
	const startClass = mod12(harmony.root)
	const rotated = [
		...ordered.filter((pc) => pc >= startClass),
		...ordered.filter((pc) => pc < startClass)
	]
	const rootMidi = baseMidi + startClass
	const result: number[] = []
	for (let i = 0; i < count; i++) {
		const octave = Math.floor(i / rotated.length)
		const pc = rotated[i % rotated.length]
		const offset = mod12(pc - startClass)
		const note = Math.min(127, rootMidi + octave * 12 + offset)
		result.push(note)
	}
	return result
}

function formatChordQuality(triad: number[]): string {
	if (triad.length < 3) {
		return ""
	}
	const third = triad[1] - triad[0]
	const fifth = triad[2] - triad[0]
	if (third === 3 && fifth === 6) {
		return "°"
	}
	if (third === 3) {
		return "m"
	}
	if (third === 4 && fifth === 8) {
		return "+"
	}
	return ""
}

/** Derive labelled, symbol-badged playable pads from the active room/workspace harmony. */
export function buildStagePads(
	harmony: HarmonicState = DEFAULT_HARMONY,
	mode: FocusStageMode = "scale",
	count: FocusStagePadCount = 8
): StagePad[] {
	const scale = scalePitchesFrom(harmony, 60, 16)
	if (mode === "step") {
		const note = scale[0] ?? 60
		const name = NOTE_NAMES[mod12(note)] ?? "C"
		return [
			{
				index: 0,
				label: "Next note",
				sublabel: `${describeHarmony(harmony)} · Space or tap`,
				symbol: PAD_SYMBOLS[0],
				shortcut: "Space",
				notes: [note],
				ariaLabel: `Next note trigger in ${describeHarmony(harmony)}, starting on ${name}`
			}
		]
	}

	const pads: StagePad[] = []
	for (let index = 0; index < count; index++) {
		const root = scale[index] ?? 60
		const noteName = NOTE_NAMES[mod12(root)] ?? "C"
		const octave = Math.floor(root / 12) - 1
		const symbol = PAD_SYMBOLS[index % PAD_SYMBOLS.length]
		const shortcut = String(index + 1)

		if (mode === "chords") {
			const triad = [root, scale[index + 2], scale[index + 4]].filter(
				(pitch): pitch is number => typeof pitch === "number" && pitch <= 127
			)
			const quality = formatChordQuality(triad)
			const roman = ROMAN_NUMERALS[index % ROMAN_NUMERALS.length]
			const numeral = quality === "m" || quality === "°" ? roman.toLowerCase() : roman
			const chordName = `${noteName}${quality}`
			pads.push({
				index,
				label: chordName,
				sublabel: `${numeral} chord`,
				symbol,
				shortcut,
				notes: triad,
				ariaLabel: `Pad ${shortcut}: ${chordName} (${numeral} chord), notes ${triad.map((n) => NOTE_NAMES[mod12(n)]).join(", ")}`
			})
		} else {
			pads.push({
				index,
				label: noteName,
				sublabel: `${noteName}${octave}`,
				symbol,
				shortcut,
				notes: [root],
				ariaLabel: `Pad ${shortcut}: ${noteName}${octave}`
			})
		}
	}
	return pads
}

export type PerformanceView = "controls" | "pads"

/** The fullscreen performance view that shows the stage beside the chain's control surfaces. */
export interface FocusStageHost {
	show(view?: PerformanceView): void
	hide(): void
}

export interface FocusStageOptions {
	manager: IOChainManager
	doc: Document
	accessibility: AccessibilityController
	audioContext?: AudioContext
	outputNode?: AudioNode
	getNow?: () => number
	onCalibrate?: () => void
}

/** Accessible pads with switch scanning, dwell and beat pulse, shown as the Pads view of the fullscreen performance view. */
export function createFocusStage({
	manager,
	doc,
	accessibility,
	audioContext,
	outputNode,
	getNow = () => 0,
	onCalibrate
}: FocusStageOptions) {
	const abort = new AbortController()
	let mode: FocusStageMode = "scale"
	let padCount: FocusStagePadCount = 8
	let releaseMode: SwitchReleaseMode = "timed"
	let dwellMs = 0
	let stepCursor = 0
	let beatTimeout: ReturnType<typeof setTimeout> | undefined
	let beatPulseTimestamps: number[] = []
	let active = false
	let host: FocusStageHost | undefined
	let pads: StagePad[] = []
	const activePadNotes = new Map<number, number[]>()
	const latchedPads = new Set<number>()
	const activeTimedReleases = new Set<ReturnType<typeof setTimeout>>()

	const openButton = doc.getElementById("btn-focus-stage") as HTMLButtonElement | null
	const element = doc.createElement("section")
	element.id = "focus-stage"
	element.className = "focus-stage"
	element.setAttribute("aria-labelledby", "focus-stage-title")
	element.setAttribute("data-midi-ignore", "")

	const header = doc.createElement("div")
	header.className = "focus-stage-header"

	const identity = doc.createElement("div")
	identity.className = "focus-stage-identity"
	const title = doc.createElement("h2")
	title.id = "focus-stage-title"
	// The host's pressed Pads button already names this view on screen.
	title.className = "sr-only"
	title.textContent = "Pads"
	const harmonyBadge = doc.createElement("output")
	harmonyBadge.id = "focus-stage-harmony"
	harmonyBadge.className = "focus-stage-harmony"
	const beatPill = doc.createElement("span")
	beatPill.id = "focus-stage-beat"
	beatPill.className = "focus-stage-beat"
	beatPill.setAttribute("aria-hidden", "true")
	beatPill.textContent = "Beat 1"
	identity.append(title, harmonyBadge, beatPill)

	// Options are tuned once per learner, so they stay folded away while playing.
	const options = doc.createElement("details")
	options.className = "focus-stage-options"
	const optionsSummary = doc.createElement("summary")
	optionsSummary.textContent = "Access options"
	const toolbar = doc.createElement("div")
	toolbar.className = "focus-stage-toolbar"
	toolbar.setAttribute("role", "group")
	toolbar.setAttribute("aria-label", "Focus Stage options")
	const presets = doc.createElement("div")
	presets.className = "focus-stage-presets"
	const optionsPanel = doc.createElement("div")
	optionsPanel.className = "focus-stage-options-panel"

	const modeLabel = doc.createElement("label")
	modeLabel.append("Play mode")
	const modeSelect = doc.createElement("select")
	modeSelect.id = "focus-stage-mode"
	for (const [value, text] of [
		["scale", "Scale pads"],
		["chords", "Chord pads"],
		["step", "1-button step"]
	] as const) {
		const opt = doc.createElement("option")
		opt.value = value
		opt.textContent = text
		modeSelect.append(opt)
	}
	modeLabel.append(modeSelect)

	const countLabel = doc.createElement("label")
	countLabel.append("Pads")
	const countSelect = doc.createElement("select")
	countSelect.id = "focus-stage-count"
	for (const count of [1, 4, 8] as const) {
		const opt = doc.createElement("option")
		opt.value = String(count)
		opt.textContent = String(count)
		countSelect.append(opt)
	}
	countSelect.value = "8"
	countLabel.append(countSelect)

	const scanLabel = doc.createElement("label")
	scanLabel.append("Switch scan")
	const scanSelect = doc.createElement("select")
	scanSelect.id = "focus-stage-scan"
	for (const [value, text] of [
		["0", "Off"],
		["1500", "1-switch auto (1.5s)"],
		["1000", "1-switch auto (1.0s)"],
		["600", "1-switch auto (0.6s)"],
		["2-switch", "2-switch step/select"]
	] as const) {
		const opt = doc.createElement("option")
		opt.value = value
		opt.textContent = text
		scanSelect.append(opt)
	}
	scanLabel.append(scanSelect)

	const releaseLabel = doc.createElement("label")
	releaseLabel.append("Release")
	const releaseSelect = doc.createElement("select")
	releaseSelect.id = "focus-stage-release"
	for (const [value, text] of [
		["timed", "Timed"],
		["latch", "Latch toggle"]
	] as const) {
		const opt = doc.createElement("option")
		opt.value = value
		opt.textContent = text
		releaseSelect.append(opt)
	}
	releaseLabel.append(releaseSelect)

	const cueLabel = doc.createElement("label")
	cueLabel.append("Scan cue")
	const cueSelect = doc.createElement("select")
	cueSelect.id = "focus-stage-cue"
	for (const [value, text] of [
		["off", "Off"],
		["speech", "Speech"],
		["tone", "Soft chime"]
	] as const) {
		const opt = doc.createElement("option")
		opt.value = value
		opt.textContent = text
		cueSelect.append(opt)
	}
	cueLabel.append(cueSelect)

	const dwellLabel = doc.createElement("label")
	dwellLabel.append("Dwell")
	const dwellSelect = doc.createElement("select")
	dwellSelect.id = "focus-stage-dwell"
	for (const [value, text] of [
		["0", "Off"],
		["400", "0.4s"],
		["600", "0.6s"],
		["900", "0.9s"],
		["1200", "1.2s"]
	] as const) {
		const opt = doc.createElement("option")
		opt.value = value
		opt.textContent = text
		dwellSelect.append(opt)
	}
	dwellLabel.append(dwellSelect)

	const cameraBtn = doc.createElement("button")
	cameraBtn.type = "button"
	cameraBtn.id = "focus-stage-camera"
	cameraBtn.textContent = "Camera / Head"

	const calibrateBtn = doc.createElement("button")
	calibrateBtn.type = "button"
	calibrateBtn.id = "focus-stage-calibrate"
	calibrateBtn.textContent = "Calibrate / Link"
	calibrateBtn.hidden = !onCalibrate

	const lowVisionBtn = doc.createElement("button")
	lowVisionBtn.type = "button"
	lowVisionBtn.id = "focus-stage-preset-low-vision"
	lowVisionBtn.textContent = "Low-vision + Speech"

	const deafTactileBtn = doc.createElement("button")
	deafTactileBtn.type = "button"
	deafTactileBtn.id = "focus-stage-preset-deaf-tactile"
	deafTactileBtn.textContent = "Deaf + Haptics"

	toolbar.append(modeLabel, countLabel, scanLabel, releaseLabel, cueLabel, dwellLabel)
	presets.append(cameraBtn, calibrateBtn, lowVisionBtn, deafTactileBtn)
	optionsPanel.append(toolbar, presets)
	options.append(optionsSummary, optionsPanel)
	header.append(identity, options)

	// Main pad grid
	const grid = doc.createElement("div")
	grid.id = "focus-stage-grid"
	grid.className = "focus-stage-grid"
	grid.setAttribute("role", "group")
	grid.setAttribute("aria-label", "Playable instrument pads")

	// Accessible status / screen-reader live region
	const liveRegion = doc.createElement("p")
	liveRegion.id = "focus-stage-live"
	liveRegion.className = "focus-stage-live"
	liveRegion.setAttribute("role", "status")
	liveRegion.setAttribute("aria-live", "polite")

	element.append(header, grid, liveRegion)

	const announce = (text: string) => {
		liveRegion.textContent = text
	}

	const emitNotes = (type: typeof NOTE_ON | typeof NOTE_OFF, notes: number[]) => {
		const chain = manager.activeChain ?? manager.chains[0]
		if (!chain?.isActive) {
			return
		}
		const now = getNow()
		for (const number of notes) {
			const command = Object.assign(new AudioCommand(), {
				type,
				number,
				velocity: type === NOTE_ON ? 105 : 0,
				channel: 1,
				from: "focus-stage",
				startAt: now,
				time: now
			}) as unknown as IAudioCommand
			chain.onInputEvent(new InputAudioEvent(command))
		}
	}

	const releasePad = (index: number) => {
		latchedPads.delete(index)
		const notes = activePadNotes.get(index)
		if (!notes) {
			return
		}
		activePadNotes.delete(index)
		emitNotes(NOTE_OFF, notes)
		const button = grid.querySelector<HTMLButtonElement>(`[data-pad-index="${index}"]`)
		button?.setAttribute("aria-pressed", "false")
		button?.classList.remove("is-active", "is-latched")
	}

	const releaseAllPads = () => {
		for (const timer of activeTimedReleases) {
			clearTimeout(timer)
		}
		activeTimedReleases.clear()
		latchedPads.clear()
		for (const index of activePadNotes.keys()) {
			releasePad(index)
		}
	}

	const triggerPad = (index: number, timedReleaseMs?: number) => {
		const pad = pads[index]
		if (!pad) {
			return
		}
		if (activePadNotes.has(index)) {
			releasePad(index)
		}
		const notes =
			mode === "step"
				? [scalePitchesFrom(manager.harmony ?? DEFAULT_HARMONY, 60, 8)[stepCursor++ % 8]]
				: pad.notes
		activePadNotes.set(index, notes)
		emitNotes(NOTE_ON, notes)
		const button = grid.querySelector<HTMLButtonElement>(`[data-pad-index="${index}"]`)
		button?.setAttribute("aria-pressed", "true")
		button?.classList.add("is-active")
		announce(
			mode === "step"
				? `Played ${NOTE_NAMES[mod12(notes[0])]} (${describeHarmony(manager.harmony ?? DEFAULT_HARMONY)})`
				: `Playing ${pad.label} (${pad.sublabel})`
		)
		if (timedReleaseMs) {
			const releaseTimer = setTimeout(() => {
				activeTimedReleases.delete(releaseTimer)
				releasePad(index)
			}, timedReleaseMs)
			activeTimedReleases.add(releaseTimer)
		}
	}

	const activateWithReleaseMode = (
		index: number,
		modeOverride: SwitchReleaseMode = releaseMode,
		timedReleaseMs = 450
	) => {
		if (modeOverride === "latch") {
			if (latchedPads.has(index)) {
				releasePad(index)
				announce(`Released ${pads[index]?.label ?? "pad"}.`)
			} else {
				triggerPad(index)
				latchedPads.add(index)
				const button = grid.querySelector<HTMLButtonElement>(`[data-pad-index="${index}"]`)
				button?.classList.add("is-latched")
				announce(`Latched ${pads[index]?.label ?? "pad"}. Activate again to release.`)
			}
			return
		}
		triggerPad(index, timedReleaseMs)
	}

	const highlightScan = (scannedIndex: number | null) => {
		const buttons = [...grid.querySelectorAll<HTMLButtonElement>(".focus-stage-pad")]
		buttons.forEach((btn, idx) => {
			const scanned = scannedIndex !== null && idx === scannedIndex
			btn.classList.toggle("is-scanned", scanned)
			if (scanned) {
				btn.setAttribute("aria-current", "true")
			} else {
				btn.removeAttribute("aria-current")
			}
		})
	}

	const scanner = createSwitchScanner({
		getPadCount: () => pads.length,
		getPadInfo: (idx) => {
			const pad = pads[idx]
			return pad ? { label: pad.label, pitch: pad.notes[0] } : undefined
		},
		onHighlight: highlightScan,
		onActivate: (idx, activeReleaseMode, timedMs) => {
			activateWithReleaseMode(idx, activeReleaseMode, timedMs ?? 450)
		},
		audioContext,
		outputNode,
		win: doc.defaultView
	})

	const dwell = createDwellController({
		grid,
		getDwellMs: () => dwellMs,
		onActivate: (idx) => {
			activateWithReleaseMode(idx, releaseMode, 450)
		}
	})

	const renderPads = () => {
		dwell.cancel()
		releaseAllPads()
		const harmony = manager.harmony ?? DEFAULT_HARMONY
		harmonyBadge.textContent = describeHarmony(harmony)
		countSelect.disabled = mode === "step"
		pads = buildStagePads(harmony, mode, padCount)
		grid.dataset.padCount = String(pads.length)
		grid.dataset.stageMode = mode
		grid.replaceChildren()

		pads.forEach((pad, idx) => {
			const btn = doc.createElement("button")
			btn.type = "button"
			btn.className = `focus-stage-pad focus-stage-pad-${(idx % 8) + 1}`
			btn.dataset.padIndex = String(pad.index)
			btn.setAttribute("aria-label", pad.ariaLabel)
			btn.setAttribute("aria-pressed", "false")

			const top = doc.createElement("span")
			top.className = "focus-stage-pad-meta"
			const sym = doc.createElement("span")
			sym.className = "focus-stage-pad-symbol"
			sym.setAttribute("aria-hidden", "true")
			sym.textContent = pad.symbol
			const key = doc.createElement("kbd")
			key.textContent = pad.shortcut
			top.append(sym, key)

			const mainLabel = doc.createElement("span")
			mainLabel.className = "focus-stage-pad-label"
			mainLabel.textContent = pad.label

			const sub = doc.createElement("span")
			sub.className = "focus-stage-pad-sublabel"
			sub.textContent = pad.sublabel

			btn.append(top, mainLabel, sub)

			btn.addEventListener(EVENT_POINTER_DOWN, (event) => {
				event.preventDefault()
				if (releaseMode === "latch") {
					activateWithReleaseMode(pad.index, "latch")
				} else {
					triggerPad(pad.index)
				}
			})
			btn.addEventListener(EVENT_POINTER_UP, () => {
				if (releaseMode !== "latch") {
					releasePad(pad.index)
				}
			})
			btn.addEventListener(EVENT_POINTER_CANCEL, () => {
				if (releaseMode !== "latch") {
					releasePad(pad.index)
				}
			})
			btn.addEventListener(EVENT_POINTER_LEAVE, () => {
				if (releaseMode !== "latch") {
					releasePad(pad.index)
				}
			})

			grid.append(btn)
		})

		if (active) {
			scanner.start()
		}
	}

	const onKeyDown = (event: KeyboardEvent) => {
		if (!active || event.repeat) {
			return
		}
		const target = event.target as HTMLElement | null
		if (target && ["SELECT", "INPUT", "TEXTAREA"].includes(target.tagName)) {
			return
		}
		// Never hijack activation keys when focus is on a non-pad interactive control (e.g. options or Exit)
		const onNonPadControl =
			!!target &&
			!target.classList.contains("focus-stage-pad") &&
			Boolean(target.closest("button, a, summary, [role='tab'], [role='menuitem']"))
		if (onNonPadControl && (event.code === "Space" || event.key === "Enter")) {
			return
		}

		// 1-switch auto-scan or 2-switch step/select
		if (scanner.handleKeyDown(event)) {
			return
		}

		// 1-button step mode via Space / Enter
		if (mode === "step" && (event.code === "Space" || event.key === "Enter")) {
			event.preventDefault()
			triggerPad(0)
			return
		}

		// Direct number shortcuts 1..8 (respect modifier keys and character-shortcut opt-out)
		if (
			/^[1-8]$/.test(event.key) &&
			!event.ctrlKey &&
			!event.metaKey &&
			!event.altKey &&
			doc.documentElement.dataset.shortcuts !== "off"
		) {
			const idx = Number(event.key) - 1
			if (idx < pads.length) {
				event.preventDefault()
				if (releaseMode === "latch") {
					activateWithReleaseMode(idx, "latch")
				} else {
					triggerPad(idx)
				}
			}
			return
		}

		// Keyboard play on focused pad
		if (
			target?.classList.contains("focus-stage-pad") &&
			(event.code === "Space" || event.key === "Enter")
		) {
			event.preventDefault()
			const idx = Number(target.dataset.padIndex)
			if (releaseMode === "latch") {
				activateWithReleaseMode(idx, "latch")
			} else {
				triggerPad(idx)
			}
			return
		}

		// Roving focus with arrow keys
		if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) {
			const buttons = [...grid.querySelectorAll<HTMLButtonElement>(".focus-stage-pad")]
			if (!buttons.length) {
				return
			}
			event.preventDefault()
			const current = buttons.indexOf(doc.activeElement as HTMLButtonElement)
			const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1
			const next =
				current < 0 ? 0 : (current + delta + buttons.length) % buttons.length
			buttons[next].focus()
		}
	}

	const onKeyUp = (event: KeyboardEvent) => {
		if (!active || releaseMode === "latch" || scanner.isActive()) {
			return
		}
		if (mode === "step" && (event.code === "Space" || event.key === "Enter")) {
			releasePad(0)
			return
		}
		if (/^[1-8]$/.test(event.key)) {
			releasePad(Number(event.key) - 1)
			return
		}
		const target = event.target as HTMLElement | null
		if (
			target?.classList.contains("focus-stage-pad") &&
			(event.code === "Space" || event.key === "Enter")
		) {
			releasePad(Number(target.dataset.padIndex))
		}
	}

	/** Called by the host once the stage is on screen. */
	const activate = () => {
		active = true
		renderPads()
		scanner.start()
		grid.querySelector<HTMLButtonElement>(".focus-stage-pad")?.focus()
		announce(
			`Focus Stage opened in ${describeHarmony(manager.harmony ?? DEFAULT_HARMONY)}. ${pads.length} ${pads.length === 1 ? "pad" : "pads"} ready.`
		)
	}

	const deactivate = () => {
		active = false
		scanner.stop()
		dwell.cancel()
		releaseAllPads()
	}

	/** Without a view the host opens the chain's controls, falling back to pads. */
	const open = (view?: PerformanceView) => host?.show(view)
	const close = () => host?.hide()

	openButton?.addEventListener(EVENT_CLICK, () => open(), { signal: abort.signal })
	// The host traps focus in the fullscreen view, so shortcuts also work from its header.
	doc.addEventListener(EVENT_KEY_DOWN, onKeyDown, { signal: abort.signal })
	doc.addEventListener(EVENT_KEY_UP, onKeyUp, { signal: abort.signal })

	modeSelect.addEventListener(
		EVENT_CHANGE,
		() => {
			mode = modeSelect.value as FocusStageMode
			renderPads()
			announce(`Switched to ${modeSelect.selectedOptions[0]?.textContent ?? mode}.`)
		},
		{ signal: abort.signal }
	)

	countSelect.addEventListener(
		EVENT_CHANGE,
		() => {
			const next = Number(countSelect.value)
			if (next === 1 || next === 4 || next === 8) {
				padCount = next
				renderPads()
			}
		},
		{ signal: abort.signal }
	)

	scanSelect.addEventListener(
		EVENT_CHANGE,
		() => {
			if (scanSelect.value === "2-switch") {
				scanner.configure({ mode: "step-2-switch" })
				if (active) {
					scanner.start()
				}
				announce(
					"2-switch step/select enabled. Press Right Arrow, Down Arrow, or Right Shift to move, Space or Enter to play."
				)
				return
			}
			const interval = Number(scanSelect.value) || 0
			if (interval > 0) {
				scanner.configure({ mode: "auto-1-switch", scanMs: interval })
				if (active) {
					scanner.start()
				}
				announce(
					`1-switch auto-scan enabled every ${(interval / 1000).toFixed(1)} seconds. Press Space or Enter to play the highlighted pad.`
				)
			} else {
				scanner.configure({ mode: "off" })
				announce("Switch scanning turned off.")
			}
		},
		{ signal: abort.signal }
	)

	releaseSelect.addEventListener(
		EVENT_CHANGE,
		() => {
			releaseMode = releaseSelect.value === "latch" ? "latch" : "timed"
			scanner.configure({ releaseMode })
			releaseAllPads()
			announce(
				releaseMode === "latch"
					? "Latch toggle mode enabled: activate once to hold, again to release."
					: "Timed release mode enabled."
			)
		},
		{ signal: abort.signal }
	)

	cueSelect.addEventListener(
		EVENT_CHANGE,
		() => {
			const cue = cueSelect.value as AuditoryCueMode
			scanner.configure({ auditoryCue: cue })
			announce(`Scan auditory cue set to ${cue}.`)
		},
		{ signal: abort.signal }
	)

	dwellSelect.addEventListener(
		EVENT_CHANGE,
		() => {
			dwellMs = Number(dwellSelect.value) || 0
			dwell.cancel()
			announce(
				dwellMs > 0
					? `Pointer dwell activation enabled (${(dwellMs / 1000).toFixed(1)} seconds).`
					: "Pointer dwell activation turned off."
			)
		},
		{ signal: abort.signal }
	)

	cameraBtn.addEventListener(
		EVENT_CLICK,
		() => {
			void attachCameraGestures(manager)
				.then((result) => announce(result.summary))
				.catch((error) =>
					announce(error instanceof Error ? error.message : String(error))
				)
		},
		{ signal: abort.signal }
	)

	calibrateBtn.addEventListener(
		EVENT_CLICK,
		() => {
			onCalibrate?.()
		},
		{ signal: abort.signal }
	)

	const runSensoryPreset = async (presetId: "low-vision" | "deaf-tactile") => {
		try {
			const result = await applySensoryPreset(manager, presetId, accessibility)
			announce(result.summary)
		} catch (error) {
			announce(error instanceof Error ? error.message : String(error))
		}
	}

	lowVisionBtn.addEventListener(EVENT_CLICK, () => void runSensoryPreset("low-vision"), {
		signal: abort.signal
	})
	deafTactileBtn.addEventListener(EVENT_CLICK, () => void runSensoryPreset("deaf-tactile"), {
		signal: abort.signal
	})

	manager.addEventListener(
		EVENT_HARMONY_CHANGED,
		() => {
			if (active) {
				renderPads()
			}
		},
		{ signal: abort.signal }
	)

	const syncBeatVisibility = () => {
		const enabled = accessibility.getPreferences().beatFlash
		beatPill.classList.toggle("is-enabled", enabled)
	}
	accessibility.addEventListener(EVENT_ACCESSIBILITY_CHANGED, syncBeatVisibility, {
		signal: abort.signal
	})
	syncBeatVisibility()

	const pulseBeat = (beatIndex: number, beatsPerBar = 4) => {
		const beatInBar = (beatIndex % Math.max(1, beatsPerBar)) + 1
		beatPill.textContent = `Beat ${beatInBar}`
		const prefs = accessibility.getPreferences()
		const prefersReduced =
			prefs.reducedMotion === "reduce" ||
			(prefs.reducedMotion === "system" &&
				Boolean(doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches))
		if (!prefs.beatFlash || prefersReduced) {
			return
		}
		// Enforce WCAG 2.3.1: never exceed 3 visual flashes in any 1-second window.
		const now = Date.now()
		beatPulseTimestamps = beatPulseTimestamps.filter((t) => now - t < 1000)
		if (beatPulseTimestamps.length >= 3) {
			return
		}
		beatPulseTimestamps.push(now)
		const downbeat = beatInBar === 1
		beatPill.classList.toggle("is-downbeat", downbeat)
		beatPill.classList.add("is-pulsing")
		doc.documentElement.dataset.beatPulse = downbeat ? "downbeat" : "beat"
		clearTimeout(beatTimeout)
		beatTimeout = setTimeout(() => {
			beatPill.classList.remove("is-pulsing")
			delete doc.documentElement.dataset.beatPulse
		}, 140)
	}

	const applyProfile = (profile: Partial<AccessProfile>) => {
		if (profile.stageMode) {
			mode = profile.stageMode
			modeSelect.value = mode
		}
		if (profile.padCount === 1 || profile.padCount === 4 || profile.padCount === 8) {
			padCount = profile.padCount
			countSelect.value = String(padCount)
		}
		if (profile.releaseMode) {
			releaseMode = profile.releaseMode
			releaseSelect.value = releaseMode
		}
		if (profile.auditoryCue) {
			cueSelect.value = profile.auditoryCue
		}
		if (typeof profile.dwellMs === "number") {
			dwellMs = profile.dwellMs
			dwellSelect.value = String(dwellMs)
		}
		if (profile.scanMode || typeof profile.scanMs === "number") {
			const nextScanMode = profile.scanMode ?? scanner.getConfig().mode
			const nextScanMs = profile.scanMs ?? scanner.getConfig().scanMs
			scanner.configure({
				mode: nextScanMode,
				scanMs: nextScanMs,
				releaseMode,
				auditoryCue: (profile.auditoryCue ?? scanner.getConfig().auditoryCue) as AuditoryCueMode
			})
			scanSelect.value =
				nextScanMode === "step-2-switch"
					? "2-switch"
					: nextScanMode === "auto-1-switch"
						? String(nextScanMs)
						: "0"
		}
		if (active) {
			renderPads()
		}
	}

	const getStageConfig = (): Partial<AccessProfile> => {
		const scan = scanner.getConfig()
		return {
			stageMode: mode,
			padCount,
			scanMode: scan.mode,
			scanMs: scan.scanMs,
			releaseMode,
			auditoryCue: scan.auditoryCue,
			dwellMs
		}
	}

	return {
		element,
		open,
		close,
		activate,
		deactivate,
		isActive: () => active,
		/** The latest host wins; the returned function detaches it. */
		attach(next: FocusStageHost) {
			host = next
			return () => {
				if (host === next) {
					host = undefined
				}
			}
		},
		pulseBeat,
		applyProfile,
		getStageConfig,
		getPads: () => pads,
		destroy() {
			scanner.stop()
			dwell.destroy()
			releaseAllPads()
			clearTimeout(beatTimeout)
			abort.abort()
			close()
			element.remove()
		}
	}
}

export type FocusStage = ReturnType<typeof createFocusStage>
