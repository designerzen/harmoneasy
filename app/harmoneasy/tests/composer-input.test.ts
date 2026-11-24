// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import InputComposer from "../../../packages/audiobus/io/inputs/input-composer"
import { createInputById } from "../../../packages/audiobus/io/input-factory"
import { INPUT_EVENT } from "../../../packages/audiobus/events/event-constants"
import { NOTE_OFF, NOTE_ON } from "../../../packages/audiobus/commands/commands"

const inputs: InputComposer[] = []
afterEach(() => {
	inputs.splice(0).forEach((input) => input.destroy())
})

async function setup(bpm = 120) {
	const input = new InputComposer({
		now: () => 0,
		getBpm: () => bpm,
		composer: { seed: "graph" }
	})
	inputs.push(input)
	const received: any[] = []
	input.addEventListener(INPUT_EVENT, (event) => received.push((event as any).command))
	await input.createGui()
	return { input, received }
}

describe("Composer input", () => {
	it("is created by the input factory", async () => {
		const input = await createInputById("composer", {})
		inputs.push(input as InputComposer)
		expect(input.name).toBe("Composer")
	})

	it("plays notes only as the shared transport advances, and releases them on stop", async () => {
		const { input, received } = await setup()
		input.startClock()
		await vi.waitFor(() => expect(received.length).toBeGreaterThan(0))
		const before = received.length
		input.updateTime(10)
		input.updateTime(10.5)
		expect(received.length).toBeGreaterThan(before)
		expect(received.some((command) => command.type === NOTE_ON)).toBe(true)
		input.stopClock()
		const held = received.filter((c) => c.type === NOTE_ON).length
		expect(received.filter((c) => c.type === NOTE_OFF).length).toBe(held)
		const after = received.length
		input.updateTime(20)
		expect(received.length).toBe(after)
	})

	it("follows the host tempo and persists the composer's selections", async () => {
		const { input } = await setup(90)
		input.startClock()
		input.updateTime(1)
		input.updateTime(1.1)
		expect(input.options.composer.tempo).toBe(90)
		expect(input.options.composer.seed).toBe("graph")
	})
})