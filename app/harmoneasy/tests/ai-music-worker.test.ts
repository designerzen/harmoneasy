import { afterEach, beforeEach, expect, it, vi } from "vitest"
import {
	AI_MUSIC_GENERATE,
	AI_MUSIC_RESULT,
	AI_MUSIC_ERROR
} from "../../../packages/audiobus/io/inputs/ai-music-messages"
import {
	AI_IMPROV,
	AI_MELODY,
	AI_DRUMS,
	AI_TRIO,
	AI_MUSIC_VAE
} from "../../../packages/audiobus/io/inputs/input-types"
const mocks = vi.hoisted(() => ({
	initialize: vi.fn(async () => {}),
	dispose: vi.fn(),
	rnn: vi.fn(),
	vae: vi.fn(),
	continueSequence: vi.fn(),
	sample: vi.fn()
}))
vi.mock("../../../packages/audiobus/node_modules/@magenta/music/esm/music_rnn", () => ({
	MusicRNN: class {
		constructor(url: string) {
			mocks.rnn(url)
		}
		initialize = mocks.initialize
		dispose = mocks.dispose
		continueSequence = mocks.continueSequence
	}
}))
vi.mock("../../../packages/audiobus/node_modules/@magenta/music/esm/music_vae", () => ({
	MusicVAE: class {
		constructor(url: string) {
			mocks.vae(url)
		}
		initialize = mocks.initialize
		dispose = mocks.dispose
		sample = mocks.sample
	}
}))
beforeEach(() => {
	vi.resetModules()
	vi.clearAllMocks()
	vi.stubGlobal("window", undefined)
	mocks.continueSequence.mockResolvedValue({
		notes: [{ pitch: 67, quantizedStartStep: "0", quantizedEndStep: "4" }]
	})
	mocks.sample.mockResolvedValue([
		{
			notes: [
				{ pitch: 60, quantizedStartStep: 0, quantizedEndStep: 4, instrument: 0 },
				{ pitch: 40, quantizedStartStep: 0, quantizedEndStep: 4, instrument: 1 },
				{
					pitch: 36,
					quantizedStartStep: 0,
					quantizedEndStep: 1,
					instrument: 2,
					isDrum: true,
					velocity: 80
				}
			]
		}
	])
})
afterEach(() => vi.unstubAllGlobals())
async function run(modelId: string, seed = [100]) {
	vi.resetModules()
	const scope = { onmessage: undefined as any, postMessage: vi.fn() }
	vi.stubGlobal("self", scope)
	await import("../../../packages/audiobus/io/inputs/ai-music.worker")
	await scope.onmessage({
		data: {
			kind: AI_MUSIC_GENERATE,
			id: 1,
			modelId,
			seed,
			chords: ["C", "Am"],
			temperature: 0.7
		}
	})
	return scope
}
it("uses Improv conditioning, folds melodic primers and normalizes protobuf timing", async () => {
	const scope = await run(AI_IMPROV)
	expect(mocks.rnn).toHaveBeenCalledWith(expect.stringContaining("/chord_pitches_improv"))
	expect(mocks.continueSequence).toHaveBeenCalledWith(
		expect.objectContaining({
			notes: [{ pitch: 76, quantizedStartStep: 0, quantizedEndStep: 4, isDrum: false }]
		}),
		64,
		0.7,
		["C", "Am"]
	)
	expect(scope.postMessage).toHaveBeenCalledWith({
		kind: AI_MUSIC_RESULT,
		id: 1,
		steps: 64,
		notes: [{ pitch: 67, start: 0, end: 4, velocity: 100, channel: 1 }]
	})
	expect(mocks.dispose).toHaveBeenCalledOnce()
})
it("preserves drum pitches and omits chord conditioning for unconditioned models", async () => {
	const scope = await run(AI_DRUMS, [36, 42])
	expect(mocks.continueSequence.mock.lastCall![0].notes[0]).toMatchObject({
		pitch: 36,
		isDrum: true
	})
	expect(mocks.continueSequence.mock.lastCall![3]).toBeUndefined()
	expect(scope.postMessage.mock.lastCall![0].notes[0].channel).toBe(10)
	await run(AI_MELODY)
	expect(mocks.continueSequence.mock.lastCall![3]).toBeUndefined()
})
it("samples MusicVAE and preserves melody, bass and drum routing for trios", async () => {
	const scope = await run(AI_TRIO)
	expect(mocks.vae).toHaveBeenCalledWith(expect.stringContaining("/trio_4bar"))
	expect(mocks.sample).toHaveBeenCalledWith(1, 0.7)
	expect(scope.postMessage.mock.lastCall![0].notes.map((note: any) => note.channel)).toEqual([
		1, 2, 10
	])
	await run(AI_MUSIC_VAE)
	expect(mocks.vae).toHaveBeenLastCalledWith(expect.stringContaining("/mel_2bar_small"))
})
it("reports model failures and disposes allocated resources", async () => {
	mocks.initialize.mockRejectedValueOnce(new Error("Download denied"))
	const scope = await run(AI_IMPROV)
	expect(scope.postMessage).toHaveBeenLastCalledWith({
		kind: AI_MUSIC_ERROR,
		id: 1,
		error: "Download denied"
	})
	expect(mocks.dispose).toHaveBeenCalledOnce()
})