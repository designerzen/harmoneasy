// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { Storage } from "happy-dom"
import { NOTE_OFF, NOTE_ON } from "../../../packages/audiobus/commands/commands"
import {
	EVENT_CHANGE,
	EVENT_CLICK,
	EVENT_HARMONY_CHANGED,
	EVENT_KEY_DOWN,
	EVENT_KEY_UP,
	EVENT_POINTER_DOWN,
	EVENT_POINTER_UP
} from "../../../packages/audiobus/events/event-constants"
import { defineDevice } from "../../../packages/audiobus/io/device-definition"
import { DEFAULT_HARMONY, type HarmonicState } from "../../../packages/audiobus/io/harmony"
import {
	DESCRIBE,
	NOTATION,
	SPEECH_SYNTHESIS,
	VIBRATOR
} from "../../../packages/audiobus/io/outputs/output-types"
import type IOChainManager from "../../../packages/audiobus/io/IO-chain-manager"
import {
	ACCESSIBILITY_STORAGE_KEY,
	applySensoryPreset,
	createAccessibilityControls,
	DEFAULT_ACCESSIBILITY
} from "../source/services/accessibility"
import { buildStagePads, createFocusStage } from "../source/services/focus-stage"
import { THEME_STORAGE_KEY } from "../source/services/theme"

vi.mock("audiobus/io/output-factory", () => ({
	createOutputById: vi.fn(async (type: string) => {
		const output = {
			name: `Mock ${type}`,
			connect: vi.fn(async () => {})
		}
		defineDevice(output, { factory: "output", type })
		return output
	})
}))

function mountAccessibilityHtml() {
	const html = readFileSync("index.html", "utf8")
	const fieldsetStart = html.indexOf('<fieldset id="accessibility-settings">')
	const fieldsetEnd = html.indexOf("</fieldset>", fieldsetStart) + 11
	const buttonMatch = html.match(/<button[\s\S]*?id="btn-focus-stage"[\s\S]*?<\/button>/)
	document.body.innerHTML = `${buttonMatch?.[0] ?? ""}${html.slice(fieldsetStart, fieldsetEnd)}`
}

function createFakeManager(harmony: HarmonicState = DEFAULT_HARMONY) {
	const events = new EventTarget()
	const received: Array<{ type: string; number: number; velocity: number; from: string }> = []
	const outputs: any[] = []
	const chain = {
		isActive: true,
		outputs,
		onInputEvent: vi.fn((event: { command: any }) => {
			received.push({
				type: event.command.type,
				number: event.command.number,
				velocity: event.command.velocity,
				from: event.command.from
			})
		})
	}
	const manager = Object.assign(events, {
		harmony,
		chains: [chain],
		activeChain: chain,
		deviceOptions: { now: () => 0, getBpm: () => 120 },
		addDevice: vi.fn((targetChain: typeof chain, device: any, direction: "input" | "output") => {
			if (direction === "output") {
				targetChain.outputs.push(device)
			}
		})
	}) as unknown as IOChainManager & {
		harmony: HarmonicState
		addDevice: ReturnType<typeof vi.fn>
	}
	return { manager, chain, received }
}

describe("Accessibility preferences and sensory presets", () => {
	beforeEach(() => {
		vi.stubGlobal("localStorage", new Storage())
		mountAccessibilityHtml()
	})

	afterEach(() => {
		vi.restoreAllMocks()
		localStorage.clear()
		vi.unstubAllGlobals()
		document.body.replaceChildren()
		delete document.documentElement.dataset.contrast
		delete document.documentElement.dataset.palette
		delete document.documentElement.dataset.targetSize
		delete document.documentElement.dataset.reducedMotion
		delete document.documentElement.dataset.beatFlash
		delete document.documentElement.dataset.beatPulse
	})

	it("persists accessibility attributes independently of theme storage and resets cleanly", () => {
		localStorage.setItem(THEME_STORAGE_KEY, '{"hue":290,"mode":"dark"}')
		const controls = createAccessibilityControls(document)

		const contrast = document.getElementById("a11y-contrast") as HTMLSelectElement
		const palette = document.getElementById("a11y-palette") as HTMLSelectElement
		const targetSize = document.getElementById("a11y-target-size") as HTMLSelectElement
		const motion = document.getElementById("a11y-reduced-motion") as HTMLSelectElement
		const beatFlash = document.getElementById("a11y-beat-flash") as HTMLInputElement

		contrast.value = "high"
		contrast.dispatchEvent(new Event(EVENT_CHANGE))
		palette.value = "colorblind-safe"
		palette.dispatchEvent(new Event(EVENT_CHANGE))
		targetSize.value = "xlarge"
		targetSize.dispatchEvent(new Event(EVENT_CHANGE))
		motion.value = "reduce"
		motion.dispatchEvent(new Event(EVENT_CHANGE))
		beatFlash.checked = true
		beatFlash.dispatchEvent(new Event(EVENT_CHANGE))

		expect(document.documentElement.dataset.contrast).toBe("high")
		expect(document.documentElement.dataset.palette).toBe("colorblind-safe")
		expect(document.documentElement.dataset.targetSize).toBe("xlarge")
		expect(document.documentElement.dataset.reducedMotion).toBe("reduce")
		expect(document.documentElement.dataset.beatFlash).toBe("on")
		expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('{"hue":290,"mode":"dark"}')

		controls.destroy()
		const restored = createAccessibilityControls(document)
		expect(restored.getPreferences()).toEqual({
			...DEFAULT_ACCESSIBILITY,
			contrast: "high",
			palette: "colorblind-safe",
			targetSize: "xlarge",
			reducedMotion: "reduce",
			beatFlash: true
		})

		document.getElementById("a11y-reset")!.dispatchEvent(new Event(EVENT_CLICK))
		expect(restored.getPreferences()).toEqual(DEFAULT_ACCESSIBILITY)
		expect(document.documentElement.dataset.contrast).toBeUndefined()
		expect(document.documentElement.dataset.palette).toBeUndefined()
		expect(document.documentElement.dataset.targetSize).toBeUndefined()
		expect(document.documentElement.dataset.reducedMotion).toBeUndefined()
		expect(document.documentElement.dataset.beatFlash).toBeUndefined()
		expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('{"hue":290,"mode":"dark"}')
		restored.destroy()
	})

	it("recovers safely from corrupt or blocked localStorage", () => {
		localStorage.setItem(ACCESSIBILITY_STORAGE_KEY, "{broken")
		const controls = createAccessibilityControls(document)
		expect(controls.getPreferences()).toEqual(DEFAULT_ACCESSIBILITY)
		controls.destroy()

		vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
			throw new Error("blocked")
		})
		const blocked = createAccessibilityControls(document)
		expect(() => blocked.update({ contrast: "high" })).not.toThrow()
		expect(document.documentElement.dataset.contrast).toBe("high")
		expect(document.getElementById("a11y-status")!.textContent).toContain("unavailable")
		blocked.destroy()
	})

	it("attaches low-vision and deaf-tactile multimodal outputs without duplicating", async () => {
		const controls = createAccessibilityControls(document)
		const { manager, chain } = createFakeManager()

		const first = await applySensoryPreset(manager, "low-vision", controls)
		expect(first.addedOutputs).toEqual([DESCRIBE, SPEECH_SYNTHESIS])
		expect(controls.getPreferences()).toMatchObject({
			contrast: "high",
			targetSize: "xlarge",
			palette: "colorblind-safe"
		})
		expect(chain.outputs).toHaveLength(2)

		// Applying the same preset again must not duplicate outputs on the chain
		const second = await applySensoryPreset(manager, "low-vision", controls)
		expect(second.addedOutputs).toEqual([])
		expect(chain.outputs).toHaveLength(2)

		const tactile = await applySensoryPreset(manager, "deaf-tactile", controls)
		expect(tactile.addedOutputs).toEqual([NOTATION, VIBRATOR])
		expect(controls.getPreferences().beatFlash).toBe(true)
		expect(chain.outputs).toHaveLength(4)

		controls.destroy()
	})
})

describe("Focus Stage instrument view", () => {
	beforeEach(() => {
		vi.stubGlobal("localStorage", new Storage())
		mountAccessibilityHtml()
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
		localStorage.clear()
		vi.unstubAllGlobals()
		document.body.replaceChildren()
		delete document.documentElement.dataset.contrast
		delete document.documentElement.dataset.palette
		delete document.documentElement.dataset.targetSize
		delete document.documentElement.dataset.reducedMotion
		delete document.documentElement.dataset.beatFlash
		delete document.documentElement.dataset.beatPulse
	})

	it("builds distinct symbol-badged scale, chord, and 1-button step pads from harmony", () => {
		const scalePads = buildStagePads(DEFAULT_HARMONY, "scale", 8)
		expect(scalePads).toHaveLength(8)
		expect(new Set(scalePads.map((p) => p.symbol)).size).toBe(8)
		expect(scalePads[0].label).toBe("C")
		expect(scalePads[0].notes).toEqual([60])

		const chordPads = buildStagePads(DEFAULT_HARMONY, "chords", 4)
		expect(chordPads).toHaveLength(4)
		expect(chordPads[0].label).toBe("C")
		expect(chordPads[0].notes).toEqual([60, 64, 67])
		expect(chordPads[1].label).toBe("Dm")
		expect(chordPads[1].sublabel).toBe("ii chord")

		const stepPads = buildStagePads(DEFAULT_HARMONY, "step", 8)
		expect(stepPads).toHaveLength(1)
		expect(stepPads[0].label).toBe("Next note")
	})

	it("emits NOTE_ON/NOTE_OFF for pointer, keyboard shortcuts, roving arrows, step mode, and closes cleanly", () => {
		const controls = createAccessibilityControls(document)
		const { manager, received } = createFakeManager()
		const stage = createFocusStage({ manager, doc: document, accessibility: controls })

		document.getElementById("btn-focus-stage")!.dispatchEvent(new Event(EVENT_CLICK))
		expect(stage.dialog.open).toBe(true)

		// Pointer press & release on pad 1 (C4 = 60)
		const firstPad = stage.dialog.querySelector<HTMLButtonElement>('[data-pad-index="0"]')!
		firstPad.dispatchEvent(new Event(EVENT_POINTER_DOWN, { bubbles: true }))
		expect(received.at(-1)).toMatchObject({ type: NOTE_ON, number: 60, from: "focus-stage" })
		expect(firstPad.getAttribute("aria-pressed")).toBe("true")
		expect(stage.dialog.querySelector("#focus-stage-live")!.textContent).toContain("Playing C")

		firstPad.dispatchEvent(new Event(EVENT_POINTER_UP, { bubbles: true }))
		expect(received.at(-1)).toMatchObject({ type: NOTE_OFF, number: 60 })
		expect(firstPad.getAttribute("aria-pressed")).toBe("false")

		// Roving focus via ArrowRight
		firstPad.focus()
		stage.dialog.dispatchEvent(
			new KeyboardEvent(EVENT_KEY_DOWN, { key: "ArrowRight", bubbles: true })
		)
		const secondPad = stage.dialog.querySelector<HTMLButtonElement>('[data-pad-index="1"]')!
		expect(document.activeElement).toBe(secondPad)

		// Keyboard shortcut '2' held open, then closed -> guaranteed NOTE_OFF
		stage.dialog.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: "2", bubbles: true }))
		expect(received.at(-1)).toMatchObject({ type: NOTE_ON, number: 62 })
		stage.close()
		expect(received.at(-1)).toMatchObject({ type: NOTE_OFF, number: 62 })
		expect(stage.dialog.open).toBe(false)

		// Switch to 1-button step mode and advance through notes
		stage.open()
		const modeSelect = stage.dialog.querySelector<HTMLSelectElement>("#focus-stage-mode")!
		modeSelect.value = "step"
		modeSelect.dispatchEvent(new Event(EVENT_CHANGE))
		expect(stage.dialog.querySelectorAll(".focus-stage-pad")).toHaveLength(1)

		stage.dialog.dispatchEvent(
			new KeyboardEvent(EVENT_KEY_DOWN, { code: "Space", key: " ", bubbles: true })
		)
		expect(received.at(-1)).toMatchObject({ type: NOTE_ON, number: 60 })
		stage.dialog.dispatchEvent(
			new KeyboardEvent(EVENT_KEY_UP, { code: "Space", key: " ", bubbles: true })
		)
		stage.dialog.dispatchEvent(
			new KeyboardEvent(EVENT_KEY_DOWN, { code: "Space", key: " ", bubbles: true })
		)
		expect(received.at(-1)).toMatchObject({ type: NOTE_ON, number: 62 })

		// Harmony updates live while open
		manager.harmony = { ...DEFAULT_HARMONY, root: 2 } // D Major
		manager.dispatchEvent(new Event(EVENT_HARMONY_CHANGED))
		expect(stage.dialog.querySelector("#focus-stage-harmony")!.textContent).toContain("D")

		stage.destroy()
		controls.destroy()
	})

	it("supports 1-switch auto-scan activation with timed release and visual beat pulses", () => {
		vi.useFakeTimers()
		const controls = createAccessibilityControls(document)
		const { manager, received } = createFakeManager()
		const stage = createFocusStage({ manager, doc: document, accessibility: controls })

		stage.open()
		const scanSelect = stage.dialog.querySelector<HTMLSelectElement>("#focus-stage-scan")!
		scanSelect.value = "600"
		scanSelect.dispatchEvent(new Event(EVENT_CHANGE))

		// Advance one scan step from pad 0 -> pad 1 (D4 = 62)
		vi.advanceTimersByTime(600)
		const secondPad = stage.dialog.querySelector<HTMLButtonElement>('[data-pad-index="1"]')!
		expect(secondPad.classList.contains("is-scanned")).toBe(true)
		expect(secondPad.getAttribute("aria-current")).toBe("true")

		// Press Space to play the currently scanned pad, then verify timed NOTE_OFF
		stage.dialog.dispatchEvent(
			new KeyboardEvent(EVENT_KEY_DOWN, { code: "Space", key: " ", bubbles: true })
		)
		expect(received.at(-1)).toMatchObject({ type: NOTE_ON, number: 62 })
		vi.advanceTimersByTime(400)
		expect(received.at(-1)).toMatchObject({ type: NOTE_OFF, number: 62 })

		// Visual beat flash pulse on downbeat and offbeat
		controls.update({ beatFlash: true })
		stage.pulseBeat(0, 4)
		expect(document.documentElement.dataset.beatPulse).toBe("downbeat")
		expect(stage.dialog.querySelector("#focus-stage-beat")!.textContent).toBe("Beat 1")
		vi.advanceTimersByTime(150)
		expect(document.documentElement.dataset.beatPulse).toBeUndefined()

		stage.pulseBeat(1, 4)
		expect(document.documentElement.dataset.beatPulse).toBe("beat")
		expect(stage.dialog.querySelector("#focus-stage-beat")!.textContent).toBe("Beat 2")

		stage.destroy()
		controls.destroy()
	})
})
