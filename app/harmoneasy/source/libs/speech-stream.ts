/**
 * Turns a live stream of 16 kHz samples into text while the person is still speaking.
 * The current phrase is transcribed again whenever enough new audio has arrived, and is
 * committed at a pause (or when it grows too long for the model), so each pass stays short.
 * Only one transcription runs at a time, and interim passes skip ahead to the newest audio.
 * When speaking stops, a pass that already covers every spoken sample becomes the final text
 * at once; otherwise only the audio since the last commit still needs transcribing.
 */

export const SPEECH_SAMPLE_RATE = 16000
/** New audio needed before the phrase is transcribed again. */
const INTERIM_STEP = SPEECH_SAMPLE_RATE * 0.4
/** Quiet time after speech that ends a phrase. */
const PAUSE = SPEECH_SAMPLE_RATE * 0.5
/** Phrases are committed before they outgrow a model's window. */
const LONGEST_PHRASE = SPEECH_SAMPLE_RATE * 15
const SHORTEST_PHRASE = SPEECH_SAMPLE_RATE * 0.3
/** Quiet audio kept before the next phrase so its first sound is not clipped. */
const LEAD_IN = SPEECH_SAMPLE_RATE * 0.2
const QUIETEST_SPEECH = 0.012

export interface SpeechStreamHandlers {
	transcribe(audio: Float32Array): Promise<string>
	onText(text: string, final: boolean): void
	/** Receives the final text, empty when nothing was said, or the error that stopped it. */
	onDone(text: string, error?: unknown): void
}

const join = (...parts: string[]) => parts.filter(Boolean).join(" ")

/**
 * Tidies model output: drops Whisper's "[BLANK_AUDIO]" and "(music)" markers, and cuts the text
 * where a phrase repeats three times in a row, which is a small model looping on a cut-off word
 * rather than something the person said.
 */
export function cleanTranscript(text: string) {
	const words = text
		.replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
		.split(/\s+/)
		.filter(Boolean)
	const same = (a: number, b: number, size: number) => {
		for (let k = 0; k < size; k++) {
			if (
				words[a + k]?.toLowerCase().replace(/\W/g, "") !==
				words[b + k]?.toLowerCase().replace(/\W/g, "")
			) {
				return false
			}
		}
		return true
	}
	for (let start = 0; start < words.length; start++) {
		for (let size = 1; size <= 6 && start + size * 3 <= words.length; size++) {
			if (same(start, start + size, size) && same(start, start + size * 2, size)) {
				return words.slice(0, start + size).join(" ")
			}
		}
	}
	return words.join(" ")
}

export function createSpeechStream({ transcribe, onText, onDone }: SpeechStreamHandlers) {
	let chunks: Float32Array[] = []
	let length = 0
	let committed = ""
	/** Samples up to and including the last one that sounded like speech, or 0. */
	let spokenTo = 0
	let noise = QUIETEST_SPEECH
	let lastPass = { length: 0, text: "" }
	let shown = ""
	let stopped = false
	let finished = false
	let busy = false

	const phrase = (end = length) => {
		const audio = new Float32Array(end)
		let offset = 0
		for (const chunk of chunks) {
			if (offset >= end) {
				break
			}
			audio.set(chunk.subarray(0, end - offset), offset)
			offset += chunk.length
		}
		return audio
	}
	const dropPhrase = (end: number) => {
		const rest = phrase().subarray(end)
		chunks = rest.length ? [rest.slice()] : []
		length = rest.length
		spokenTo = Math.max(0, spokenTo - end)
		lastPass = { length: 0, text: "" }
	}
	const show = (text: string) => {
		if (text !== shown) {
			shown = text
			onText(text, false)
		}
	}
	const finish = (text: string, error?: unknown) => {
		if (!finished) {
			finished = true
			onDone(text, error)
		}
	}

	const next = async () => {
		const paused = spokenTo > 0 && length - spokenTo >= PAUSE && spokenTo >= SHORTEST_PHRASE
		if (stopped) {
			// Nothing was said after the last pass, so its text is already final.
			if (spokenTo === 0 || spokenTo <= lastPass.length) {
				return join(committed, spokenTo === 0 ? "" : lastPass.text)
			}
			return join(committed, await transcribe(phrase()))
		}
		if (paused || length >= LONGEST_PHRASE) {
			const end = paused ? spokenTo : length
			// Everything after the last speech is quiet, so the next phrase starts near its first sound.
			const cut = paused ? Math.max(end, length - LEAD_IN) : length
			const text =
				paused && spokenTo <= lastPass.length
					? lastPass.text
					: await transcribe(phrase(end))
			committed = join(committed, text)
			dropPhrase(cut)
			show(committed)
		} else if (spokenTo > 0 && length - lastPass.length >= INTERIM_STEP) {
			const end = length
			const text = await transcribe(phrase(end))
			// A commit may have trimmed the phrase while this pass ran.
			if (!finished && end <= length) {
				lastPass = { length: end, text }
				show(join(committed, text))
			}
		} else {
			return undefined
		}
		return null
	}

	const pump = async () => {
		if (busy || finished) {
			return
		}
		busy = true
		try {
			for (;;) {
				const result = await next()
				if (finished) {
					return
				}
				if (typeof result === "string") {
					finish(result)
					return
				}
				if (result === undefined && !stopped) {
					return
				}
			}
		} catch (error) {
			finish(join(committed, lastPass.text), error)
		} finally {
			busy = false
		}
	}

	return {
		push(samples: Float32Array) {
			if (stopped || finished) {
				return
			}
			let sum = 0
			for (const sample of samples) {
				sum += sample * sample
			}
			const level = Math.sqrt(sum / (samples.length || 1))
			// The background level rises slowly and falls at once, so speech stands out from it.
			noise = level < noise ? level : noise + (level - noise) * 0.002
			chunks.push(samples)
			length += samples.length
			if (level > Math.max(QUIETEST_SPEECH, noise * 3)) {
				spokenTo = length
			}
			void pump()
		},
		stop() {
			stopped = true
			void pump()
		},
		abort() {
			finished = true
		}
	}
}