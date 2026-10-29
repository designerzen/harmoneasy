import { afterEach, expect, it, vi } from "vitest"
import {
	SPEECH_AUDIO,
	SPEECH_GENERATE,
	SPEECH_PRELOAD
} from "../../../packages/audiobus/io/outputs/speech-messages"

const state = vi.hoisted(() => ({
	saved: new Map<string, { audio: Float32Array; sampling_rate: number }>(),
	generate: vi.fn(async () => ({ audio: new Float32Array([0, 1]), sampling_rate: 24000 }))
}))
vi.mock("../../../packages/audiobus/node_modules/kokoro-js", () => ({
	KokoroTTS: { from_pretrained: vi.fn(async () => ({ generate: state.generate })) }
}))
vi.mock("../../../packages/audiobus/io/outputs/speech-audio-cache.ts", () => ({
	savedSpeech: vi.fn(async (key: string) => state.saved.get(key)),
	saveSpeech: vi.fn(async (key: string, audio: any) => {
		state.saved.set(key, audio)
	})
}))
vi.mock("../../../packages/audiobus/io/outputs/speech-vocabulary.ts", () => ({
	SPEECH_VOCABULARY: ["C4", "D4", "C major"],
	speechCacheKey: (text: string) => text,
	pronounceSpeech: (text: string) => text
}))

afterEach(() => {
	vi.useRealTimers()
	vi.unstubAllGlobals()
})

it("prioritizes live speech, persists the whole vocabulary and restores it without inference", async () => {
	vi.useFakeTimers()
	const worker = { onmessage: null as any, postMessage: vi.fn() }
	vi.stubGlobal("self", worker)
	await import("../../../packages/audiobus/io/outputs/kokoro.worker")
	worker.onmessage({ data: { kind: SPEECH_PRELOAD } })
	worker.onmessage({ data: { kind: SPEECH_GENERATE, id: 1, text: "Live note" } })
	await vi.runAllTimersAsync()
	expect(state.generate).toHaveBeenCalledTimes(4)
	expect(worker.postMessage.mock.calls.map(([data]) => data.text)).toEqual([
		"C4",
		"Live note",
		"D4",
		"C major"
	])
	expect(worker.postMessage).toHaveBeenCalledWith(
		expect.objectContaining({ kind: SPEECH_AUDIO, id: 1, text: "Live note" })
	)
	expect(state.saved.size).toBe(4)
	worker.postMessage.mockClear()
	worker.onmessage({ data: { kind: SPEECH_PRELOAD } })
	await vi.runAllTimersAsync()
	expect(state.generate).toHaveBeenCalledTimes(4)
	expect(worker.postMessage.mock.calls.map(([data]) => data.text)).toEqual([
		"C4",
		"D4",
		"C major"
	])
})