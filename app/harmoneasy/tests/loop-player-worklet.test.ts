import { runInNewContext } from "node:vm"
import { describe, expect, it } from "vitest"
import { LOOP_PLAYER_WORKLET_CODE } from "../../../packages/audiobus/io/outputs/loop-player-worklet"

function worklet(sourceRate = 8000, duration = 0.25, rate = 8000) {
	let Processor: any
	const globals = {
		sampleRate: rate,
		currentTime: 0,
		AudioWorkletProcessor: class {
			port = { onmessage: (_event: any) => {} }
		},
		registerProcessor: (_name: string, value: any) => {
			Processor = value
		}
	}
	runInNewContext(LOOP_PLAYER_WORKLET_CODE, globals)
	const processor = new Processor()
	const send = (data: any) => processor.port.onmessage({ data })
	const channel = Float32Array.from(
		{ length: sourceRate * duration },
		(_, i) => 0.5 * Math.sin((2 * Math.PI * 220 * i) / sourceRate)
	)
	send({
		type: "buffer",
		channels: [channel, Float32Array.from(channel, (value) => -value)],
		sampleRate: sourceRate
	})
	let frames = 0
	const render = (count: number) => {
		const result = [new Float32Array(count), new Float32Array(count)]
		for (let offset = 0; offset < count; offset += 128) {
			const block = result.map((channel) =>
				channel.subarray(offset, Math.min(count, offset + 128))
			)
			globals.currentTime = frames / rate
			expect(processor.process([], [block])).toBe(true)
			frames += block[0].length
		}
		return result
	}
	return { processor, send, render, rate }
}

describe("Loop Player WSOLA processor", () => {
	it.each([0.5, 1, 2])(
		"consumes source at ratio %s, loops and preserves stereo and pitch",
		(ratio) => {
			const { processor, send, render, rate } = worklet()
			send({ type: "sync", at: 0, position: 0, ratio })
			const [left, right] = render(rate * 2)
			expect(processor.active.position / rate).toBeCloseTo(2 * ratio, 8)
			expect(processor.active.position).toBeGreaterThan(processor.length)
			let crossings = 0
			for (let frame = 0; frame < left.length; frame++) {
				expect(Number.isFinite(left[frame])).toBe(true)
				expect(Math.abs(left[frame])).toBeLessThanOrEqual(0.50001)
				expect(right[frame]).toBeCloseTo(-left[frame], 6)
				if (frame > rate && left[frame - 1] <= 0 && left[frame] > 0) {
					crossings++
				}
			}
			expect(crossings).toBeGreaterThan(205)
			expect(crossings).toBeLessThan(235)
			expect(left.slice(-rate).some((value) => Math.abs(value) > 0.1)).toBe(true)
		}
	)
	it("accounts for differing source and context sample rates", () => {
		const { processor, send, render, rate } = worklet(16000)
		send({ type: "sync", at: 0, position: 0.1, ratio: 0.5 })
		render(rate)
		expect(processor.active.position / 16000).toBeCloseTo(0.6, 8)
	})
	it("includes an exact overlap candidate at 44.1 kHz so unity speed preserves arbitrary material", () => {
		const { send, render, rate } = worklet(44100, 0.25, 44100)
		const source = Float32Array.from(
			{ length: rate / 4 },
			(_, i) => Math.sin(i * i * 0.13) * 0.5
		)
		send({ type: "buffer", channels: [source], sampleRate: rate })
		send({ type: "sync", at: 0, position: 0, ratio: 1 })
		const output = render(6000)[0]
		for (let frame = 300; frame < output.length; frame++) {
			expect(output[frame]).toBeCloseTo(source[frame], 6)
		}
	})
	it("starts at the scheduled sample, crossfades resyncs and clears queued events on stop", () => {
		const { processor, send, render, rate } = worklet()
		send({ type: "sync", at: 0.1, position: 0.03, ratio: 1 })
		expect(render(800)[0].every((value) => value === 0)).toBe(true)
		const first = render(400)[0]
		expect(first.some((value) => Math.abs(value) > 0.1)).toBe(true)
		send({ type: "sync", at: 0.15, position: 0.1, ratio: 0.5 })
		const next = render(400)[0]
		expect(Math.abs(next[0] - first.at(-1)!)).toBeLessThan(0.1)
		expect(processor.active.position / rate).toBeCloseTo(0.125, 8)
		send({ type: "sync", at: 1, position: 0, ratio: 2 })
		send({ type: "stop" })
		expect(processor.events).toHaveLength(0)
		expect(render(rate)[0].every((value) => value === 0)).toBe(true)
		send({ type: "sync", at: 1.2, position: 0.125, ratio: 1 })
		render(400)
		expect(processor.active.position / rate).toBeCloseTo(0.175, 8)
	})
	it("follows a tempo change in place when still in phase instead of crossfading", () => {
		const { processor, send, render } = worklet()
		send({ type: "sync", at: 0, position: 0, ratio: 1 })
		render(1200)
		const active = processor.active
		// Exactly where the playhead already is, so only the ratio changes
		send({ type: "sync", at: 0.2, position: 0.2, ratio: 2 })
		render(500)
		expect(processor.active).toBe(active)
		expect(processor.previous).toBeNull()
		expect(processor.active.ratio).toBe(2)
	})
	it("fades out at a scheduled stop, dropping syncs queued after it but keeping later ones", () => {
		const { processor, send, render, rate } = worklet()
		send({ type: "sync", at: 0, position: 0, ratio: 1 })
		send({ type: "sync", at: 0.5, position: 0.5, ratio: 1 })
		render(800)
		send({ type: "stop", at: 0.2 })
		expect(processor.events.map((event: any) => event.at)).toEqual([0.2])
		send({ type: "sync", at: 0.3, position: 0, ratio: 1 })
		// Rendered from 0.1 s: sounds until the stop at 0.2 s, silent until the resume at 0.3 s
		const [left] = render(rate * 0.3)
		expect(left.subarray(0, rate * 0.1).some((value) => Math.abs(value) > 0.1)).toBe(true)
		expect(left.subarray(rate * 0.1 + 8, rate * 0.2 - 8).every((value) => value === 0)).toBe(
			true
		)
		expect(left.subarray(rate * 0.2 + 8).some((value) => Math.abs(value) > 0.1)).toBe(true)
	})
	it("handles silence and tiny mono loops without nonfinite correlation or output", () => {
		const { send, render } = worklet()
		send({ type: "buffer", channels: [new Float32Array(8)], sampleRate: 8000 })
		send({ type: "sync", at: 0, position: 1, ratio: 4 })
		expect(render(1000).every((channel) => channel.every((value) => value === 0))).toBe(true)
	})
	it("releases its source and stops processing when disposed", () => {
		const { processor, send } = worklet()
		send({ type: "dispose" })
		expect(processor.channels).toHaveLength(0)
		expect(processor.process([], [[new Float32Array(128)]])).toBe(false)
	})
})