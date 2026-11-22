// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { Storage } from "happy-dom"
import AudioCommand from "../../../packages/audiobus/commands/audio-command"
import type { IAudioCommand } from "../../../packages/audiobus/commands/audio-command-interface"
import { NOTE_OFF, NOTE_ON } from "../../../packages/audiobus/commands/commands"
import { EVENT_CHANGE, EVENT_KEY_DOWN } from "../../../packages/audiobus/events/event-constants"
import { defineDevice } from "../../../packages/audiobus/io/device-definition"
import { DEFAULT_HARMONY } from "../../../packages/audiobus/io/harmony"
import type IOChainManager from "../../../packages/audiobus/io/IO-chain-manager"
import { createAccessibilityControls } from "../source/services/accessibility"
import {
	attachCameraGestures,
	EVENT_POINTER_OUT,
	EVENT_POINTER_OVER
} from "../source/services/dwell-controller"
import { createFocusStage } from "../source/services/focus-stage"
import {
	installMotorStabilizer,
	MotorStabilizer,
	type MotorStabilizerSettings
} from "../source/services/motor-stabilizer"
import { createSwitchScanner } from "../source/services/switch-scanner"

vi.mock("audiobus/io/input-factory", () => ({
	createInputById: vi.fn(async (type: string) => {
		const input = {
			name: `Mock ${type}`,
			isConnected: false,
			connect: vi.fn(async function (this: { isConnected: boolean }) {
				this.isConnected = true
			})
		}
		defineDevice(input, { factory: "input", type })
		return input
	})
}))

function noteCmd(type: typeof NOTE_ON | typeof NOTE_OFF, number: number, channel = 1): IAudioCommand {
	return Object.assign(new AudioCommand(), {
		type,
		number,
		velocity: type === NOTE_ON ? 100 : 0,
		channel
	}) as unknown as IAudioCommand
}

function mountFocusHtml() {
	const html = readFileSync("index.html", "utf8")
	const fieldsetStart = html.indexOf('<fieldset id="accessibility-settings">')
	const fieldsetEnd = html.indexOf("</fieldset>", fieldsetStart) + 11
	const buttonMatch = html.match(/<button[\s\S]*?id="btn-focus-stage"[\s\S]*?<\/button>/)
	document.body.innerHTML = `${buttonMatch?.[0] ?? ""}${html.slice(fieldsetStart, fieldsetEnd)}`
}

function createFakeManager() {
	const events = new EventTarget()
	const received: Array<{ type: string; number: number }> = []
	const inputs: any[] = []
	const outputs: any[] = []
	const chain = {
		isActive: true,
		inputs,
		outputs,
		onInputEvent: vi.fn((event: { command: IAudioCommand }) => {
			if (manager.sessionInputHandler?.("chain-1", event.command)) {
				return
			}
			received.push({
				type: event.command.type,
				number: event.command.number!
			})
		})
	}
	const manager = Object.assign(events, {
		harmony: DEFAULT_HARMONY,
		chains: [chain],
		activeChain: chain,
		sessionInputHandler: undefined as IOChainManager["sessionInputHandler"],
		deviceOptions: { now: () => 0, getBpm: () => 120 },
		getChain: vi.fn((id: string) => (id === "chain-1" ? chain : undefined)),
		addDevice: vi.fn((targetChain: typeof chain, device: any, direction: "input" | "output") => {
			if (direction === "input") {
				targetChain.inputs.push(device)
			} else {
				targetChain.outputs.push(device)
			}
		})
	}) as unknown as IOChainManager & {
		getChain: ReturnType<typeof vi.fn>
		addDevice: ReturnType<typeof vi.fn>
	}
	return { manager, chain, received }
}

describe("MotorStabilizer adaptive timing filter", () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	it("suppresses accidental retrigger bounces within debounceMs", () => {
		const settings: MotorStabilizerSettings = {
			enabled: true,
			debounceMs: 150,
			holdThresholdMs: 0,
			minDurationMs: 0
		}
		const reemitted: IAudioCommand[] = []
		const stabilizer = new MotorStabilizer(
			() => settings,
			(_chain, cmd) => reemitted.push(cmd)
		)

		expect(stabilizer.process("chain-1", noteCmd(NOTE_ON, 60))).toBe(false)
		vi.advanceTimersByTime(50)
		expect(stabilizer.process("chain-1", noteCmd(NOTE_OFF, 60))).toBe(false)
		vi.advanceTimersByTime(50) // 100ms total < 150ms debounce
		expect(stabilizer.process("chain-1", noteCmd(NOTE_ON, 60))).toBe(true)
		expect(stabilizer.getStats().suppressedBounces).toBe(1)

		vi.advanceTimersByTime(60) // 160ms total >= 150ms
		expect(stabilizer.process("chain-1", noteCmd(NOTE_ON, 60))).toBe(false)
		expect(reemitted).toHaveLength(0)
	})

	it("filters brief tremor taps shorter than holdThresholdMs and sounds intentional holds", () => {
		const settings: MotorStabilizerSettings = {
			enabled: true,
			debounceMs: 0,
			holdThresholdMs: 100,
			minDurationMs: 0
		}
		const reemitted: Array<{ type: string; number: number }> = []
		const stabilizer = new MotorStabilizer(
			() => settings,
			(_chain, cmd) => reemitted.push({ type: cmd.type, number: cmd.number! })
		)

		// Spurious 40ms tremor tap -> discarded cleanly
		expect(stabilizer.process("chain-1", noteCmd(NOTE_ON, 64))).toBe(true)
		vi.advanceTimersByTime(40)
		expect(stabilizer.process("chain-1", noteCmd(NOTE_OFF, 64))).toBe(true)
		vi.advanceTimersByTime(100)
		expect(reemitted).toHaveLength(0)
		expect(stabilizer.getStats().filteredTremors).toBe(1)

		// Intentional hold >= 100ms -> sounds via reemit
		expect(stabilizer.process("chain-1", noteCmd(NOTE_ON, 64))).toBe(true)
		vi.advanceTimersByTime(100)
		expect(reemitted).toEqual([{ type: NOTE_ON, number: 64 }])
	})

	it("extends stuttered releases to minDurationMs and flushes safely on reset", () => {
		const settings: MotorStabilizerSettings = {
			enabled: true,
			debounceMs: 0,
			holdThresholdMs: 0,
			minDurationMs: 250
		}
		const reemitted: Array<{ type: string; number: number }> = []
		const stabilizer = new MotorStabilizer(
			() => settings,
			(_chain, cmd) => reemitted.push({ type: cmd.type, number: cmd.number! })
		)

		expect(stabilizer.process("chain-1", noteCmd(NOTE_ON, 67))).toBe(false)
		vi.advanceTimersByTime(50)
		// Early release after 50ms -> deferred by 200ms
		expect(stabilizer.process("chain-1", noteCmd(NOTE_OFF, 67))).toBe(true)
		expect(stabilizer.getStats().extendedReleases).toBe(1)
		vi.advanceTimersByTime(199)
		expect(reemitted).toHaveLength(0)
		vi.advanceTimersByTime(1)
		expect(reemitted).toEqual([{ type: NOTE_OFF, number: 67 }])

		// Pending NOTE_OFF flushes immediately on reset so no stuck notes remain
		expect(stabilizer.process("chain-1", noteCmd(NOTE_ON, 69))).toBe(false)
		vi.advanceTimersByTime(20)
		expect(stabilizer.process("chain-1", noteCmd(NOTE_OFF, 69))).toBe(true)
		stabilizer.reset()
		expect(reemitted.at(-1)).toEqual({ type: NOTE_OFF, number: 69 })
	})

	it("chains with an existing sessionInputHandler and restores it on destroy", () => {
		const { manager, chain, received } = createFakeManager()
		const prior = vi.fn(() => false)
		manager.sessionInputHandler = prior

		const installed = installMotorStabilizer(manager, () => ({
			enabled: true,
			debounceMs: 0,
			holdThresholdMs: 80,
			minDurationMs: 0
		}))

		chain.onInputEvent({ command: noteCmd(NOTE_ON, 60) } as any)
		expect(received).toHaveLength(0)
		expect(prior).not.toHaveBeenCalled()

		vi.advanceTimersByTime(80)
		expect(received).toEqual([{ type: NOTE_ON, number: 60 }])
		expect(prior).toHaveBeenCalledTimes(1)

		installed.destroy()
		expect(manager.sessionInputHandler).toBe(prior)
	})
})

describe("Switch-Access Scanner, Dwell, and Camera Gestures", () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
		vi.stubGlobal("localStorage", new Storage())
		mountFocusHtml()
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
		localStorage.clear()
		vi.unstubAllGlobals()
		document.body.replaceChildren()
	})

	it("supports 2-switch step/select, speech cues, and HID gamepad polling", () => {
		const highlighted: Array<number | null> = []
		const activated: Array<{ idx: number; release: string }> = []
		const speak = vi.fn()
		const cancel = vi.fn()
		vi.stubGlobal(
			"SpeechSynthesisUtterance",
			class {
				text: string
				rate = 1
				constructor(text: string) {
					this.text = text
				}
			}
		)

		let gpButtons = [{ pressed: false }, { pressed: false }]
		const fakeWin = {
			speechSynthesis: { speak, cancel },
			navigator: {
				getGamepads: () => [{ buttons: gpButtons }]
			}
		} as unknown as Window

		const scanner = createSwitchScanner({
			getPadCount: () => 4,
			getPadInfo: (idx) => ({ label: ["C", "D", "E", "F"][idx] }),
			onHighlight: (idx) => highlighted.push(idx),
			onActivate: (idx, release) => activated.push({ idx, release }),
			win: fakeWin
		})

		scanner.configure({ mode: "step-2-switch", releaseMode: "latch", auditoryCue: "speech" })
		scanner.start()
		expect(highlighted.at(-1)).toBe(0)

		// Gamepad button 1 steps to pad 1 and speaks "D"
		gpButtons = [{ pressed: false }, { pressed: true }]
		vi.advanceTimersByTime(50)
		expect(highlighted.at(-1)).toBe(1)
		expect(cancel).toHaveBeenCalledTimes(1)
		expect(speak).toHaveBeenCalledTimes(1)

		// Holding button 1 does not repeat-step
		vi.advanceTimersByTime(50)
		expect(highlighted.at(-1)).toBe(1)

		// Gamepad button 0 selects pad 1 in latch mode
		gpButtons = [{ pressed: true }, { pressed: false }]
		vi.advanceTimersByTime(50)
		expect(activated).toEqual([{ idx: 1, release: "latch" }])

		// Private auditory chime cue uses AudioContext destination directly
		const oscStart = vi.fn()
		const oscStop = vi.fn()
		const fakeAudioContext = {
			currentTime: 0,
			destination: {},
			createOscillator: vi.fn(() => ({
				type: "sine",
				frequency: { setValueAtTime: vi.fn() },
				connect: vi.fn(),
				start: oscStart,
				stop: oscStop
			})),
			createGain: vi.fn(() => ({
				gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
				connect: vi.fn()
			}))
		} as unknown as AudioContext
		const toneScanner = createSwitchScanner({
			getPadCount: () => 4,
			getPadInfo: (idx) => ({ label: ["C", "D", "E", "F"][idx], pitch: 60 + idx * 2 }),
			onHighlight: () => {},
			onActivate: () => {},
			audioContext: fakeAudioContext,
			win: fakeWin
		})
		toneScanner.configure({ mode: "step-2-switch", auditoryCue: "tone" })
		toneScanner.start()
		toneScanner.step(true)
		expect(oscStart).toHaveBeenCalledTimes(1)
		expect(oscStop).toHaveBeenCalledTimes(1)
		toneScanner.stop()

		scanner.stop()
	})

	it("wires 2-switch latch, pointer dwell with cooldown, and Camera Gestures in Focus Stage", async () => {
		const controls = createAccessibilityControls(document)
		const { manager, chain, received } = createFakeManager()
		const stage = createFocusStage({ manager, doc: document, accessibility: controls })
		stage.open()

		// Configure 2-switch step/select + latch toggle
		const scanSelect = stage.dialog.querySelector<HTMLSelectElement>("#focus-stage-scan")!
		scanSelect.value = "2-switch"
		scanSelect.dispatchEvent(new Event(EVENT_CHANGE))

		const releaseSelect = stage.dialog.querySelector<HTMLSelectElement>("#focus-stage-release")!
		releaseSelect.value = "latch"
		releaseSelect.dispatchEvent(new Event(EVENT_CHANGE))

		// Tab advances from pad 0 -> pad 1 (D4 = 62), Space latches it on, second Space releases it
		stage.dialog.dispatchEvent(
			new KeyboardEvent(EVENT_KEY_DOWN, { key: "Tab", bubbles: true })
		)
		stage.dialog.dispatchEvent(
			new KeyboardEvent(EVENT_KEY_DOWN, { code: "Space", key: " ", bubbles: true })
		)
		expect(received.at(-1)).toEqual({ type: NOTE_ON, number: 62 })
		const secondPad = stage.dialog.querySelector<HTMLButtonElement>('[data-pad-index="1"]')!
		expect(secondPad.classList.contains("is-latched")).toBe(true)

		stage.dialog.dispatchEvent(
			new KeyboardEvent(EVENT_KEY_DOWN, { code: "Space", key: " ", bubbles: true })
		)
		expect(received.at(-1)).toEqual({ type: NOTE_OFF, number: 62 })
		expect(secondPad.classList.contains("is-latched")).toBe(false)

		// Switch back to timed mode and enable 400ms pointer dwell
		scanSelect.value = "0"
		scanSelect.dispatchEvent(new Event(EVENT_CHANGE))
		releaseSelect.value = "timed"
		releaseSelect.dispatchEvent(new Event(EVENT_CHANGE))
		const dwellSelect = stage.dialog.querySelector<HTMLSelectElement>("#focus-stage-dwell")!
		dwellSelect.value = "400"
		dwellSelect.dispatchEvent(new Event(EVENT_CHANGE))

		const firstPad = stage.dialog.querySelector<HTMLButtonElement>('[data-pad-index="0"]')!
		firstPad.dispatchEvent(new Event(EVENT_POINTER_OVER, { bubbles: true }))
		expect(firstPad.classList.contains("is-dwelling")).toBe(true)

		// Leaving early cancels dwell without triggering
		vi.advanceTimersByTime(200)
		firstPad.dispatchEvent(new Event(EVENT_POINTER_OUT, { bubbles: true }))
		expect(firstPad.classList.contains("is-dwelling")).toBe(false)
		expect(received.filter((e) => e.number === 60)).toHaveLength(0)

		// Full 400ms dwell triggers pad 0 (C4 = 60) and enters cooldown
		firstPad.dispatchEvent(new Event(EVENT_POINTER_OVER, { bubbles: true }))
		vi.advanceTimersByTime(425)
		expect(received.at(-1)).toEqual({ type: NOTE_ON, number: 60 })
		expect(firstPad.classList.contains("is-cooldown")).toBe(true)

		// Timed release fires NOTE_OFF automatically
		vi.advanceTimersByTime(500)
		expect(received.at(-1)).toEqual({ type: NOTE_OFF, number: 60 })

		// Camera Gestures button attaches input once without duplicating
		const firstAttach = await attachCameraGestures(manager)
		expect(firstAttach.attached).toBe(true)
		expect(firstAttach.alreadyActive).toBe(false)
		expect(chain.inputs).toHaveLength(1)

		const secondAttach = await attachCameraGestures(manager)
		expect(secondAttach.alreadyActive).toBe(true)
		expect(chain.inputs).toHaveLength(1)

		// Verify stabilizer settings persist via accessibility controls
		const stabilizerBox = document.getElementById("a11y-stabilizer") as HTMLInputElement
		stabilizerBox.checked = true
		stabilizerBox.dispatchEvent(new Event(EVENT_CHANGE))
		expect(controls.getPreferences().stabilizerEnabled).toBe(true)
		expect(
			(document.getElementById("a11y-debounce") as HTMLSelectElement).disabled
		).toBe(false)

		stage.destroy()
		controls.destroy()
	})
})
