// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import InputAIMusic, { parseAIPrimer } from "../../../packages/audiobus/io/inputs/input-ai-music"
import { AI_MODELS } from "../../../packages/audiobus/io/inputs/ai-model-catalogue"
import { AI_IMPROV, AI_DRUMS, AI_TRIO } from "../../../packages/audiobus/io/inputs/input-types"
import {
	AI_MUSIC_ERROR,
	AI_MUSIC_RESULT,
	validateMusicNotes
} from "../../../packages/audiobus/io/inputs/ai-music-messages"
import { INPUT_FACTORIES, createInputById } from "../../../packages/audiobus/io/input-factory"
import { INPUT_DEFINITIONS } from "../../../packages/audiobus/io/input-definitions"
import { deviceDefinition } from "../../../packages/audiobus/io/device-definition"
import {
	INPUT_EVENT,
	EVENT_CONFIGURATION_CHANGED
} from "../../../packages/audiobus/event-constants"
import { NOTE_ON, NOTE_OFF } from "../../../packages/audiobus/commands"

const workers: FakeWorker[] = [],
	devices: InputAIMusic[] = []
class FakeWorker {
	onmessage?: (event: any) => void
	onerror?: () => void
	postMessage = vi.fn()
	terminate = vi.fn()
	constructor() {
		workers.push(this)
	}
	result(notes = [{ pitch: 60, start: 0, end: 4, velocity: 90, channel: 1 }], steps = 64) {
		this.onmessage?.({
			data: { kind: AI_MUSIC_RESULT, id: this.postMessage.mock.lastCall![0].id, notes, steps }
		})
	}
}
beforeEach(() => {
	workers.length = 0
	vi.stubGlobal("Worker", FakeWorker)
})
afterEach(() => {
	devices.splice(0).forEach((device) => device.destroy())
	vi.unstubAllGlobals()
})
const input = (options = {}) => {
	const device = new InputAIMusic(options)
	devices.push(device)
	return device
}
const capture = (device: InputAIMusic) => {
	const receive = vi.fn()
	device.addEventListener(INPUT_EVENT, (event) => receive((event as any).command))
	return receive
}

describe("AI music input catalogue", () => {
	it("registers all five models, preserves model identity and serializes generated phrases", async () => {
		for (const model of Object.values(AI_MODELS)) {
			expect(INPUT_DEFINITIONS[model.id]).toMatchObject({
				category: "AI",
				attribution: model.attribution
			})
			expect(INPUT_FACTORIES.find((factory) => factory.id === model.id)?.isAvailable()).toBe(
				true
			)
			const device = (await createInputById(model.id, { modelId: AI_IMPROV })) as InputAIMusic
			devices.push(device)
			expect(device.name).toBe(model.name)
			device.generate()
			workers.at(-1)!.result(undefined, model.steps)
			const definition = JSON.parse(JSON.stringify(deviceDefinition(device)))
			expect(definition.options.modelId).toBe(model.id)
			const restored = input(definition.options)
			expect(restored.options.notes).toEqual(device.options.notes)
		}
	})
	it("displays creator, source, model credits and license links for every model", async () => {
		for (const model of Object.values(AI_MODELS)) {
			const device = input({ modelId: model.id }),
				panel = await device.createGui()
			expect(await device.createGui()).toBe(panel)
			const credits = panel.querySelector(".ai-model-attribution")!
			expect(credits.textContent).toContain("The Magenta Team / Google")
			expect([...credits.querySelectorAll("a")].map((anchor) => anchor.href)).toContain(
				model.attribution.sourceUrl
			)
			expect([...credits.querySelectorAll("a")].map((anchor) => anchor.href)).toContain(
				model.attribution.licenseUrls[0]
			)
			expect(panel.textContent).toContain(`${model.sizeMB} MB`)
		}
		expect(workers).toHaveLength(0)
	})
	it("rejects malformed primers and generated MIDI", () => {
		expect(parseAIPrimer("36, 42 38")).toEqual([36, 42, 38])
		for (const value of ["", "128", "60.1", "C4", Array(33).fill(60).join(",")]) {
			expect(() => parseAIPrimer(value)).toThrow()
		}
		const device = input({ primer: "invalid" })
		device.generate()
		expect(workers).toHaveLength(0)
		expect(device.status).toContain("MIDI notes")
		for (const note of [
			{ pitch: 128 },
			{ start: -1 },
			{ end: 65 },
			{ channel: 17 },
			{ velocity: 0 }
		]) {
			expect(() =>
				validateMusicNotes(
					[{ pitch: 60, start: 0, end: 4, velocity: 100, channel: 1, ...note }],
					64
				)
			).toThrow()
		}
	})
	it("restores an input saved before its first generation", () => {
		const fresh = input(),
			restored = input(JSON.parse(JSON.stringify(fresh.options)))
		expect(restored.options.notes).toEqual([])
		expect(workers).toHaveLength(0)
	})
})

describe("AI music generation lifecycle and transport", () => {
	it("passes chord and drum primers to the worker and persists generation changes", () => {
		const device = input({ chords: "Dm, G C", temperature: 0.5 }),
			changed = vi.fn()
		device.addEventListener(EVENT_CONFIGURATION_CHANGED, changed)
		device.generate()
		expect(workers[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				modelId: AI_IMPROV,
				chords: ["Dm", "G", "C"],
				temperature: 0.5
			})
		)
		workers[0].result()
		expect(changed).toHaveBeenCalledOnce()
		expect(workers[0].terminate).toHaveBeenCalled()
		const drums = input({ modelId: AI_DRUMS })
		drums.generate()
		expect(workers[1].postMessage.mock.lastCall![0].seed).toEqual([36, 42, 38, 42])
	})
	it("ignores stale results after regeneration, stopping, disconnecting and removal", async () => {
		const device = input()
		device.generate()
		const old = workers[0]
		device.generate()
		old.result()
		expect(device.options.notes).toEqual([])
		device.stop()
		workers[1].result()
		expect(device.options.notes).toEqual([])
		device.generate()
		await device.disconnect()
		workers[2].result()
		expect(device.options.notes).toEqual([])
		device.destroy()
		device.generate()
		expect(workers).toHaveLength(3)
	})
	it("preserves saved notes on failure, rejects malformed output and allows retry", () => {
		const device = input()
		device.generate()
		workers[0].result()
		const saved = device.options.notes
		device.generate()
		workers[1].onmessage!({
			data: {
				kind: AI_MUSIC_ERROR,
				id: workers[1].postMessage.mock.lastCall![0].id,
				error: "Download blocked"
			}
		})
		expect(device.status).toContain("Download blocked")
		expect(device.options.notes).toBe(saved)
		device.generate()
		workers[2].result([{ pitch: 128, start: 0, end: 4, velocity: 100, channel: 1 }])
		expect(device.status).toContain("invalid")
		expect(device.options.notes).toBe(saved)
		device.generate()
		workers[3].onerror!()
		expect(device.status).toContain("failed to load")
	})
	it("plays on transport, follows tempo changes, loops and releases on stop", () => {
		let bpm = 120
		const device = input({ getBpm: () => bpm }),
			receive = capture(device)
		device.generate()
		workers[0].result()
		device.updateTime(10)
		expect(receive).not.toHaveBeenCalled()
		device.startClock()
		device.updateTime(10)
		expect(receive).toHaveBeenLastCalledWith(
			expect.objectContaining({ type: NOTE_ON, number: 60 })
		)
		device.updateTime(10.25)
		bpm = 60
		device.updateTime(10.75)
		expect(receive).toHaveBeenLastCalledWith(
			expect.objectContaining({ type: NOTE_OFF, number: 60 })
		)
		device.updateTime(25.75)
		expect(receive).toHaveBeenLastCalledWith(
			expect.objectContaining({ type: NOTE_ON, number: 60 })
		)
		device.stopClock()
		expect(receive).toHaveBeenLastCalledWith(
			expect.objectContaining({ type: NOTE_OFF, number: 60 })
		)
	})
	it("routes trio notes separately and skips expired notes after a stalled tab", () => {
		const device = input({ modelId: AI_TRIO }),
			receive = capture(device)
		device.generate()
		workers[0].result([
			{ pitch: 60, start: 0, end: 4, velocity: 90, channel: 1 },
			{ pitch: 40, start: 0, end: 8, velocity: 90, channel: 2 },
			{ pitch: 36, start: 4, end: 5, velocity: 100, channel: 10 }
		])
		device.startClock()
		device.updateTime(0)
		expect(receive.mock.calls.map(([command]) => command.channel)).toEqual([1, 2])
		device.updateTime(1.25)
		expect(receive.mock.calls.filter(([command]) => command.type === NOTE_ON)).toHaveLength(2)
		expect(receive.mock.calls.filter(([command]) => command.type === NOTE_OFF)).toHaveLength(2)
	})
	it("does not release a held pitch when an overlapping expired note was skipped", () => {
		const device = input(),
			receive = capture(device)
		device.generate()
		workers[0].result([
			{ pitch: 60, start: 0, end: 8, velocity: 90, channel: 1 },
			{ pitch: 60, start: 4, end: 5, velocity: 90, channel: 1 }
		])
		device.startClock()
		device.updateTime(0)
		device.updateTime(0.75)
		expect(receive).toHaveBeenCalledTimes(1)
		device.updateTime(1)
		expect(receive).toHaveBeenLastCalledWith(
			expect.objectContaining({ type: NOTE_OFF, number: 60 })
		)
	})
})