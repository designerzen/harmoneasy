import { afterEach, describe, expect, it, vi } from "vitest"
import OutputSpeechSynthesis from "../../../packages/audiobus/io/outputs/output-speech-synthesis"
import { KokoroSpeech } from "../../../packages/audiobus/io/outputs/kokoro-speech"

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

function setup() {
	const synth = { speak: vi.fn(), cancel: vi.fn() }
	const gain = { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } }
	const source = {
		connect: vi.fn(),
		disconnect: vi.fn(),
		start: vi.fn(),
		stop: vi.fn(),
		playbackRate: { value: 1 },
		detune: { value: 0 },
		onended: null
	}
	const context = {
		resume: vi.fn().mockResolvedValue(undefined),
		close: vi.fn(),
		destination: {},
		createBuffer: vi.fn(() => ({ copyToChannel: vi.fn() })),
		createBufferSource: vi.fn(() => source),
		createGain: vi.fn(() => gain)
	}
	vi.stubGlobal("window", { speechSynthesis: synth })
	vi.stubGlobal("Worker", class {})
	vi.stubGlobal(
		"AudioContext",
		class {
			constructor() {
				return context
			}
		}
	)
	vi.stubGlobal(
		"SpeechSynthesisUtterance",
		class {
			constructor(public text: string) {}
		}
	)
	const generate = vi.spyOn(KokoroSpeech.prototype, "generate")
	vi.spyOn(KokoroSpeech.prototype, "preload").mockImplementation(() => {})
	const audio = { audio: new Float32Array([0, 0.5, 0]), sampling_rate: 24000 }
	return { synth, source, context, generate, audio }
}

describe("speech readout", () => {
	it("routes shared-context speech to the mixer without closing the application context", async () => {
		const { generate, audio, context, source } = setup()
		generate.mockResolvedValue(audio)
		const mixer = {} as AudioNode
		const output = new OutputSpeechSynthesis({}, context as unknown as AudioContext, mixer)
		output.noteOn(60)
		await vi.waitFor(() => expect(source.start).toHaveBeenCalledOnce())
		expect(context.createGain().connect).toHaveBeenCalledWith(mixer)
		await output.disconnect()
		expect(context.close).not.toHaveBeenCalled()
	})
	it("prefers Kokoro and applies rate, pitch and volume", async () => {
		const { synth, source, generate, audio, context } = setup()
		generate.mockResolvedValue(audio)
		const output = new OutputSpeechSynthesis({ volume: 0.4, pitch: 1.5 })
		output.noteOn(60)
		await vi.waitFor(() => expect(source.start).toHaveBeenCalledOnce())
		expect(synth.speak).not.toHaveBeenCalled()
		expect(source.playbackRate.value).toBeCloseTo((60 / 127) * 1.5 + 0.5)
		expect(source.detune.value).toBe(600)
		expect(context.createGain().gain.value).toBe(0.4)
		await output.disconnect()
		expect(source.stop).toHaveBeenCalledOnce()
	})

	it("falls back to system speech if Kokoro fails", async () => {
		const { synth, generate } = setup()
		generate.mockRejectedValue(new Error("Model unavailable"))
		const output = new OutputSpeechSynthesis()
		output.noteOn(60)
		await vi.waitFor(() => expect(synth.speak).toHaveBeenCalledOnce())
		output.noteOn(62)
		expect(synth.speak).toHaveBeenCalledTimes(2)
		expect(generate).toHaveBeenCalledOnce()
	})

	it.each(["allNotesOff", "noteOff", "disconnect"] as const)(
		"prevents late playback after %s",
		async (action) => {
			const { synth, source, generate, audio } = setup()
			let resolve!: (value: typeof audio) => void
			generate.mockImplementation(
				() =>
					new Promise((done) => {
						resolve = done
					})
			)
			const output = new OutputSpeechSynthesis({ interruption: true })
			output.noteOn(60)
			if (action === "noteOff") {
				output.noteOff(60)
			} else {
				await output[action]()
			}
			resolve(audio)
			await new Promise((done) => setTimeout(done, 0))
			expect(source.start).not.toHaveBeenCalled()
			expect(synth.speak).not.toHaveBeenCalled()
		}
	)

	it("plays only the latest note when generation completes out of order", async () => {
		const { source, generate, audio } = setup()
		let first!: (value: typeof audio) => void
		generate
			.mockImplementationOnce(
				() =>
					new Promise((done) => {
						first = done
					})
			)
			.mockResolvedValue(audio)
		const output = new OutputSpeechSynthesis()
		output.noteOn(60)
		output.noteOn(62)
		await vi.waitFor(() => expect(source.start).toHaveBeenCalledOnce())
		first(audio)
		await new Promise((done) => setTimeout(done, 0))
		expect(source.start).toHaveBeenCalledOnce()
	})
})