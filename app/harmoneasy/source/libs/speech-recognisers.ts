import {
	SPEECH_MODEL_ERROR,
	SPEECH_MODEL_LOAD,
	SPEECH_MODEL_PROGRESS,
	SPEECH_MODEL_TEXT,
	SPEECH_MODEL_TRANSCRIBE
} from "./speech-model-messages"
import { createSpeechStream, SPEECH_SAMPLE_RATE } from "./speech-stream"
import { loadCaptureWorklet } from "audiobus/io/inputs/load-capture-worklet"

/**
 * Ways to turn a held spoken phrase into text, preferring those that keep the voice on this
 * device: the browser's own on-device recogniser, then small open models run in a worker,
 * and only then the browser's online service, which sends the recording elsewhere.
 */

export type SpeechRecogniserId = "browser-device" | "moonshine" | "whisper" | "browser-online"

export interface SpeechHandlers {
	/** Everything heard so far in this session; `final` is set once when it settles. */
	onText(text: string, final: boolean): void
	onStatus(message: string): void
	/** Called once when the session finishes, unless it was aborted. */
	onEnd(): void
}

export interface SpeechSession {
	/** Finishes listening and delivers whatever was heard. */
	stop(): void
	/** Discards the session without calling any handler. */
	abort(): void
}

export interface SpeechRecogniser {
	id: SpeechRecogniserId
	label: string
	onDevice: boolean
	/** Gets ready without downloading anything, so the first phrase starts quickly. */
	prepare?(): void
	start(handlers: SpeechHandlers): SpeechSession
}

interface SpeechRecognitionLike {
	lang: string
	continuous: boolean
	interimResults: boolean
	processLocally?: boolean
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

interface SpeechRecognitionConstructor {
	new (): SpeechRecognitionLike
	available?(options: { langs: string[]; processLocally: boolean }): Promise<string>
	install?(options: { langs: string[]; processLocally: boolean }): Promise<boolean>
}

export const SPEECH_LISTENING =
	"Listening… release the button, or press it again, when you finish speaking."
const SPEECH_ERRORS: Record<string, string> = {
	"not-allowed": "Microphone access was blocked. Allow it in your browser to speak your idea.",
	"service-not-allowed": "Speech recognition is turned off in this browser.",
	"audio-capture": "No microphone was found.",
	"no-speech": "No speech was heard. Hold the button while you speak.",
	"language-not-supported":
		"This browser cannot recognise English speech on this device. Choose another speech option.",
	network: "Speech recognition needs a network connection in this browser."
}
const SPEECH_MODELS = {
	moonshine: {
		model: "onnx-community/moonshine-tiny-ONNX",
		name: "Moonshine Tiny",
		label: "Moonshine Tiny on this device (about 30 MB download, fastest)"
	},
	whisper: {
		model: "onnx-community/whisper-tiny.en",
		name: "Whisper Tiny",
		label: "Whisper Tiny on this device (about 40 MB download, slower live text)"
	}
} as const

export const speechLanguage = () =>
	globalThis.navigator?.language?.startsWith("en") ? navigator.language : "en-US"

function speechRecognition(): SpeechRecognitionConstructor | undefined {
	const scope = globalThis as typeof globalThis & {
		SpeechRecognition?: SpeechRecognitionConstructor
		webkitSpeechRecognition?: SpeechRecognitionConstructor
	}
	return scope.SpeechRecognition ?? scope.webkitSpeechRecognition
}

let installing: Promise<boolean> | undefined

/** Uses the browser recogniser, asking it to stay on this device when `processLocally` is set. */
export function browserSpeechRecogniser(
	processLocally: boolean,
	languagePackReady = true
): SpeechRecogniser | undefined {
	const Recognition = speechRecognition()
	if (!Recognition) {
		return undefined
	}
	return {
		id: processLocally ? "browser-device" : "browser-online",
		label: processLocally
			? `Your browser, on this device${languagePackReady ? "" : " (about 60 MB language download)"}`
			: "Your browser's online service (sends your voice to its provider, such as Google)",
		onDevice: processLocally,
		start(handlers) {
			const langs = [speechLanguage()]
			let recognition: SpeechRecognitionLike | undefined
			let aborted = false
			let stopped = false
			let transcript = ""
			const begin = () => {
				if (aborted) {
					return
				}
				if (stopped) {
					handlers.onEnd()
					return
				}
				const current = new Recognition()
				recognition = current
				current.lang = langs[0]
				current.continuous = true
				current.interimResults = true
				if (processLocally) {
					current.processLocally = true
				}
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
					handlers.onText(`${transcript} ${interim}`.trim(), false)
				}
				current.onerror = (event) => {
					if (!aborted && event.error !== "aborted") {
						handlers.onStatus(
							SPEECH_ERRORS[event.error] ?? "Speech recognition stopped unexpectedly."
						)
					}
				}
				current.onend = () => {
					if (!aborted) {
						if (transcript) {
							handlers.onText(transcript, true)
						}
						handlers.onEnd()
					}
				}
				try {
					current.start()
					handlers.onStatus(SPEECH_LISTENING)
				} catch {
					handlers.onStatus("Speech recognition could not start. Please try again.")
					handlers.onEnd()
				}
			}
			if (!processLocally) {
				begin()
			} else {
				// A language pack takes longer than one held phrase to download, so install it, then
				// ask for the phrase again rather than holding the recording open.
				void (async () => {
					const state = installing
						? "downloading"
						: await Recognition.available!({ langs, processLocally: true })
					if (state === "available") {
						begin()
						return
					}
					if (state === "unavailable") {
						handlers.onStatus(SPEECH_ERRORS["language-not-supported"])
					} else {
						handlers.onStatus(
							"Downloading the browser's English speech pack for this device (about 60 MB). Hold the button again when it is ready."
						)
						if (!installing) {
							installing = Recognition.install!({ langs, processLocally: true })
							installing
								.catch(() => false)
								.then((ready) => {
									installing = undefined
									handlers.onStatus(
										ready
											? "Speech recognition is ready on this device. Hold the button and speak."
											: "The speech pack could not be installed. Choose another speech option."
									)
								})
						}
					}
					handlers.onEnd()
				})().catch(() => {
					if (!aborted) {
						handlers.onStatus("Speech recognition could not start. Please try again.")
						handlers.onEnd()
					}
				})
			}
			return {
				stop: () => {
					stopped = true
					recognition?.stop()
				},
				abort: () => {
					aborted = true
					recognition?.abort()
				}
			}
		}
	}
}

/** Shares one worker so a model downloads and loads once per page. */
class SpeechModelWorker {
	#worker: Worker
	#requests = new Map<number, { resolve(text: string): void; reject(error: Error): void }>()
	#next = 0
	progress: ((loaded: number, total: number) => void) | undefined

	constructor(worker: Worker) {
		this.#worker = worker
		worker.onmessage = ({ data }) => {
			if (data.kind === SPEECH_MODEL_PROGRESS) {
				this.progress?.(data.loaded, data.total)
				return
			}
			const request = this.#requests.get(data.id)
			this.#requests.delete(data.id)
			if (data.kind === SPEECH_MODEL_TEXT) {
				request?.resolve(data.text)
			} else if (data.kind === SPEECH_MODEL_ERROR) {
				request?.reject(new Error(data.error))
			}
		}
	}
	load(model: string) {
		this.#worker.postMessage({ kind: SPEECH_MODEL_LOAD, model })
	}
	transcribe(model: string, audio: Float32Array) {
		const id = this.#next++
		return new Promise<string>((resolve, reject) => {
			this.#requests.set(id, { resolve, reject })
			this.#worker.postMessage({ kind: SPEECH_MODEL_TRANSCRIBE, id, model, audio }, [
				audio.buffer
			])
		})
	}
}

let sharedWorker: SpeechModelWorker | undefined
const defaultWorker = () =>
	(sharedWorker ??= new SpeechModelWorker(
		new Worker(new URL("./speech-model.worker.ts", import.meta.url), { type: "module" })
	))

const CAPTURE_PROCESSOR = "speech-capture-processor"
/** Posts about 20 ms of microphone audio at a time, so the page can transcribe as it arrives. */
const CAPTURE_WORKLET = `
class SpeechCaptureProcessor extends AudioWorkletProcessor {
	constructor() {
		super()
		this.buffer = new Float32Array(1024)
		this.index = 0
	}
	process(inputs) {
		const channel = inputs[0] && inputs[0][0]
		if (!channel) return true
		for (let i = 0; i < channel.length; i++) {
			this.buffer[this.index++] = channel[i]
			if (this.index === this.buffer.length) {
				this.port.postMessage(this.buffer.slice())
				this.index = 0
			}
		}
		return true
	}
}
registerProcessor("${CAPTURE_PROCESSOR}", SpeechCaptureProcessor)
`

/** Converts a live stream to 16 kHz by linear interpolation, carrying position across chunks. */
export function createResampler(from: number) {
	const ratio = from / SPEECH_SAMPLE_RATE
	let position = 0
	let last = 0
	return (input: Float32Array) => {
		if (ratio === 1) {
			return input
		}
		const output: number[] = []
		while (position < input.length - 1) {
			const index = Math.floor(position)
			const before = index < 0 ? last : input[index]
			output.push(before + (input[index + 1] - before) * (position - index))
			position += ratio
		}
		position -= input.length
		last = input[input.length - 1]
		return Float32Array.from(output)
	}
}

/** Prefers a 16 kHz context so the browser resamples; some browsers only capture at their own rate. */
function captureSource(media: MediaStream) {
	const context = new AudioContext({ sampleRate: SPEECH_SAMPLE_RATE })
	try {
		return { context, source: context.createMediaStreamSource(media) }
	} catch {
		void context.close()
		const fallback = new AudioContext()
		return { context: fallback, source: fallback.createMediaStreamSource(media) }
	}
}

async function modelCached(model: string) {
	try {
		const cache = await caches.open("transformers-cache")
		return Boolean(
			await cache.match(
				`https://huggingface.co/${model}/resolve/main/onnx/encoder_model_quantized.onnx`
			)
		)
	} catch {
		return false
	}
}

/** Transcribes speech with an open model on this device while the person is still speaking. */
export function modelSpeechRecogniser(
	id: keyof typeof SPEECH_MODELS,
	worker: () => SpeechModelWorker = defaultWorker
): SpeechRecogniser | undefined {
	if (
		typeof Worker === "undefined" ||
		typeof AudioContext === "undefined" ||
		typeof AudioWorkletNode === "undefined" ||
		!globalThis.navigator?.mediaDevices?.getUserMedia
	) {
		return undefined
	}
	const { model, name, label } = SPEECH_MODELS[id]
	return {
		id,
		label,
		onDevice: true,
		// Loading a model that is already downloaded makes the first phrase as quick as the rest.
		prepare() {
			void modelCached(model).then((cached) => {
				if (cached) {
					worker().load(model)
				}
			})
		},
		start(handlers) {
			let aborted = false
			let stopped = false
			let stream: MediaStream | undefined
			let context: AudioContext | undefined
			const models = worker()
			const release = () => {
				stream?.getTracks().forEach((track) => track.stop())
				void context?.close()
				context = undefined
			}
			models.progress = (loaded, total) => {
				if (!aborted) {
					handlers.onStatus(
						`Downloading ${name} for this device: ${Math.round((loaded / total) * 100)}%`
					)
				}
			}
			// The model loads while the person speaks, so the first phrase waits less.
			models.load(model)
			const speech = createSpeechStream({
				transcribe: (audio) => models.transcribe(model, audio),
				onText: (text, final) => {
					if (!aborted) {
						handlers.onText(text, final)
					}
				},
				onDone: (text, error) => {
					release()
					if (aborted) {
						return
					}
					if (text) {
						handlers.onText(text, true)
					}
					if (error) {
						handlers.onStatus(
							`${name} could not turn your speech into text. Check your connection for the first download, or choose another speech option.`
						)
					} else if (!text) {
						handlers.onStatus(SPEECH_ERRORS["no-speech"])
					}
					handlers.onEnd()
				}
			})
			navigator.mediaDevices
				.getUserMedia({
					audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
				})
				.then(async (media) => {
					stream = media
					if (aborted || stopped) {
						speech.stop()
						return
					}
					const capture = captureSource(media)
					context = capture.context
					await loadCaptureWorklet(capture.context, CAPTURE_PROCESSOR, CAPTURE_WORKLET)
					if (aborted || stopped || context !== capture.context) {
						speech.stop()
						return
					}
					const resample = createResampler(capture.context.sampleRate)
					const node = new AudioWorkletNode(capture.context, CAPTURE_PROCESSOR)
					node.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
						if (!stopped) {
							speech.push(resample(data))
						}
					}
					capture.source.connect(node)
					handlers.onStatus(SPEECH_LISTENING)
				})
				.catch((error: unknown) => {
					speech.abort()
					release()
					if (!aborted) {
						handlers.onStatus(
							SPEECH_ERRORS[
								error instanceof DOMException && error.name === "NotAllowedError"
									? "not-allowed"
									: "audio-capture"
							]
						)
						handlers.onEnd()
					}
				})
			return {
				stop: () => {
					stopped = true
					// The microphone is released at once; the last words finish transcribing after.
					stream?.getTracks().forEach((track) => track.stop())
					speech.stop()
				},
				abort: () => {
					aborted = true
					speech.abort()
					release()
				}
			}
		}
	}
}

/**
 * Lists the recognisers this browser supports, in the order they should be offered.
 * A browser language pack that still needs downloading goes after the smaller models.
 */
export async function listSpeechRecognisers(): Promise<SpeechRecogniser[]> {
	const Recognition = speechRecognition()
	let deviceState = "unavailable"
	if (Recognition?.available && Recognition.install) {
		try {
			deviceState = await Recognition.available({
				langs: [speechLanguage()],
				processLocally: true
			})
		} catch {
			deviceState = "unavailable"
		}
	}
	const device =
		deviceState === "unavailable"
			? undefined
			: browserSpeechRecogniser(true, deviceState === "available")
	const models = [modelSpeechRecogniser("moonshine"), modelSpeechRecogniser("whisper")]
	return [
		...(deviceState === "available" ? [device] : []),
		...models,
		...(deviceState === "available" ? [] : [device]),
		browserSpeechRecogniser(false)
	].filter((item): item is SpeechRecogniser => Boolean(item))
}

export type { SpeechModelWorker }
export const createSpeechModelWorker = (worker: Worker) => new SpeechModelWorker(worker)