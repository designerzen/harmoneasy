import {
	EVENT_CLICK,
	EVENT_KEY_DOWN,
	EVENT_KEY_UP,
	EVENT_LOST_POINTER_CAPTURE,
	EVENT_POINTER_CANCEL,
	EVENT_POINTER_DOWN,
	EVENT_POINTER_UP
} from "audiobus/events/event-constants"

interface SpeechRecognitionLike {
	lang: string
	continuous: boolean
	interimResults: boolean
	onresult: ((event: SpeechResultEvent) => void) | null
	onerror: ((event: { error: string }) => void) | null
	onend: (() => void) | null
	start(): void
	stop(): void
	abort(): void
}

interface SpeechResultEvent {
	resultIndex: number
	results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

const SPEECH_ERRORS: Record<string, string> = {
	"not-allowed": "Microphone access was blocked. Allow it in your browser to speak your idea.",
	"service-not-allowed": "Speech recognition is turned off in this browser.",
	"audio-capture": "No microphone was found.",
	"no-speech": "No speech was heard. Hold the button while you speak.",
	network: "Speech recognition needs a network connection in this browser."
}

function speechRecognition(): SpeechRecognitionConstructor | undefined {
	const scope = globalThis as typeof globalThis & {
		SpeechRecognition?: SpeechRecognitionConstructor
		webkitSpeechRecognition?: SpeechRecognitionConstructor
	}
	return scope.SpeechRecognition ?? scope.webkitSpeechRecognition
}

export const speechRecognitionAvailable = () => Boolean(speechRecognition())

/**
 * Records speech while the button is held with a pointer, Space or Enter. A click that arrives
 * without a press, such as from a screen reader or switch, toggles recording instead.
 * `onText` receives everything heard since recording started, with `final` set once it settles.
 */
export function createPushToTalk(
	button: HTMLButtonElement,
	{
		onStart,
		onText,
		onStatus
	}: {
		onStart: () => void
		onText: (text: string, final: boolean) => void
		onStatus: (message: string) => void
	}
) {
	const Recognition = speechRecognition()
	const idleLabel = button.textContent ?? ""
	let recognition: SpeechRecognitionLike | undefined
	let pressed = false
	let transcript = ""

	const setListening = (listening: boolean) => {
		button.setAttribute("aria-pressed", String(listening))
		button.textContent = listening ? "Listening… release to stop" : idleLabel
	}
	const start = () => {
		if (!Recognition || recognition) {
			return
		}
		const current = new Recognition()
		recognition = current
		transcript = ""
		current.lang = navigator.language?.startsWith("en") ? navigator.language : "en-US"
		current.continuous = true
		current.interimResults = true
		current.onresult = (event) => {
			let interim = ""
			for (let index = event.resultIndex; index < event.results.length; index++) {
				const result = event.results[index]
				if (result.isFinal) {
					transcript = `${transcript} ${result[0].transcript}`.trim()
				} else {
					interim += result[0].transcript
				}
			}
			onText(`${transcript} ${interim}`.trim(), false)
		}
		current.onerror = (event) => {
			if (event.error !== "aborted") {
				onStatus(SPEECH_ERRORS[event.error] ?? "Speech recognition stopped unexpectedly.")
			}
		}
		current.onend = () => {
			if (recognition === current) {
				recognition = undefined
				setListening(false)
				if (transcript) {
					onText(transcript, true)
				}
			}
		}
		try {
			current.start()
			onStart()
			setListening(true)
			onStatus("Listening… release the button, or press it again, when you finish speaking.")
		} catch {
			recognition = undefined
			onStatus("Speech recognition could not start. Please try again.")
		}
	}
	// Stopping lets the recogniser deliver its last words before it ends.
	const stop = () => recognition?.stop()

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
		} else if (recognition) {
			stop()
		} else {
			start()
		}
	})
	setListening(false)
	return {
		/** Discards anything still being heard; the button keeps working afterwards. */
		abort: () => {
			const current = recognition
			recognition = undefined
			current?.abort()
			setListening(false)
		}
	}
}