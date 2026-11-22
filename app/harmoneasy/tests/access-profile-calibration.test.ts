// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Storage } from "happy-dom"
import {
	EVENT_CHANGE,
	EVENT_CLICK,
	EVENT_INPUT,
	EVENT_POINTER_DOWN,
	EVENT_POINTER_UP
} from "../../../packages/audiobus/events/event-constants"
import {
	ACCESS_PROFILE_PARAM,
	buildAccessProfileUrl,
	calibrateDwellTiming,
	calibrateMicThreshold,
	calibrateTapTiming,
	decodeAccessProfile,
	encodeAccessProfile,
	readAccessProfileFromUrl
} from "../source/services/access-profile"
import { createCalibrationDialog } from "../source/services/access-calibration-dialog"
import { createAccessibilityControls } from "../source/services/accessibility"
import { buildSeatPresetUrl } from "../source/services/classroom-session"
import { EVENT_POINTER_OUT, EVENT_POINTER_OVER } from "../source/services/dwell-controller"
import { parsePartsUrl } from "../source/services/parts-url"
import { createSetupWizard } from "../source/services/setup-wizard"

describe("Guided calibration algorithms", () => {
	it("calibrates bounce lockout, tremor hold filter, and comfortable scan tempo from tap samples", () => {
		// Deliberate slow steady taps -> no stabilizer needed, slow scan (1.5s)
		const steady = calibrateTapTiming([
			{ downMs: 0, upMs: 180 },
			{ downMs: 1500, upMs: 1690 },
			{ downMs: 3000, upMs: 3170 }
		])
		expect(steady.stabilizerEnabled).toBe(false)
		expect(steady.scanMs).toBe(1500)

		// Bouncy double-tap + tremor spike -> enables debounce & tremor hold filter, fast scan
		const tremulous = calibrateTapTiming([
			{ downMs: 0, upMs: 35 }, // brief tremor spike
			{ downMs: 90, upMs: 250 }, // bounce within 90ms
			{ downMs: 700, upMs: 880 },
			{ downMs: 1320, upMs: 1480 }
		])
		expect(tremulous.stabilizerEnabled).toBe(true)
		expect(tremulous.debounceMs).toBeGreaterThanOrEqual(120)
		expect(tremulous.holdThresholdMs).toBeGreaterThanOrEqual(50)
		expect(tremulous.scanMs).toBe(600)
	})

	it("calibrates dwell hold times and microphone clap threshold safely", () => {
		expect(calibrateDwellTiming([850, 920, 880]).dwellMs).toBe(900)
		expect(calibrateDwellTiming([380, 410]).dwellMs).toBe(400)

		const mic = calibrateMicThreshold(0.04, 0.44)
		expect(mic.micThreshold).toBeCloseTo(0.22, 2)
		expect(calibrateMicThreshold(0.9, 0.95).micThreshold).toBeLessThanOrEqual(0.75)
	})
})

describe("Portable Access Profile URLs & classroom seat integration", () => {
	it("round-trips profiles through compact URL tokens and rejects malformed payloads", () => {
		const token = encodeAccessProfile({
			label: "Maya — 1-switch chords",
			contrast: "high",
			palette: "colorblind-safe",
			targetSize: "xlarge",
			stabilizerEnabled: true,
			debounceMs: 200,
			holdThresholdMs: 100,
			minDurationMs: 250,
			stageMode: "chords",
			padCount: 4,
			scanMode: "auto-1-switch",
			scanMs: 1500,
			releaseMode: "latch",
			auditoryCue: "speech",
			dwellMs: 600,
			micThreshold: 0.24
		})

		const decoded = decodeAccessProfile(token)
		expect(decoded).toMatchObject({
			label: "Maya — 1-switch chords",
			contrast: "high",
			palette: "colorblind-safe",
			targetSize: "xlarge",
			stabilizerEnabled: true,
			debounceMs: 200,
			holdThresholdMs: 100,
			minDurationMs: 250,
			stageMode: "chords",
			padCount: 4,
			scanMode: "auto-1-switch",
			scanMs: 1500,
			releaseMode: "latch",
			auditoryCue: "speech",
			dwellMs: 600,
			micThreshold: 0.24
		})

		expect(decodeAccessProfile("!!!invalid!!!")).toBeUndefined()
		expect(decodeAccessProfile(btoa('{"__proto__":{"polluted":true}}'))).toBeUndefined()
	})

	it("builds valid /parts/v1/ learner links and accessible classroom seat links", () => {
		const soloUrl = buildAccessProfileUrl({
			location: "https://harmoneasy.app/",
			base: "/",
			profile: {
				label: "Leo",
				contrast: "high",
				stageMode: "chords",
				padCount: 4,
				scanMode: "step-2-switch",
				micThreshold: 0.18
			},
			sensoryPreset: "low-vision",
			roomId: "Room 4B"
		})

		// Must be accepted cleanly by the strict /parts/v1/ parser
		const parsedParts = parsePartsUrl(soloUrl, "/")
		expect(parsedParts).toBeDefined()
		expect(parsedParts!.options.get("inputs")).toContain("microphone-trigger")
		expect(parsedParts!.options.get("outputs")).toContain("speech-synthesis")
		expect(parsedParts!.options.get("config")).toContain("0.18")
		expect(new URL(soloUrl).hash).toContain("room=room-4b")

		const restored = readAccessProfileFromUrl(soloUrl)
		expect(restored?.label).toBe("Leo")
		expect(restored?.scanMode).toBe("step-2-switch")
		expect(restored?.micThreshold).toBe(0.18)

		// Classroom seat preset link with embedded AccessProfile
		const seatUrl = buildSeatPresetUrl({
			location: "https://harmoneasy.app/",
			base: "/",
			roomId: "band-101",
			role: "chords",
			seatName: "Sam",
			accessProfile: {
				contrast: "high",
				beatFlash: true,
				dwellMs: 900
			}
		})
		expect(parsePartsUrl(seatUrl, "/")).toBeDefined()
		expect(new URL(seatUrl).searchParams.has(ACCESS_PROFILE_PARAM)).toBe(true)
		expect(readAccessProfileFromUrl(seatUrl)).toMatchObject({
			contrast: "high",
			beatFlash: true,
			dwellMs: 900
		})
	})
})

describe("Guided calibration dialog & Setup Wizard entry point", () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
		vi.stubGlobal("localStorage", new Storage())
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
		localStorage.clear()
		vi.unstubAllGlobals()
		document.body.replaceChildren()
	})

	it("calibrates via interactive taps and dwell hover, builds a portable URL, and applies on submit", () => {
		const controls = createAccessibilityControls(document)
		const onApply = vi.fn()
		const cal = createCalibrationDialog({
			doc: document,
			accessibility: controls,
			getLocation: () => "https://harmoneasy.app/",
			baseUrl: "/",
			onApply
		})
		cal.dialog.showModal = vi.fn(() => cal.dialog.setAttribute("open", ""))
		cal.dialog.close = vi.fn(() => cal.dialog.removeAttribute("open"))
		cal.open()

		const tapPad = cal.dialog.querySelector<HTMLButtonElement>("#cal-tap-pad")!
		// Tap 3 times with a fast bounce between taps 1 and 2
		tapPad.dispatchEvent(new Event(EVENT_POINTER_DOWN))
		vi.advanceTimersByTime(60)
		tapPad.dispatchEvent(new Event(EVENT_POINTER_UP))
		vi.advanceTimersByTime(50) // 110ms gap -> bounce detected
		tapPad.dispatchEvent(new Event(EVENT_POINTER_DOWN))
		vi.advanceTimersByTime(150)
		tapPad.dispatchEvent(new Event(EVENT_POINTER_UP))
		vi.advanceTimersByTime(900)
		tapPad.dispatchEvent(new Event(EVENT_POINTER_DOWN))
		vi.advanceTimersByTime(140)
		tapPad.dispatchEvent(new Event(EVENT_POINTER_UP))

		expect(cal.getProfile().stabilizerEnabled).toBe(true)
		expect(cal.dialog.querySelector("#cal-tap-result")!.textContent).toContain("Calibrated")

		// Hover dwell pad for ~900ms
		const dwellPad = cal.dialog.querySelector<HTMLButtonElement>("#cal-dwell-pad")!
		dwellPad.dispatchEvent(new Event(EVENT_POINTER_OVER))
		vi.advanceTimersByTime(880)
		dwellPad.dispatchEvent(new Event(EVENT_POINTER_OUT))
		expect(cal.getProfile().dwellMs).toBe(900)

		// Set profile label and choose sensory preset
		const labelInput = cal.dialog.querySelector<HTMLInputElement>("#cal-label")!
		labelInput.value = "Alex"
		labelInput.dispatchEvent(new Event(EVENT_INPUT))
		const sensorySelect = cal.dialog.querySelector<HTMLSelectElement>("#cal-sensory")!
		sensorySelect.value = "deaf-tactile"
		sensorySelect.dispatchEvent(new Event(EVENT_CHANGE))

		const link = cal.dialog.querySelector<HTMLInputElement>("#cal-url")!.value
		expect(parsePartsUrl(link, "/")).toBeDefined()
		expect(readAccessProfileFromUrl(link)).toMatchObject({
			label: "Alex",
			dwellMs: 900,
			beatFlash: true,
			stabilizerEnabled: true
		})

		cal.dialog.querySelector<HTMLButtonElement>("#cal-apply")!.dispatchEvent(new Event(EVENT_CLICK))
		expect(onApply).toHaveBeenCalledWith(
			expect.objectContaining({ label: "Alex", dwellMs: 900, beatFlash: true }),
			"deaf-tactile"
		)

		cal.destroy()
		controls.destroy()
	})

	it("exposes calibration entry point inside Setup Wizard without altering existing step flow", () => {
		const trigger = document.createElement("button")
		document.body.append(trigger)
		const onCalibrate = vi.fn()
		const wizard = createSetupWizard(trigger, vi.fn(), { onCalibrate })
		wizard.element.showModal = vi.fn(() => wizard.element.setAttribute("open", ""))
		wizard.element.close = vi.fn(() => wizard.element.removeAttribute("open"))
		trigger.click()

		const calBtn = wizard.element.querySelector<HTMLButtonElement>("[data-wizard-calibrate]")
		expect(calBtn).not.toBeNull()
		calBtn!.click()
		expect(onCalibrate).toHaveBeenCalledOnce()
		wizard.destroy()
	})
})
