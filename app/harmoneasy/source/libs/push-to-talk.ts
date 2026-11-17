import {
	EVENT_CLICK,
	EVENT_KEY_DOWN,
	EVENT_KEY_UP,
	EVENT_LOST_POINTER_CAPTURE,
	EVENT_POINTER_CANCEL,
	EVENT_POINTER_DOWN,
	EVENT_POINTER_UP
} from "audiobus/events/event-constants"
import type { SpeechRecogniser, SpeechSession } from "./speech-recognisers"

/**
 * Records speech while the button is held with a pointer, Space or Enter. A click that arrives
 * without a press, such as from a screen reader or switch, toggles recording instead.
 * `onText` receives everything heard since recording started, with `final` set once it settles.
 */
export function createPushToTalk(
	button: HTMLButtonElement,
	{
		recogniser,
		onStart,
		onText,
		onStatus
	}: {
		recogniser: () => SpeechRecogniser | undefined
		onStart: () => void
		onText: (text: string, final: boolean) => void
		onStatus: (message: string) => void
	}
) {
	const idleLabel = button.textContent ?? ""
	let session: SpeechSession | undefined
	let listening = false
	let pressed = false

	const show = (state: "idle" | "listening" | "working") => {
		listening = state === "listening"
		button.setAttribute("aria-pressed", String(listening))
		button.textContent =
			state === "listening"
				? "Listening… release to stop"
				: state === "working"
					? "Working…"
					: idleLabel
	}
	const start = () => {
		const chosen = recogniser()
		if (!chosen || session) {
			return
		}
		onStart()
		show("listening")
		let ended = false
		const current = chosen.start({
			onText,
			onStatus,
			onEnd: () => {
				ended = true
				if (session && session === current) {
					session = undefined
					show("idle")
				}
			}
		})
		// A recogniser can finish before it returns, for example when it needs a download first.
		if (ended) {
			show("idle")
		} else {
			session = current
		}
	}
	// Stopping lets the recogniser deliver its last words before it ends.
	const stop = () => {
		if (session && listening) {
			show("working")
			session.stop()
		}
	}

	button.addEventListener(EVENT_POINTER_DOWN, (event) => {
		if (event.button !== 0) {
			return
		}
		pressed = true
		button.setPointerCapture?.(event.pointerId)
		start()
	})
	for (const name of [EVENT_POINTER_UP, EVENT_POINTER_CANCEL, EVENT_LOST_POINTER_CAPTURE]) {
		button.addEventListener(name, stop)
	}
	button.addEventListener(EVENT_KEY_DOWN, (event) => {
		if (event.key === " " || event.key === "Enter") {
			event.preventDefault()
			if (!event.repeat) {
				pressed = true
				start()
			}
		}
	})
	button.addEventListener(EVENT_KEY_UP, (event) => {
		if (event.key === " " || event.key === "Enter") {
			event.preventDefault()
			// Preventing the key's default also prevents its click, so release the press here.
			pressed = false
			stop()
		}
	})
	button.addEventListener(EVENT_CLICK, () => {
		if (pressed) {
			pressed = false
		} else if (session) {
			stop()
		} else {
			start()
		}
	})
	show("idle")
	return {
		/** Discards anything still being heard; the button keeps working afterwards. */
		abort: () => {
			const current = session
			session = undefined
			current?.abort()
			show("idle")
		}
	}
}