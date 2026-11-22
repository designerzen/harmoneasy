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
import { announceLive } from "../source/libs/dialog-utils"
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

function clearAccessibilityDataset() {
	delete document.documentElement.dataset.contrast
	delete document.documentElement.dataset.palette
	delete document.documentElement.dataset.targetSize
	delete document.documentElement.dataset.fontScale
	delete document.documentElement.dataset.textSpacing
	delete document.documentElement.dataset.readableFont
	delete document.documentElement.dataset.focusIndicator
	delete document.documentElement.dataset.underlineLinks
	delete document.documentElement.dataset.reducedMotion
	delete document.documentElement.dataset.announcements
	delete document.documentElement.dataset.beatFlash
	delete document.documentElement.dataset.beatPulse
	delete document.documentElement.dataset.shortcuts
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
		clearAccessibilityDataset()
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

	it("applies, persists, and resets Settings refinements & overrides including typography, focus ring, link underlines, motion override, announcements, and quick presets", async () => {
		const onSensoryPreset = vi.fn(async (preset: string) => `Applied ${preset} outputs.`)
		const controls = createAccessibilityControls(document, { onSensoryPreset })

		const fontScale = document.getElementById("a11y-font-scale") as HTMLSelectElement
		const textSpacing = document.getElementById("a11y-text-spacing") as HTMLSelectElement
		const readableFont = document.getElementById("a11y-readable-font") as HTMLSelectElement
		const focusIndicator = document.getElementById("a11y-focus-indicator") as HTMLSelectElement
		const underlineLinks = document.getElementById("a11y-underline-links") as HTMLInputElement
		const motion = document.getElementById("a11y-reduced-motion") as HTMLSelectElement
		const announcements = document.getElementById("a11y-announcements") as HTMLSelectElement

		fontScale.value = "xlarge"
		fontScale.dispatchEvent(new Event(EVENT_CHANGE))
		textSpacing.value = "wide"
		textSpacing.dispatchEvent(new Event(EVENT_CHANGE))
		readableFont.value = "sans"
		readableFont.dispatchEvent(new Event(EVENT_CHANGE))
		focusIndicator.value = "maximum"
		focusIndicator.dispatchEvent(new Event(EVENT_CHANGE))
		underlineLinks.checked = true
		underlineLinks.dispatchEvent(new Event(EVENT_CHANGE))
		motion.value = "allow"
		motion.dispatchEvent(new Event(EVENT_CHANGE))
		announcements.value = "minimal"
		announcements.dispatchEvent(new Event(EVENT_CHANGE))

		expect(document.documentElement.dataset.fontScale).toBe("xlarge")
		expect(document.documentElement.dataset.textSpacing).toBe("wide")
		expect(document.documentElement.dataset.readableFont).toBe("sans")
		expect(document.documentElement.dataset.focusIndicator).toBe("maximum")
		expect(document.documentElement.dataset.underlineLinks).toBe("on")
		expect(document.documentElement.dataset.reducedMotion).toBe("allow")
		expect(document.documentElement.dataset.announcements).toBe("minimal")

		// Minimal announcements suppresses polite live updates while still allowing assertive alerts
		announceLive("Polite update", "polite", document)
		announceLive("Urgent alert", "assertive", document)
		await Promise.resolve()
		expect(document.getElementById("app-live-status")).toBeNull()
		expect(document.getElementById("app-live-alert")?.textContent).toBe("Urgent alert")

		// Settings quick preset button updates visual prefs and invokes sensory callback
		document.getElementById("a11y-preset-low-vision")!.dispatchEvent(new Event(EVENT_CLICK))
		await Promise.resolve()
		expect(onSensoryPreset).toHaveBeenCalledWith("low-vision")
		expect(controls.getPreferences()).toMatchObject({
			contrast: "high",
			targetSize: "xlarge",
			palette: "colorblind-safe",
			fontScale: "large",
			focusIndicator: "enhanced"
		})
		expect(document.getElementById("a11y-status")!.textContent).toBe("Applied low-vision outputs.")

		// Reloading restores every refinement & override
		controls.destroy()
		const restored = createAccessibilityControls(document)
		expect(restored.getPreferences()).toMatchObject({
			contrast: "high",
			targetSize: "xlarge",
			palette: "colorblind-safe",
			fontScale: "large",
			textSpacing: "wide",
			readableFont: "sans",
			focusIndicator: "enhanced",
			underlineLinks: true,
			reducedMotion: "allow",
			announcements: "minimal"
		})

		// Reset clears all new data attributes back to defaults
		document.getElementById("a11y-reset")!.dispatchEvent(new Event(EVENT_CLICK))
		expect(restored.getPreferences()).toEqual(DEFAULT_ACCESSIBILITY)
		expect(document.documentElement.dataset.fontScale).toBeUndefined()
		expect(document.documentElement.dataset.textSpacing).toBeUndefined()
		expect(document.documentElement.dataset.readableFont).toBeUndefined()
		expect(document.documentElement.dataset.focusIndicator).toBeUndefined()
		expect(document.documentElement.dataset.underlineLinks).toBeUndefined()
		expect(document.documentElement.dataset.reducedMotion).toBeUndefined()
		expect(document.documentElement.dataset.announcements).toBeUndefined()
		restored.destroy()
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
		clearAccessibilityDataset()
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

	it("avoids keyboard traps in 2-switch mode, preserves toolbar button activation, and caps beat flashes at 3 Hz", () => {
		vi.useFakeTimers()
		const controls = createAccessibilityControls(document)
		const { manager, received } = createFakeManager()
		const stage = createFocusStage({ manager, doc: document, accessibility: controls })

		stage.open()

		// Enable 2-switch mode: Tab must NOT be prevented so keyboard users can reach Exit/toolbar
		const scanSelect = stage.dialog.querySelector<HTMLSelectElement>("#focus-stage-scan")!
		scanSelect.value = "2-switch"
		scanSelect.dispatchEvent(new Event(EVENT_CHANGE))

		const tabEvent = new KeyboardEvent(EVENT_KEY_DOWN, {
			key: "Tab",
			bubbles: true,
			cancelable: true
		})
		stage.dialog.dispatchEvent(tabEvent)
		expect(tabEvent.defaultPrevented).toBe(false)

		// Space/Enter on Exit Focus Stage button must NOT be hijacked to play a pad
		const exitBtn = stage.dialog.querySelector<HTMLButtonElement>("#focus-stage-close")!
		exitBtn.focus()
		const enterOnExit = new KeyboardEvent(EVENT_KEY_DOWN, {
			key: "Enter",
			bubbles: true,
			cancelable: true
		})
		exitBtn.dispatchEvent(enterOnExit)
		expect(enterOnExit.defaultPrevented).toBe(false)
		expect(received).toHaveLength(0)

		// Character shortcuts respect global opt-out (#a11y-shortcuts)
		controls.update({ characterShortcuts: false })
		expect(document.documentElement.dataset.shortcuts).toBe("off")
		stage.dialog.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: "1", bubbles: true }))
		expect(received).toHaveLength(0)

		// Beat flash never exceeds 3 flashes per second (WCAG 2.3.1) and stops under reduced motion
		controls.update({ beatFlash: true, reducedMotion: "system" })
		let flashes = 0
		for (let i = 0; i < 6; i++) {
			stage.pulseBeat(i, 4)
			if (document.documentElement.dataset.beatPulse) {
				flashes++
			}
			vi.advanceTimersByTime(150)
		}
		expect(flashes).toBeLessThanOrEqual(3)

		vi.advanceTimersByTime(1100)
		controls.update({ reducedMotion: "reduce" })
		stage.pulseBeat(0, 4)
		expect(document.documentElement.dataset.beatPulse).toBeUndefined()

		stage.destroy()
		controls.destroy()
	})
})

describe("WCAG 2.2 document landmarks, skip links, headings, and modal helpers", () => {
	it("provides skip link, banner/main landmarks, h1, normalized dialog headings, and template dialog labels", () => {
		const html = readFileSync("index.html", "utf8")
		const doc = new DOMParser().parseFromString(html, "text/html")

		const skipLink = doc.querySelector<HTMLAnchorElement>("a.skip-link")
		expect(skipLink?.getAttribute("href")).toBe("#main-content")
		expect(doc.querySelector("header#action-bar")).not.toBeNull()
		expect(doc.querySelector("main#main-content h1")).not.toBeNull()
		expect(doc.querySelectorAll("dialog header h5")).toHaveLength(0)
		expect(doc.querySelector("#a11y-shortcuts")).not.toBeNull()
		expect(doc.querySelector("#export-overlay")?.getAttribute("aria-labelledby")).toBe(
			"export-overlay-title"
		)

		for (const id of [
			"add-input-overlay-template",
			"add-output-overlay-template",
			"add-instrument-overlay-template",
			"error-overlay-template"
		]) {
			const template = doc.getElementById(id) as HTMLTemplateElement
			const dialog = template.content.querySelector("dialog")!
			const labelledBy = dialog.getAttribute("aria-labelledby")
			expect(labelledBy, `${id} dialog aria-labelledby`).toBeTruthy()
			expect(
				template.content.getElementById(labelledBy!),
				`${id} referenced heading exists inside template`
			).not.toBeNull()
		}
	})
})
