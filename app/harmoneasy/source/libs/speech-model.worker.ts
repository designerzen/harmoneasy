import { env, pipeline } from "@huggingface/transformers"
import {
	SPEECH_MODEL_ERROR,
	SPEECH_MODEL_LOAD,
	SPEECH_MODEL_PROGRESS,
	SPEECH_MODEL_TEXT,
	SPEECH_MODEL_TRANSCRIBE
} from "./speech-model-messages"

type Transcriber = (
	audio: Float32Array,
	options?: object
) => Promise<{ text: string } | { text: string }[]>

// Models only come from the Hugging Face hub; the app server has no local copies to probe.
env.allowLocalModels = false

let current: { model: string; transcriber: Promise<Transcriber> } | undefined
const files = new Map<string, { loaded: number; total: number }>()

function load(model: string) {
	if (current?.model !== model) {
		files.clear()
		const transcriber = pipeline("automatic-speech-recognition", model, {
			dtype: "q8",
			device: "wasm",
			progress_callback: (info: {
				status: string
				file?: string
				loaded?: number
				total?: number
			}) => {
				if (info.status === "progress" && info.file && info.total) {
					files.set(info.file, { loaded: info.loaded ?? 0, total: info.total })
					const sizes = [...files.values()]
					self.postMessage({
						kind: SPEECH_MODEL_PROGRESS,
						model,
						loaded: sizes.reduce((sum, file) => sum + file.loaded, 0),
						total: sizes.reduce((sum, file) => sum + file.total, 0)
					})
				}
			}
		}) as unknown as Promise<Transcriber>
		const loading = { model, transcriber }
		current = loading
		// A failed download can be retried on the next request.
		transcriber.catch(() => {
			if (current === loading) {
				current = undefined
			}
		})
	}
	return current.transcriber
}

self.onmessage = async ({
	data
}: MessageEvent<{ kind: string; id?: number; model: string; audio?: Float32Array }>) => {
	if (data.kind === SPEECH_MODEL_LOAD) {
		load(data.model).catch(() => {})
	} else if (data.kind === SPEECH_MODEL_TRANSCRIBE) {
		try {
			const transcribe = await load(data.model)
			const output = await transcribe(
				data.audio!,
				// Whisper reads 30 second windows, so longer speech is split with some overlap.
				data.model.includes("whisper") ? { chunk_length_s: 30, stride_length_s: 5 } : {}
			)
			const text = (
				Array.isArray(output) ? output.map((item) => item.text).join(" ") : output.text
			)
				// Whisper marks silence and noise as "[BLANK_AUDIO]" or "(music)".
				.replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
				.replace(/\s+/g, " ")
				.trim()
			self.postMessage({ kind: SPEECH_MODEL_TEXT, id: data.id, text })
		} catch (error) {
			self.postMessage({ kind: SPEECH_MODEL_ERROR, id: data.id, error: String(error) })
		}
	}
}