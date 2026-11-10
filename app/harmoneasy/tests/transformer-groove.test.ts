// @vitest-environment happy-dom
import { describe, expect, it } from "vitest"
import type { Timer } from "netronome"
import {
	TransformerGroove,
	ID_GROOVE
} from "../../../packages/audiobus/io/transformers/transformer-groove"
import { tranformerFactory } from "../../../packages/audiobus/io/transformer-factory"
import { createAudioCommand } from "../../../packages/audiobus/audio-command-factory"
import { NOTE_ON, NOTE_OFF, CONTROL_CHANGE } from "../../../packages/audiobus/commands"
import IOChain from "../../../packages/audiobus/io/IO-chain"

const clock = (now: number, BPM = 120, startTime = 0) => ({ now, BPM, startTime }) as Timer
const note = (type: string, at: number, from = "keyboard", channel = 1) =>
	Object.assign(createAudioCommand(type, 60, at), { from, channel })

describe("Groove Transformer", () => {
	it("scales groove amount and leaves ordinary controllers untouched", () => {
		const effect = new TransformerGroove({ amount: 50 })
		const controller = { ...note(CONTROL_CHANGE, 0.25), number: 1, value: 90 }
		expect(effect.transform([controller, note(NOTE_ON, 0.25)], clock(0.25))).toEqual([
			controller
		])
		expect(effect.tick(0.3125, clock(0.3125))[0].startAt).toBe(0.3125)
	})
	it.each([
		["swing", 0.25, 0.375],
		["shuffle", 0.25, 1 / 3],
		["sine", 0.25, 0.25 + 0.25 / Math.PI],
		["triangle", 0.125, 0.1875]
	])("applies the %s timing function", (fn, at, expected) => {
		const effect = new TransformerGroove({ function: fn, amount: 100 })
		const input = note(NOTE_ON, at)
		expect(effect.transform([input], clock(at))).toEqual([])
		expect(effect.tick(expected - 0.00001, clock(expected - 0.00001))).toEqual([])
		const output = effect.tick(expected + 0.00001, clock(expected + 0.00001))
		expect(output).toHaveLength(1)
		expect(output[0].startAt).toBeCloseTo(expected)
		expect(input.startAt).toBe(at)
	})

	it("preserves a short tap and its duration across configuration and tempo changes", () => {
		const effect = new TransformerGroove({ amount: 100 })
		expect(effect.transform([note(NOTE_ON, 0.25)], clock(0.25))).toEqual([])
		effect.setConfig("amount", 0)
		expect(effect.transform([note(NOTE_OFF, 0.26)], clock(0.26, 60))).toEqual([])
		expect(effect.tick(0.375, clock(0.375))[0]).toMatchObject({ type: NOTE_ON, startAt: 0.375 })
		expect(effect.tick(0.385, clock(0.385))[0]).toMatchObject({
			type: NOTE_OFF,
			startAt: 0.385
		})
		expect(effect.tick(2, clock(2))).toEqual([])
	})

	it("uses tempo, subdivision and transport origin, while leaving beat boundaries straight", () => {
		const effect = new TransformerGroove({
			function: "shuffle",
			amount: 100,
			subdivision: "1/16"
		})
		expect(effect.transform([note(NOTE_ON, 10)], clock(10, 60, 10))[0].startAt).toBe(10)
		expect(effect.transform([note(NOTE_ON, 10.25)], clock(10.25, 60, 10))).toEqual([])
		expect(effect.tick(10.334, clock(10.334))[0].startAt).toBeCloseTo(10 + 1 / 3)
	})

	it("matches overlapping notes independently by source and channel, including velocity-zero releases", () => {
		const effect = new TransformerGroove({ amount: 100 })
		effect.transform(
			[
				note(NOTE_ON, 0.25),
				note(NOTE_ON, 0.3),
				note(NOTE_ON, 0.25, "other"),
				note(NOTE_ON, 0.25, "keyboard", 2)
			],
			clock(0.3)
		)
		effect.transform(
			[
				{ ...note(NOTE_ON, 0.31), velocity: 0 },
				note(NOTE_OFF, 0.32),
				note(NOTE_OFF, 0.33, "other"),
				note(NOTE_OFF, 0.34, "keyboard", 2)
			],
			clock(0.34)
		)
		const output = effect.tick(1, clock(1))
		expect(output.filter((command) => command.type === NOTE_ON)).toHaveLength(4)
		const releases = output.filter((command) => command.type === NOTE_OFF)
		expect(releases.map((command) => command.startAt)).toEqual([0.42, 0.435, 0.455, 0.465])
	})

	it("passes controllers through and cancels only the panic route's pending notes", () => {
		const effect = new TransformerGroove({ amount: 100 })
		effect.transform([note(NOTE_ON, 0.25), note(NOTE_ON, 0.25, "other")], clock(0.25))
		const panic = { ...note(CONTROL_CHANGE, 0.26), number: 123, value: 0 }
		expect(effect.transform([panic], clock(0.26))).toEqual([panic])
		expect(effect.tick(1, clock(1))).toEqual([
			expect.objectContaining({ from: "other", type: NOTE_ON })
		])
	})

	it.each(["reset", "destroy", "disable"])("cancels unheard notes on %s", (action) => {
		const effect = new TransformerGroove({ amount: 100 })
		effect.transform([note(NOTE_ON, 0.25)], clock(0.25))
		if (action === "disable") {
			effect.setConfig("enabled", false)
		} else if (action === "reset") {
			effect.reset()
		} else {
			effect.destroy()
		}
		expect(effect.tick(1, clock(1))).toEqual([])
	})

	it("releases sounding notes when disabled and accepts validated UI values", () => {
		const effect = new TransformerGroove()
		effect.setConfig("amount", "0")
		expect(effect.transform([note(NOTE_ON, 0.25)], clock(0.25))).toHaveLength(1)
		effect.setConfig("enabled", "0")
		expect(effect.tick(0.3, clock(0.3))[0]).toMatchObject({ type: NOTE_OFF })
		expect(effect.transform([note(NOTE_ON, 0.4)], clock(0.4))).toHaveLength(1)
		effect.setConfig("amount", "200")
		effect.setConfig("function", "invalid")
		expect(effect.options).toMatchObject({ amount: 100, function: "swing" })
	})

	it("is restored by the factory and emits delayed live input from the IO chain clock", async () => {
		const timer = clock(0.25)
		const chain = new IOChain(timer)
		try {
			const effect = tranformerFactory(ID_GROOVE, { function: "shuffle", amount: 100 })
			expect(effect).toBeInstanceOf(TransformerGroove)
			const saved = JSON.parse(effect.exportConfig())
			expect(tranformerFactory(saved.type, saved).options).toMatchObject({
				function: "shuffle",
				amount: 100
			})
			chain.setTransformers([effect])
			await chain.addCommandToQueue(note(NOTE_ON, 0.25))
			expect(chain.updateTimeForCommandQueue(0.25, 0, {})).toEqual([])
			expect(chain.updateTimeForCommandQueue(0.334, 0, {})).toEqual([
				expect.objectContaining({ type: NOTE_ON })
			])
		} finally {
			chain.destroy()
		}
	})
})