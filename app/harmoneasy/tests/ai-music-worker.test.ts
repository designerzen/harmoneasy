import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { NoteSequence } from "../../../packages/audiobus/node_modules/@magenta/music/esm/protobuf"
import { musicPrimer } from "../../../packages/audiobus/io/inputs/ai-music-sequences"
import { AI_MODELS } from "../../../packages/audiobus/io/inputs/ai-model-catalogue"
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
	sample: vi.fn(),
	similar: vi.fn()
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
		similar = mocks.similar
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
async function run(modelId: string, seed = [100], extra = {}) {
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
			temperature: 0.7,
			...extra
		}
	})
	return scope
}
it("uses Improv conditioning, folds melodic primers and normalizes protobuf timing", async () => {
	const scope = await run(AI_IMPROV)
	expect(mocks.rnn).toHaveBeenCalledWith(expect.stringContaining("/chord_pitches_improv"))
	expect(mocks.continueSequence).toHaveBeenCalledWith(
		expect.objectContaining({
			notes: [
				expect.objectContaining({
					pitch: 76,
					quantizedStartStep: 0,
					quantizedEndStep: 4,
					isDrum: false
				})
			]
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
	expect(mocks.dispose).not.toHaveBeenCalled()
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

it("gives actual protobuf notes with omitted velocities an audible default and keeps initialized models warm", async () => {
	const generated = NoteSequence.Note.create({
		pitch: 60,
		quantizedStartStep: 0,
		quantizedEndStep: 4
	})
	expect(generated.velocity).toBe(0)
	mocks.continueSequence.mockResolvedValue({ notes: [generated] })
	const scope = await run(AI_IMPROV)
	expect(scope.postMessage.mock.lastCall![0].notes[0].velocity).toBe(100)
	await scope.onmessage({
		data: {
			kind: AI_MUSIC_GENERATE,
			id: 2,
			modelId: AI_IMPROV,
			seed: [60],
			chords: ["C"],
			temperature: 1
		}
	})
	expect(mocks.initialize).toHaveBeenCalledOnce()
	expect(mocks.continueSequence).toHaveBeenCalledTimes(2)
	expect(mocks.dispose).not.toHaveBeenCalled()
})

it("passes real phrase timing and simultaneous drum hits to the model", async () => {
	const notes = [
		{ pitch: 36, start: 0, end: 1, velocity: 90, channel: 10 },
		{ pitch: 42, start: 0, end: 1, velocity: 70, channel: 10 },
		{ pitch: 38, start: 6, end: 7, velocity: 100, channel: 10 }
	]
	await run(AI_DRUMS, [], { notes, seedSteps: 16 })
	expect(
		mocks.continueSequence.mock.lastCall![0].notes.map((note: any) => [
			note.pitch,
			note.quantizedStartStep,
			note.quantizedEndStep
		])
	).toEqual([
		[36, 0, 1],
		[42, 0, 1],
		[38, 6, 7]
	])
})

it("generates related MusicVAE phrases using the captured sequence and similarity", async () => {
	mocks.similar.mockResolvedValue([
		{
			notes: [
				NoteSequence.Note.create({ pitch: 64, quantizedStartStep: 0, quantizedEndStep: 4 })
			]
		}
	])
	const notes = [
		{ pitch: 60, start: 0, end: 4, velocity: 100, channel: 1 },
		{ pitch: 40, start: 0, end: 4, velocity: 80, channel: 2 },
		{ pitch: 36, start: 0, end: 1, velocity: 90, channel: 10 }
	]
	await run(AI_TRIO, [], { notes, seedSteps: 64, operation: "variation", similarity: 0.8 })
	expect(mocks.sample).not.toHaveBeenCalled()
	expect(mocks.similar).toHaveBeenCalledWith(
		expect.objectContaining({
			notes: [
				expect.objectContaining({ instrument: 0, program: 0, isDrum: false }),
				expect.objectContaining({ instrument: 1, program: 32, isDrum: false }),
				expect.objectContaining({ instrument: 2, isDrum: true })
			]
		}),
		1,
		0.8,
		0.7
	)
})

it("makes melodic primers monophonic without losing rests or mutating captured notes", () => {
	const notes = [
		{ pitch: 60, start: 0, end: 8, velocity: 100, channel: 1 },
		{ pitch: 64, start: 0, end: 4, velocity: 100, channel: 1 },
		{ pitch: 67, start: 6, end: 8, velocity: 100, channel: 1 }
	]
	const primer = musicPrimer(notes, 16, AI_MODELS[AI_IMPROV])
	expect(
		primer.notes.map((note) => [note.pitch, note.quantizedStartStep, note.quantizedEndStep])
	).toEqual([
		[64, 0, 4],
		[67, 6, 8]
	])
	expect(notes[0].end).toBe(8)
})

it("merges duplicate drum classes and folds extreme melodic pitches into the selected model range", () => {
	const drum = (pitch: number) => ({ pitch, start: 0, end: 1, channel: 10, velocity: 100 })
	expect(
		musicPrimer([drum(35), drum(36), drum(42)], 16, AI_MODELS[AI_DRUMS]).notes.map(
			(note) => note.pitch
		)
	).toEqual([36, 42])
	expect(() => musicPrimer([drum(127)], 16, AI_MODELS[AI_DRUMS])).toThrow(
		"Unsupported drum pitch"
	)
	const notes = [
		{ pitch: 0, start: 0, end: 4, channel: 1, velocity: 100 },
		{ pitch: 127, start: 4, end: 8, channel: 1, velocity: 100 }
	]
	expect(musicPrimer(notes, 32, AI_MODELS[AI_MUSIC_VAE]).notes.map((note) => note.pitch)).toEqual(
		[24, 103]
	)
})