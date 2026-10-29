import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	ID_MAGENTA,
	TransformerMagenta
} from "../../../packages/audiobus/io/transformers/transformer-magenta"
import {
	MAGENTA_ERROR,
	MAGENTA_GENERATE,
	MAGENTA_RESULT
} from "../../../packages/audiobus/io/transformers/magenta-messages"
import { NOTE_ON, NOTE_OFF, CONTROL_CHANGE } from "../../../packages/audiobus/commands"
import { createAudioCommand } from "../../../packages/audiobus/audio-command-factory"
import { tranformerFactory, TRANSFORMERS } from "../../../packages/audiobus/io/transformer-factory"
import TransformerManagerWorker from "../../../packages/audiobus/io/transformer-manager-worker"

const workers: FakeWorker[] = []
class FakeWorker {
	onmessage?: (event: any) => void
	onerror?: () => void
	postMessage = vi.fn()
	terminate = vi.fn()
	constructor() {
		workers.push(this)
	}
	result(notes = [{ pitch: 66, quantizedStartStep: 0, quantizedEndStep: 4 }]) {
		this.onmessage?.({
			data: { kind: MAGENTA_RESULT, id: this.postMessage.mock.lastCall![0].id, notes }
		})
	}
}
const timer = { bpm: 120, now: 10 } as any
const note = (number = 60, startAt = 10) => ({
	...createAudioCommand(NOTE_ON, number, startAt),
	channel: 1
})

beforeEach(() => {
	workers.length = 0
	vi.stubGlobal("Worker", FakeWorker)
})
afterEach(() => vi.unstubAllGlobals())

describe("Magenta melody transformer", () => {
	it("registers and round trips every musical option", () => {
		expect(TRANSFORMERS).toContain(ID_MAGENTA)
		const transformer = tranformerFactory(ID_MAGENTA, {
			temperature: "0.5",
			root: "2",
			chordProgression: "Dm, G, C"
		})
		expect(transformer).toBeInstanceOf(TransformerMagenta)
		const config = JSON.parse(transformer.exportConfig())
		expect(config).toMatchObject({ type: ID_MAGENTA, temperature: 0.5, root: 2 })
		const restored = tranformerFactory(config.type, config)
		expect(JSON.parse(restored.exportConfig())).toEqual(config)
		for (const field of transformer.fields) {
			expect(field.default).toEqual(config[field.name])
		}
	})

	it("passes live input immediately and generates a quantized, monophonic primer", () => {
		const transformer = new TransformerMagenta({ chordProgression: "C, Am F G" })
		const input = [note(60), note(64)]
		expect(transformer.transform(input, timer)).toBe(input)
		expect(workers[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: MAGENTA_GENERATE,
				model: "chord_pitches_improv",
				steps: 32,
				temperature: 1,
				chords: ["C", "Am", "F", "G"]
			})
		)
		expect(workers[0].postMessage.mock.lastCall![0].notes).toEqual([
			{ pitch: 64, quantizedStartStep: 0, quantizedEndStep: 1 }
		])
	})

	it("schedules supplementary notes in key with matching note-offs and routing", () => {
		const transformer = new TransformerMagenta({
			channel: 3,
			delayBeats: 1,
			playbackRate: 2,
			gate: 0.5
		})
		transformer.transform([note()], timer)
		workers[0].result()
		const trigger = {
			...note(60, 20),
			ump: [123],
			umpOriginal: {} as any,
			raw: new Uint8Array([144, 60, 100])
		}
		const result = transformer.transform([trigger], timer)
		expect(result[0]).toBe(trigger)
		const [on, off] = result.slice(1)
		expect(on).toMatchObject({
			type: NOTE_ON,
			number: 65,
			startAt: 20.5,
			endAt: 20.625,
			channel: 3,
			velocity: 70
		})
		expect(off).toMatchObject({
			type: NOTE_OFF,
			number: 65,
			startAt: 20.625,
			channel: 3,
			velocity: 0
		})
		expect(on.ump).toBeUndefined()
		expect(on.raw).toHaveLength(0)
		expect(trigger.ump).toEqual([123])
	})

	it("does not overlap phrases, repeats when requested and retains control messages", () => {
		const transformer = new TransformerMagenta({ regenerate: 0 })
		transformer.transform([note()], timer)
		workers[0].result()
		expect(transformer.transform([note(60, 20)], timer)).toHaveLength(3)
		expect(transformer.transform([note(60, 21)], timer)).toHaveLength(1)
		expect(transformer.transform([note(60, 24)], timer)).toHaveLength(3)
		expect(workers[0].postMessage).toHaveBeenCalledTimes(1)
		const control = createAudioCommand(CONTROL_CHANGE, 64, 24)
		expect(transformer.transform([control], timer)).toEqual([control])
	})

	it("normalizes UI values, disables generation and ignores drum/zero-velocity notes", () => {
		const transformer = new TransformerMagenta()
		transformer.setConfig("enabled", "0")
		const commands = [note()]
		expect(transformer.transform(commands, timer)).toBe(commands)
		expect(workers).toHaveLength(0)
		transformer.setConfig("enabled", "1")
		transformer.transform(
			[
				{ ...note(), channel: 10 },
				{ ...note(), velocity: 0 }
			],
			timer
		)
		expect(workers).toHaveLength(0)
		transformer.setConfig("temperature", "0.25")
		transformer.transform(commands, timer)
		expect(workers[0].postMessage.mock.lastCall![0].temperature).toBe(0.25)
	})

	it("shows generation failures without retry storms and can retry after a setting change", () => {
		const transformer = new TransformerMagenta()
		transformer.transform([note()], timer)
		workers[0].onmessage?.({
			data: {
				kind: MAGENTA_ERROR,
				id: workers[0].postMessage.mock.lastCall![0].id,
				error: "Download failed"
			}
		})
		expect(transformer.status).toContain("Download failed")
		expect(transformer.transform([note()], timer)).toHaveLength(1)
		expect(workers).toHaveLength(1)
		transformer.setConfig("root", "2")
		transformer.transform([note()], timer)
		expect(workers).toHaveLength(2)
	})

	it("discards stale generation after reset and terminates workers on removal", () => {
		const transformer = new TransformerMagenta()
		transformer.transform([note()], timer)
		const worker = workers[0]
		transformer.reset()
		worker.result()
		expect(transformer.transform([note()], timer)).toHaveLength(1)
		const manager = new TransformerManagerWorker([transformer])
		manager.setTransformers([transformer])
		expect(workers[1].terminate).not.toHaveBeenCalled()
		manager.removeTransformer(transformer)
		expect(workers[1].terminate).toHaveBeenCalledOnce()
		expect(transformer.transform([note()], timer)).toHaveLength(1)
		expect(workers).toHaveLength(2)
	})
})