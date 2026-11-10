import { test, expect } from "vitest"
import { readFileSync } from "fs"
import {
	createSamplerLayer,
	normaliseSamplerLayer,
	samplerVelocityGain
} from "../../../packages/audiobus/io/outputs/sampler/sampler-state.js"

const source = readFileSync(
	"../../packages/audiobus/io/outputs/sampler/layered-sampler.worklet.js",
	"utf8"
)
const fixture = () => {
	const clock = { time: 0 }
	const Processor = new Function(
		"samplerVelocityGain",
		"AudioWorkletProcessor",
		"sampleRate",
		"clock",
		source
			.replace(/^import .*$/gm, "")
			.replace(/\bcurrentTime\b/g, "clock.time")
			.replace(/registerProcessor\([^\n]+/, "return LayeredSamplerProcessor")
	)(
		samplerVelocityGain,
		class {
			port = {}
		},
		48000,
		clock
	)
	const processor = new Processor(),
		outputs = Array.from({ length: 17 }, () => [new Float32Array(128), new Float32Array(128)])
	const send = (data) => processor.port.onmessage({ data })
	const layer = (changes = {}, key = 60, index = 0) =>
		send({
			type: "layer",
			key,
			index,
			layer: {
				...createSamplerLayer(),
				attack: 0,
				decay: 0,
				sustain: 1,
				filter: "off",
				sampleRate: 48000,
				channels: [new Float32Array(1024).fill(1)],
				...changes
			}
		})
	return { processor, outputs, clock, send, layer, render: () => processor.process([], outputs) }
}

test("sample-accurate scheduling routes stereo to only its assigned part", () => {
	const { layer, send, render, outputs } = fixture()
	layer({ channels: [new Float32Array(1024).fill(0.5), new Float32Array(1024).fill(-0.25)] })
	send({ type: "on", part: 3, note: 60, velocity: 1, time: 73 / 48000 })
	render()
	expect(outputs[3][0].slice(0, 73).every((x) => x === 0)).toBe(true)
	expect(outputs[3][0][73]).toBe(0.5)
	expect(outputs[3][1][73]).toBe(-0.25)
	expect(outputs[0][0].every((x) => x === 0)).toBe(true)
})

test("trim bounds stop playback and loops stay inside the loop region", () => {
	const { layer, send, render, outputs, processor } = fixture()
	layer({
		start: 0.25,
		end: 0.5,
		channels: [Float32Array.from({ length: 16 }, (_, i) => i / 16)]
	})
	send({ type: "on", part: 0, note: 60, velocity: 1 })
	render()
	expect(outputs[0][0].slice(0, 5)).toEqual(new Float32Array([0.25, 0.3125, 0.375, 0.4375, 0]))
	layer({
		loop: true,
		loopStart: 0.25,
		loopEnd: 0.5,
		channels: [Float32Array.from({ length: 16 }, (_, i) => i / 16)]
	})
	send({ type: "on", part: 0, note: 60, velocity: 1 })
	render()
	expect(outputs[0][0].slice(4, 12)).toEqual(
		new Float32Array([0.25, 0.3125, 0.375, 0.4375, 0.25, 0.3125, 0.375, 0.4375])
	)
	expect(processor.voices).toHaveLength(1)
})

test("four layers stack with velocity crossfades and source-rate pitch conversion", () => {
	const { layer, send, render, outputs, processor } = fixture()
	for (let i = 0; i < 4; i++) {
		layer(
			{ velocityLow: 0, fadeIn: 0.5, fadeOut: 0.5, velocityHigh: 1, sampleRate: 24000 },
			60,
			i
		)
	}
	send({ type: "on", part: 0, note: 72, velocity: 0.25 })
	render()
	expect(processor.voices).toHaveLength(4)
	expect(outputs[0][0][0]).toBeCloseTo(0.5)
	expect(processor.voices[0].position).toBe(128)
})

test("release fades from current envelope level, one shots ignore note off", () => {
	const { layer, send, render, outputs, clock, processor } = fixture()
	layer({ loop: true, release: 4 / 48000 })
	send({ type: "on", part: 0, note: 60, velocity: 1 })
	render()
	clock.time = 128 / 48000
	send({ type: "off", part: 0, note: 60 })
	render()
	expect(outputs[0][0].slice(0, 5)).toEqual(new Float32Array([1, 0.75, 0.5, 0.25, 0]))
	expect(processor.voices).toHaveLength(0)
	layer({ oneShot: true })
	send({ type: "on", part: 0, note: 60, velocity: 1 })
	send({ type: "off", part: 0, note: 60 })
	render()
	expect(outputs[0][0][127]).toBe(1)
})

test("mapped keys override nearest transposition and bend updates held voices", () => {
	const { layer, send, render, processor } = fixture()
	layer({ loop: true })
	layer({ root: 72, loop: true }, 72)
	send({ type: "on", part: 0, note: 72, velocity: 1 })
	send({ type: "bend", part: 0, value: 12 })
	render()
	expect(processor.voices[0].layer.root).toBe(72)
	expect(processor.voices[0].position).toBe(256)
})

test("panic cancels scheduled notes for its own part and detach resets bend", () => {
	const { layer, send, render, processor, clock } = fixture()
	layer({ loop: true })
	for (const part of [0, 1]) {
		send({ type: "on", part, note: 60, velocity: 1, time: 1 })
	}
	send({ type: "bend", part: 0, value: 12 })
	render()
	send({ type: "detach", part: 0 })
	clock.time = 1
	render()
	expect(processor.voices.map((v) => v.part)).toEqual([1])
	expect(processor.bends.has(0)).toBe(false)
	send({ type: "destroy" })
	expect(render()).toBe(false)
})

test.each(["lowpass", "highpass", "bandpass"])(
	"%s filter stays finite at maximum resonance",
	(filter) => {
		const { layer, send, render, outputs } = fixture()
		layer({
			filter,
			resonance: 20,
			cutoff: 20000,
			channels: [Float32Array.from({ length: 1024 }, (_, i) => (i % 2 ? 1 : -1))]
		})
		send({ type: "on", part: 0, note: 60, velocity: 1 })
		render()
		expect(outputs[0][0].every(Number.isFinite)).toBe(true)
		expect(outputs[0][0].some((x) => Math.abs(x) > 0)).toBe(true)
	}
)

test("invalid edit values produce ordered safe trim, loop and fade bounds", () => {
	const l = normaliseSamplerLayer({
		start: 0.9,
		end: 0.1,
		loopStart: 1,
		loopEnd: 0,
		velocityLow: 0.8,
		fadeIn: 0.1,
		fadeOut: 0,
		velocityHigh: 0.2,
		cutoff: NaN
	})
	expect(l.start).toBeLessThan(l.end)
	expect(l.loopStart).toBeGreaterThanOrEqual(l.start)
	expect(l.loopEnd).toBeGreaterThan(l.loopStart)
	expect(l.loopEnd).toBeLessThanOrEqual(l.end)
	expect(l.fadeIn).toBeGreaterThanOrEqual(l.velocityLow)
	expect(l.fadeOut).toBeLessThanOrEqual(l.velocityHigh)
	expect(l.cutoff).toBe(18000)
})