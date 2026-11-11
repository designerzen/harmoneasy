// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	TransformerAIMusic,
	AI_TRANSFORMER_MODELS,
	ID_AI_IMPROV
} from "../../../packages/audiobus/io/transformers/transformer-ai-music"
import { AI_DRUMS, AI_MUSIC_VAE, AI_TRIO } from "../../../packages/audiobus/io/inputs/input-types"
import {
	AI_MUSIC_RESULT,
	AI_MUSIC_ERROR
} from "../../../packages/audiobus/io/inputs/ai-music-messages"
import { tranformerFactory, TRANSFORMERS } from "../../../packages/audiobus/io/transformer-factory"
import { TRANSFORMER_DEFINITIONS } from "../../../packages/audiobus/io/transformer-definitions"
import { advanceTransformers } from "../../../packages/audiobus/io/transformer-pipeline"
import { NOTE_ON, NOTE_OFF, CONTROL_CHANGE } from "../../../packages/audiobus/commands/commands"
import { createAudioCommand } from "../../../packages/audiobus/commands/audio-command-factory"
import type { Timer } from "netronome"

const workers: FakeWorker[] = [],
	devices: TransformerAIMusic[] = []
class FakeWorker {
	onmessage?: (event: any) => void
	onerror?: () => void
	postMessage = vi.fn()
	terminate = vi.fn()
	constructor() {
		workers.push(this)
	}
	result(notes = [{ pitch: 67, start: 0, end: 4, velocity: 100, channel: 1 }], steps = 64) {
		this.onmessage?.({
			data: { kind: AI_MUSIC_RESULT, id: this.postMessage.mock.lastCall![0].id, notes, steps }
		})
	}
}
const timer = (now: number, bpm = 120) => ({ now, bpm }) as Timer
const note = (at: number, pitch = 60, type = NOTE_ON, channel = 1) => ({
	...createAudioCommand(type, pitch, at),
	channel,
	velocity: type === NOTE_OFF ? 0 : 100,
	from: "keyboard",
	time: at
})
const make = (config = {}, model?: string) => {
	const transformer = new TransformerAIMusic(config, model)
	devices.push(transformer)
	return transformer
}
beforeEach(() => {
	workers.length = 0
	vi.stubGlobal("Worker", FakeWorker)
})
afterEach(() => {
	devices.splice(0).forEach((device) => device.destroy())
	vi.unstubAllGlobals()
})

describe("AI phrase transformer registration and capture", () => {
	it("registers five attributed models and round trips their controls", async () => {
		for (const [id, model] of Object.entries(AI_TRANSFORMER_MODELS)) {
			expect(TRANSFORMERS).toContain(id)
			const device = tranformerFactory(id, {
				temperature: "0.5",
				level: "90"
			}) as TransformerAIMusic
			devices.push(device)
			expect(device.options).toMatchObject({ modelId: model, temperature: 0.5, level: 90 })
			const config = JSON.parse(device.exportConfig()),
				restored = tranformerFactory(config.type, config)
			devices.push(restored as TransformerAIMusic)
			expect(JSON.parse(restored.exportConfig())).toEqual(config)
			expect(TRANSFORMER_DEFINITIONS[id].attribution?.author).toContain("Magenta")
			const gui = await device.createGui()
			expect(gui.querySelector(".ai-model-attribution")?.textContent).toContain(
				"The Magenta Team"
			)
			expect(gui.querySelector(".ai-model-attribution a")?.getAttribute("href")).toBe(
				"https://github.com/magenta/magenta-js"
			)
		}
		expect(workers).toHaveLength(0)
	})
	it("keeps live MIDI immediate and captures durations and rests", () => {
		const device = make(),
			input = [note(0), note(0.25, 60, NOTE_OFF), note(0.75, 64), note(1, 64, NOTE_OFF)]
		expect(device.transform(input, timer(0))).toBe(input)
		expect(workers).toHaveLength(0)
		device.tick(8, timer(8))
		expect(workers[0].postMessage.mock.lastCall![0]).toMatchObject({
			seedSteps: 64,
			notes: [
				{ pitch: 60, start: 0, end: 2, velocity: 100, channel: 1 },
				{ pitch: 64, start: 6, end: 8, velocity: 100, channel: 1 }
			]
		})
	})
	it("retains simultaneous drum hits, velocities and channel routing", () => {
		const device = make({}, AI_DRUMS)
		device.transform(
			[
				note(0, 36, NOTE_ON, 10),
				{ ...note(0, 42, NOTE_ON, 10), velocity: 70 },
				note(0.125, 36, NOTE_OFF, 10),
				note(0.125, 42, NOTE_OFF, 10),
				note(0.5, 38, NOTE_ON, 10)
			],
			timer(0)
		)
		device.generate()
		expect(workers[0].postMessage.mock.lastCall![0].notes).toEqual([
			{ pitch: 36, start: 0, end: 1, velocity: 100, channel: 10 },
			{ pitch: 42, start: 0, end: 1, velocity: 70, channel: 10 },
			{ pitch: 38, start: 4, end: 64, velocity: 100, channel: 10 }
		])
	})
	it("requests MusicVAE variations from captured input instead of unrelated sampling", () => {
		const device = make({ similarity: 0.9 }, AI_MUSIC_VAE)
		device.transform([note(0), note(0.5, 60, NOTE_OFF)], timer(0))
		device.tick(4, timer(4))
		expect(workers[0].postMessage.mock.lastCall![0]).toMatchObject({
			operation: "variation",
			seedSteps: 32,
			similarity: 0.9,
			notes: [{ pitch: 60, start: 0, end: 4, velocity: 100, channel: 1 }]
		})
	})
	it("captures separate trio parts and ignores other channels", () => {
		const device = make({}, AI_TRIO)
		const input = [
			note(0),
			note(0, 40, NOTE_ON, 2),
			note(0, 36, NOTE_ON, 10),
			note(0, 80, NOTE_ON, 5)
		]
		expect(device.transform(input, timer(0))).toBe(input)
		device.generate()
		expect(
			workers[0].postMessage.mock.lastCall![0].notes.map((note: any) => note.channel)
		).toEqual([1, 2, 10])
	})
})

describe("AI phrase replies and cancellation", () => {
	it("starts on the next shared bar without another input event and strips native payloads", () => {
		const device = make()
		device.setMusicalBeat(6)
		device.transform(
			[{ ...note(10), ump: [123], raw: new Uint8Array([144, 60, 100]) }],
			timer(10)
		)
		device.generate()
		workers[0].result()
		expect(device.tick(10.5, timer(10.5))).toEqual([])
		const response = advanceTransformers([device], 11, timer(11))
		expect(response).toHaveLength(1)
		expect(response[0]).toMatchObject({
			type: NOTE_ON,
			number: 67,
			velocity: 80,
			channel: 1,
			startAt: 11
		})
		expect(response[0].raw).toHaveLength(0)
		expect(response[0].ump).toBeUndefined()
		expect(device.tick(11.5, timer(11.5))[0]).toMatchObject({
			type: NOTE_OFF,
			number: 67,
			channel: 1
		})
	})
	it("follows tempo changes and releases notes on disable", () => {
		const device = make()
		device.transform([note(0)], timer(0))
		device.generate()
		workers[0].result()
		expect(device.tick(2, timer(2))[0].type).toBe(NOTE_ON)
		expect(device.tick(2.25, timer(2.25, 60))).toEqual([])
		device.setConfig("enabled", "0")
		expect(device.tick(2.3, timer(2.3))[0]).toMatchObject({ type: NOTE_OFF, number: 67 })
		const input = [note(3)]
		expect(device.transform(input, timer(3))).toBe(input)
	})
	it("releases overlapping generated pitches only when the final voice ends", () => {
		const device = make()
		device.transform([note(0)], timer(0))
		device.generate()
		workers[0].result([
			{ pitch: 67, start: 0, end: 8, velocity: 100, channel: 1 },
			{ pitch: 67, start: 2, end: 4, velocity: 100, channel: 1 }
		])
		expect(device.tick(2, timer(2))).toHaveLength(1)
		expect(device.tick(2.25, timer(2.25))).toEqual([])
		expect(device.tick(2.5, timer(2.5))).toEqual([])
		expect(device.tick(3, timer(3))[0].type).toBe(NOTE_OFF)
	})
	it("reuses a warm worker for the next captured phrase", () => {
		const device = make()
		device.transform([note(0)], timer(0))
		device.generate()
		workers[0].result()
		device.tick(2, timer(2))
		device.tick(10, timer(10))
		device.transform([note(10.5)], timer(10.5))
		device.generate()
		expect(workers).toHaveLength(1)
		expect(workers[0].postMessage).toHaveBeenCalledTimes(2)
	})
	it("skips expired response notes after a stalled tab", () => {
		const device = make()
		device.transform([note(0)], timer(0))
		device.generate()
		workers[0].result()
		expect(device.tick(4, timer(4))).toEqual([])
	})
	it("ignores stale results after reset and removal", () => {
		const device = make()
		device.transform([note(0)], timer(0))
		device.generate()
		device.reset()
		workers[0].result()
		expect(device.tick(2, timer(2))).toEqual([])
		device.transform([note(3)], timer(3))
		device.generate()
		device.destroy()
		workers[1].result()
		expect(device.tick(4, timer(4))).toEqual([])
		expect(workers[1].terminate).toHaveBeenCalled()
	})
	it("reports errors without repeated downloads, preserves controllers and retries after clearing", () => {
		const device = make()
		device.transform([note(0)], timer(0))
		device.generate()
		workers[0].onmessage!({
			data: {
				kind: AI_MUSIC_ERROR,
				id: workers[0].postMessage.mock.lastCall![0].id,
				error: "Download failed"
			}
		})
		device.tick(8, timer(8))
		expect(workers).toHaveLength(1)
		expect(device.status).toContain("Download failed")
		const control = createAudioCommand(CONTROL_CHANGE, 64, 8)
		expect(device.transform([control], timer(8))).toEqual([control])
		device.setConfig("clear", true)
		device.transform([note(9)], timer(9))
		device.generate()
		expect(workers).toHaveLength(2)
		expect(tranformerFactory(ID_AI_IMPROV)).toBeInstanceOf(TransformerAIMusic)
	})
})