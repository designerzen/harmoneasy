import { expect, it, vi } from "vitest"
import {
	cleanTranscript,
	createSpeechStream,
	SPEECH_SAMPLE_RATE
} from "../source/libs/speech-stream"
import { createResampler } from "../source/libs/speech-recognisers"

const CHUNK = 320 // 20 ms
const speech = () => Float32Array.from({ length: CHUNK }, (_, i) => 0.3 * Math.sin(i / 3))
const silence = () => new Float32Array(CHUNK)

/** Each pass "hears" one word per 0.25 s of audio, after an optional delay. */
function setup({ delay = false } = {}) {
	const passes: { length: number; finish: () => void }[] = []
	const transcribe = vi.fn(
		(audio: Float32Array) =>
			new Promise<string>((resolve) => {
				const text = Array.from(
					{ length: Math.round(audio.length / (SPEECH_SAMPLE_RATE / 4)) },
					() => "word"
				).join(" ")
				const pass = { length: audio.length, finish: () => resolve(text) }
				passes.push(pass)
				if (!delay) {
					pass.finish()
				}
			})
	)
	const onText = vi.fn()
	const onDone = vi.fn()
	const stream = createSpeechStream({ transcribe, onText, onDone })
	const feed = async (make: () => Float32Array, seconds: number) => {
		for (let i = 0; i < (seconds * SPEECH_SAMPLE_RATE) / CHUNK; i++) {
			stream.push(make())
			await Promise.resolve()
		}
		await new Promise((resolve) => setTimeout(resolve))
	}
	return { stream, transcribe, onText, onDone, passes, feed }
}

it("shows text while the person is still speaking", async () => {
	const ui = setup()
	await ui.feed(speech, 1)
	expect(ui.onText).toHaveBeenCalled()
	expect(ui.onText.mock.calls.every(([, final]) => final === false)).toBe(true)
	expect(ui.onText.mock.lastCall![0]).toMatch(/^word( word)+$/)
	expect(ui.onDone).not.toHaveBeenCalled()
})

it("ignores silence and finishes with nothing when no one speaks", async () => {
	const ui = setup()
	await ui.feed(silence, 2)
	ui.stream.stop()
	await vi.waitFor(() => expect(ui.onDone).toHaveBeenCalledOnce())
	expect(ui.onDone.mock.lastCall![0]).toBe("")
	expect(ui.transcribe).not.toHaveBeenCalled()
})

it("commits at pauses so each pass only covers the current phrase", async () => {
	const ui = setup()
	await ui.feed(speech, 1)
	await ui.feed(silence, 0.7)
	await ui.feed(speech, 1)
	const longest = Math.max(...ui.passes.map((pass) => pass.length))
	expect(longest).toBeLessThan(SPEECH_SAMPLE_RATE * 1.6)
	const committed = ui.onText.mock.calls.find(([text]) => text.split(" ").length >= 4)
	expect(committed).toBeDefined()
	expect(ui.onText.mock.lastCall![0].split(" ").length).toBeGreaterThan(4)
})

it("finishes at once when the last pass already covers everything said", async () => {
	const ui = setup()
	await ui.feed(speech, 1)
	await ui.feed(silence, 0.3)
	const passes = ui.transcribe.mock.calls.length
	ui.stream.stop()
	await vi.waitFor(() => expect(ui.onDone).toHaveBeenCalledOnce())
	expect(ui.transcribe).toHaveBeenCalledTimes(passes)
	expect(ui.onDone.mock.lastCall![0]).toBe(ui.onText.mock.lastCall![0])
})

it("only transcribes the unfinished phrase when stopped mid-word", async () => {
	const ui = setup()
	await ui.feed(speech, 1)
	await ui.feed(silence, 0.7)
	await ui.feed(speech, 0.2)
	ui.stream.stop()
	await vi.waitFor(() => expect(ui.onDone).toHaveBeenCalledOnce())
	expect(ui.passes.at(-1)!.length).toBeLessThan(SPEECH_SAMPLE_RATE * 0.7)
	expect(ui.onDone.mock.lastCall![0].split(" ").length).toBeGreaterThanOrEqual(4)
})

it("runs one pass at a time and skips ahead to the newest audio", async () => {
	const ui = setup({ delay: true })
	await ui.feed(speech, 0.5)
	expect(ui.passes).toHaveLength(1)
	await ui.feed(speech, 1.5)
	expect(ui.passes).toHaveLength(1)
	ui.passes[0].finish()
	await vi.waitFor(() => expect(ui.passes).toHaveLength(2))
	expect(ui.passes[1].length).toBeGreaterThanOrEqual(SPEECH_SAMPLE_RATE * 1.9)
})

it("splits long speech before it outgrows the model and reports errors with what it has", async () => {
	const long = setup()
	await long.feed(speech, 16)
	expect(Math.max(...long.passes.map((pass) => pass.length))).toBeLessThanOrEqual(
		SPEECH_SAMPLE_RATE * 15
	)

	const failing = setup({ delay: true })
	await failing.feed(speech, 0.5)
	failing.passes[0].finish()
	await failing.feed(speech, 0.5)
	failing.transcribe.mockRejectedValueOnce(new Error("model failed"))
	failing.passes[1].finish()
	await failing.feed(speech, 0.5)
	failing.stream.stop()
	await vi.waitFor(() => expect(failing.onDone).toHaveBeenCalledOnce())
	expect(failing.onDone.mock.lastCall![1]).toBeInstanceOf(Error)
})

it("stays silent after being aborted", async () => {
	const ui = setup({ delay: true })
	await ui.feed(speech, 0.5)
	ui.stream.abort()
	ui.passes[0].finish()
	ui.stream.stop()
	await new Promise((resolve) => setTimeout(resolve))
	expect(ui.onText).not.toHaveBeenCalled()
	expect(ui.onDone).not.toHaveBeenCalled()
})

it("resamples live audio to 16 kHz across chunk boundaries", () => {
	const resample = createResampler(48000)
	const ramp = (start: number) =>
		Float32Array.from({ length: 480 }, (_, i) => (start + i) / 48000)
	const first = resample(ramp(0))
	const second = resample(ramp(480))
	expect(first.length + second.length).toBeGreaterThanOrEqual(319)
	expect(first.length + second.length).toBeLessThanOrEqual(320)
	const joined = [...first, ...second]
	joined.forEach((value, index) => expect(value).toBeCloseTo((index * 3) / 48000, 6))
	expect(createResampler(16000)(ramp(0))).toHaveLength(480)
})

it("cuts a model's repetition loop and drops Whisper's noise markers", () => {
	expect(cleanTranscript(" I want to play slow jazz. [BLANK_AUDIO]")).toBe(
		"I want to play slow jazz."
	)
	expect(
		cleanTranscript(
			"show the new controller and show the new controller and show the new controller and show"
		)
	).toBe("show the new controller and")
	expect(cleanTranscript("show the node node node node node")).toBe("show the node")
	expect(cleanTranscript("a very very slow song (music)")).toBe("a very very slow song")
})