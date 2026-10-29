import { afterEach, beforeEach, expect, it, vi } from "vitest"
import {
	MAGENTA_ERROR,
	MAGENTA_GENERATE,
	MAGENTA_RESULT
} from "../../../packages/audiobus/io/transformers/magenta-messages"

const model = vi.hoisted(() => ({
	initialize: vi.fn(async () => {}),
	continueSequence: vi.fn(async () => ({
		notes: [{ pitch: 72, quantizedStartStep: "8", quantizedEndStep: "16" }]
	})),
	dispose: vi.fn()
}))
vi.mock("../../../packages/audiobus/node_modules/@magenta/music/esm/music_rnn", () => ({
	MusicRNN: class {
		initialize = model.initialize
		continueSequence = model.continueSequence
		dispose = model.dispose
	}
}))
beforeEach(() => {
	vi.resetModules()
	vi.clearAllMocks()
	vi.stubGlobal("window", undefined)
})
afterEach(() => vi.unstubAllGlobals())

it("folds out-of-range seeds, supplies chords and normalizes protobuf timing", async () => {
	const scope = { onmessage: null as any, postMessage: vi.fn() }
	vi.stubGlobal("self", scope)
	await import("../../../packages/audiobus/io/transformers/magenta.worker")
	await scope.onmessage({
		data: {
			kind: MAGENTA_GENERATE,
			id: 1,
			model: "chord_pitches_improv",
			notes: [{ pitch: 100, quantizedStartStep: 0, quantizedEndStep: 4 }],
			totalQuantizedSteps: 4,
			steps: 16,
			temperature: 0.5,
			chords: ["C", "G"]
		}
	})
	expect(model.continueSequence).toHaveBeenCalledWith(
		{
			notes: [{ pitch: 76, quantizedStartStep: 0, quantizedEndStep: 4 }],
			quantizationInfo: { stepsPerQuarter: 4 },
			totalQuantizedSteps: 4
		},
		16,
		0.5,
		["C", "G"]
	)
	expect(scope.postMessage).toHaveBeenCalledWith({
		kind: MAGENTA_RESULT,
		id: 1,
		notes: [{ pitch: 72, quantizedStartStep: 8, quantizedEndStep: 16 }]
	})
})

it("omits chord conditioning for MelodyRNN and reports inference failures", async () => {
	const scope = { onmessage: null as any, postMessage: vi.fn() }
	vi.stubGlobal("self", scope)
	await import("../../../packages/audiobus/io/transformers/magenta.worker")
	model.continueSequence.mockRejectedValueOnce(new Error("Invalid chord"))
	await scope.onmessage({
		data: {
			kind: MAGENTA_GENERATE,
			id: 2,
			model: "basic_rnn",
			notes: [{ pitch: 60, quantizedStartStep: 0, quantizedEndStep: 4 }],
			totalQuantizedSteps: 4,
			steps: 8,
			temperature: 0,
			chords: ["C"]
		}
	})
	expect(model.continueSequence.mock.lastCall![3]).toBeUndefined()
	expect(scope.postMessage).toHaveBeenCalledWith({
		kind: MAGENTA_ERROR,
		id: 2,
		error: "Error: Invalid chord"
	})
	expect(model.dispose).toHaveBeenCalled()
})