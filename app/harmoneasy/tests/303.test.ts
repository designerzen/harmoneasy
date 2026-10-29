// @vitest-environment happy-dom
import { readFileSync } from "node:fs"
import { afterEach, expect, it, vi } from "vitest"
import register from "../../../packages/audiobus/instruments/303/processor.js"
import { SYNTH_303_PARAMETERS } from "../../../packages/audiobus/instruments/303/parameters"
import Output303 from "../../../packages/audiobus/io/outputs/output-303"
import { createOutputById } from "../../../packages/audiobus/io/output-factory"
import { deviceDefinition } from "../../../packages/audiobus/io/device-definition"

const bytes = readFileSync("../../packages/audiobus/instruments/303/wavetable.bin")
const wavetable = new Float32Array(
	bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
)
afterEach(() => vi.unstubAllGlobals())
function processor(rate = 48000, patch: Record<string, number> = {}) {
	let Processor: any
	vi.stubGlobal("sampleRate", rate)
	vi.stubGlobal(
		"AudioWorkletProcessor",
		class {
			port = {}
		}
	)
	vi.stubGlobal("registerProcessor", (id: string, ctor: any) => {
		expect(id).toBe("303")
		Processor = ctor
	})
	new Function(`return (${register.toString()})`)()(SYNTH_303_PARAMETERS)
	const node = new Processor({ processorOptions: { wavetable } })
	const parameters = Object.fromEntries(
		Object.entries(SYNTH_303_PARAMETERS).map(([id, config]) => [
			id,
			new Float32Array([patch[id] ?? config.defaultValue])
		])
	)
	const render = (frames = 4096) => {
		const out = new Float32Array(frames)
		for (let offset = 0; offset < frames; offset += 128) {
			const channels = [
				new Float32Array(Math.min(128, frames - offset)),
				new Float32Array(Math.min(128, frames - offset))
			]
			node.process([], [channels], parameters)
			expect(channels[0]).toEqual(channels[1])
			out.set(channels[0], offset)
		}
		return out
	}
	render(128)
	return { node, render, parameters }
}
it.each([44100, 48000, 96000])(
	"renders the original wavetable at %i Hz with finite, audible samples and working waveform selection",
	(rate) => {
		const { node, render } = processor(rate)
		expect(wavetable.length).toBe(1048576)
		node.midi([0x90, 48, 100])
		const sound = render()
		expect(sound.every((sample) => Number.isFinite(sample) && Math.abs(sample) <= 1)).toBe(true)
		expect(sound.some((sample) => Math.abs(sample) > 0.01)).toBe(true)
		expect((node.engine.oscdelta * rate) / 4096).toBeCloseTo(130.81278, 3)
		const square = processor(rate, { waveform: 1 })
		square.node.midi([0x90, 48, 100])
		expect(square.render()).not.toEqual(sound)
	}
)
it("retains slide, accent, distortion, delay and channel-aware note releases", () => {
	const { node, render } = processor(48000, {
		delayTime: 0.01,
		delaySend: 0.6,
		delayFeedback: 0.5
	})
	node.midi([0x90, 36, 127])
	render(512)
	expect(node.engine.accentgain).toBe(0.5)
	node.midi([0x91, 60, 80])
	expect(node.engine.slide).not.toBe(0)
	node.midi([0x80, 36, 0])
	expect(node.active.number).toBe(60)
	render(512)
	node.midi([0x81, 60, 0])
	expect(node.active).toBeNull()
	expect(render(2048).some((sample) => Math.abs(sample) > 0.001)).toBe(true)
	node.port.onmessage({ data: { type: "panic" } })
	expect(render().every((sample) => Math.abs(sample) < 1e-12)).toBe(true)
	node.port.onmessage({ data: { type: "destroy" } })
	expect(node.process([], [[new Float32Array(128)]], {})).toBe(false)
})
it("changes the sound when original foldback shape and threshold are adjusted", () => {
	const a = processor(48000, { threshold: 0, shape: 0 }),
		b = processor(48000, { threshold: 1, shape: 1 })
	a.node.midi([0x90, 40, 127])
	b.node.midi([0x90, 40, 127])
	expect(a.render()).not.toEqual(b.render())
})
it("registers a separate output, saves controls, and cancels notes waiting on loading after panic", async () => {
	const posted = vi.fn(),
		disconnect = vi.fn()
	const context = {
		currentTime: 0,
		createGain: () => ({ connect: vi.fn(), disconnect }),
		audioWorklet: { addModule: vi.fn(async () => {}) }
	} as unknown as AudioContext
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response(bytes))
	)
	vi.stubGlobal(
		"AudioWorkletNode",
		class {
			port = { postMessage: posted, close: vi.fn() }
			parameters = new Map()
			connect = vi.fn()
			disconnect = disconnect
		}
	)
	const output = (await createOutputById("303", {
		audioContext: context,
		volume: 0.4
	})) as Output303
	const pending = output.noteOn(48, 100)
	output.allNotesOff()
	await pending
	expect(posted).not.toHaveBeenCalledWith(expect.objectContaining({ type: "midi" }))
	await output.noteOn(60, 127)
	expect(posted).toHaveBeenLastCalledWith({ type: "midi", bytes: [0x90, 60, 127] })
	output.configure({ shape: 0.8, delaySend: 0.5 })
	expect(deviceDefinition(output)).toMatchObject({
		type: "303",
		options: { shape: 0.8, delaySend: 0.5, volume: 0.4 }
	})
	const gui = await output.createGui()
	expect(gui.querySelector('[name="threshold"]')).not.toBeNull()
	expect(gui.querySelector('[name="delayTime"]')).not.toBeNull()
	output.destroy()
	expect(disconnect).toHaveBeenCalled()
})