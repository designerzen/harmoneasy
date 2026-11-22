export type SwitchScanMode = "off" | "auto-1-switch" | "step-2-switch"
export type SwitchReleaseMode = "timed" | "latch"
export type AuditoryCueMode = "off" | "speech" | "tone"

export interface SwitchScannerConfig {
	mode: SwitchScanMode
	scanMs: number
	releaseMode: SwitchReleaseMode
	auditoryCue: AuditoryCueMode
}

export interface SwitchPadCueInfo {
	label: string
	pitch?: number
}

export interface SwitchScannerOptions {
	getPadCount: () => number
	getPadInfo: (index: number) => SwitchPadCueInfo | undefined
	onHighlight: (index: number | null) => void
	onActivate: (index: number, releaseMode: SwitchReleaseMode, timedReleaseMs?: number) => void
	audioContext?: AudioContext
	win?: Window | null
}

const GAMEPAD_POLL_MS = 50
const DEFAULT_TIMED_RELEASE_MS = 450

/**
 * Composable 1-switch auto-scan and 2-switch step/select engine with
 * latch/timed release, private auditory preview cues, and HID gamepad polling.
 */
export function createSwitchScanner({
	getPadCount,
	getPadInfo,
	onHighlight,
	onActivate,
	audioContext,
	win = typeof window !== "undefined" ? window : null
}: SwitchScannerOptions) {
	let config: SwitchScannerConfig = {
		mode: "off",
		scanMs: 1000,
		releaseMode: "timed",
		auditoryCue: "off"
	}
	let index = 0
	let running = false
	let scanTimer: ReturnType<typeof setInterval> | undefined
	let gamepadTimer: ReturnType<typeof setInterval> | undefined
	const prevGamepadState = new Map<string, boolean>()

	const playCue = (padIndex: number) => {
		if (config.auditoryCue === "off") {
			return
		}
		const info = getPadInfo(padIndex)
		if (!info) {
			return
		}
		if (config.auditoryCue === "speech") {
			const synth = win?.speechSynthesis
			if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
				return
			}
			try {
				synth.cancel()
				const utterance = new SpeechSynthesisUtterance(info.label)
				utterance.rate = 1.15
				synth.speak(utterance)
			} catch {
				// Ignore speech errors in environments without speech voices.
			}
			return
		}

		// Private auditory preview tone routed directly to destination (never to MIDI/chains).
		if (config.auditoryCue === "tone" && audioContext) {
			try {
				const now = audioContext.currentTime
				const osc = audioContext.createOscillator()
				const gain = audioContext.createGain()
				const pitch = info.pitch ?? 60 + padIndex * 2
				osc.type = "sine"
				osc.frequency.setValueAtTime(440 * 2 ** ((pitch - 69) / 12), now)
				gain.gain.setValueAtTime(0.0001, now)
				gain.gain.exponentialRampToValueAtTime(0.06, now + 0.01)
				gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075)
				osc.connect(gain)
				gain.connect(audioContext.destination)
				osc.start(now)
				osc.stop(now + 0.08)
			} catch {
				// Ignore if AudioContext is closed or mocked without oscillator nodes.
			}
		}
	}

	const timedReleaseDuration = () =>
		config.mode === "auto-1-switch"
			? Math.min(500, Math.max(200, Math.floor(config.scanMs * 0.6)))
			: DEFAULT_TIMED_RELEASE_MS

	const stopTimers = () => {
		if (scanTimer) {
			clearInterval(scanTimer)
			scanTimer = undefined
		}
		if (gamepadTimer) {
			clearInterval(gamepadTimer)
			gamepadTimer = undefined
		}
		prevGamepadState.clear()
	}

	const step = (announceCue = true) => {
		const count = getPadCount()
		if (count <= 0) {
			onHighlight(null)
			return
		}
		index = (index + 1) % count
		onHighlight(index)
		if (announceCue) {
			playCue(index)
		}
	}

	const select = () => {
		const count = getPadCount()
		if (count <= 0) {
			return
		}
		const target = Math.min(index, count - 1)
		onActivate(
			target,
			config.releaseMode,
			config.releaseMode === "timed" ? timedReleaseDuration() : undefined
		)
	}

	const pollGamepads = () => {
		const nav = win?.navigator
		const getGamepads = nav?.getGamepads
		if (!nav || typeof getGamepads !== "function") {
			return
		}
		const pads = getGamepads.call(nav)
		if (!pads) {
			return
		}
		for (let g = 0; g < pads.length; g++) {
			const gp = pads[g]
			if (!gp?.buttons) {
				continue
			}
			const selectPressed = Boolean(gp.buttons[0]?.pressed)
			const stepPressed = Boolean(gp.buttons[1]?.pressed || gp.buttons[15]?.pressed)
			const selectKey = `${g}:select`
			const stepKey = `${g}:step`

			if (selectPressed && !prevGamepadState.get(selectKey)) {
				select()
			}
			if (
				config.mode === "step-2-switch" &&
				stepPressed &&
				!prevGamepadState.get(stepKey)
			) {
				step(true)
			}
			prevGamepadState.set(selectKey, selectPressed)
			prevGamepadState.set(stepKey, stepPressed)
		}
	}

	const syncTimers = () => {
		stopTimers()
		const count = getPadCount()
		if (!running || config.mode === "off" || count <= 0) {
			onHighlight(null)
			return
		}
		index = Math.min(index, count - 1)
		onHighlight(index)
		if (config.mode === "auto-1-switch" && count > 1 && config.scanMs > 0) {
			scanTimer = setInterval(() => {
				if (!running || getPadCount() <= 1) {
					stopTimers()
					return
				}
				step(true)
			}, config.scanMs)
		}
		gamepadTimer = setInterval(pollGamepads, GAMEPAD_POLL_MS)
	}

	const start = () => {
		running = true
		index = 0
		syncTimers()
	}

	const stop = () => {
		running = false
		stopTimers()
		onHighlight(null)
	}

	const configure = (patch: Partial<SwitchScannerConfig>) => {
		config = { ...config, ...patch }
		if (running) {
			syncTimers()
		}
	}

	const handleKeyDown = (event: KeyboardEvent): boolean => {
		if (!running || config.mode === "off") {
			return false
		}
		if (config.mode === "auto-1-switch") {
			if (event.code === "Space" || event.key === "Enter") {
				event.preventDefault()
				select()
				return true
			}
			return false
		}
		// 2-switch step / select mode
		if (
			event.key === "Tab" ||
			event.key === "ArrowRight" ||
			event.key === "ArrowDown" ||
			event.code === "ShiftRight"
		) {
			event.preventDefault()
			step(true)
			return true
		}
		if (event.code === "Space" || event.key === "Enter") {
			event.preventDefault()
			select()
			return true
		}
		return false
	}

	return {
		start,
		stop,
		step,
		select,
		configure,
		handleKeyDown,
		getConfig: () => ({ ...config }),
		getIndex: () => index,
		isActive: () => running && config.mode !== "off"
	}
}
