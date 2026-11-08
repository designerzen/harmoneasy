// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { getStructure } from "../source/components/graph/layout"
import {
	hasAudibleOutput,
	loudness,
	smoothLevel,
	watchOutputLevel
} from "../source/components/graph/audio-levels"

const chainWith = (outputs: unknown[]) =>
	({ inputs: [], transformers: [], outputs, options: {} }) as any
const device = (name: string, audio: boolean, extra = {}) => ({
	name,
	isHidden: false,
	hasAudioOutput: () => audio,
	...extra
})
const audioNode = () => {
	const analyser = {
		fftSize: 1024,
		frequencyBinCount: 512,
		connect: vi.fn(),
		disconnect: vi.fn(),
		getFloatTimeDomainData: (samples: Float32Array) => samples.fill(0.5),
		getByteFrequencyData: vi.fn()
	}
	return {
		analyser,
		context: { state: "running", createAnalyser: vi.fn(() => analyser) },
		connect: vi.fn(),
		disconnect: vi.fn()
	}
}

describe("Speaker node", () => {
	it("appears once an output has audio and connects only the audible outputs", () => {
		const synth = device("Synth", true)
		const midi = device("MIDI", false)
		expect(getStructure(chainWith([midi])).nodes.some((node) => node.type === "speaker")).toBe(
			false
		)
		const { nodes, edges } = getStructure(chainWith([synth, midi]))
		const speaker = nodes.find((node) => node.type === "speaker")!
		expect(speaker.deletable).toBe(false)
		const audio = edges.filter((edge) => edge.target === speaker.id)
		expect(audio).toHaveLength(1)
		expect(audio[0].data?.output).toBe(synth)
		expect(audio[0].deletable).toBe(false)
		expect(nodes.some((node) => node.id === audio[0].source)).toBe(true)
	})
	it.each(["horizontal", "vertical"])(
		"places surfaces and their picker beside routing in %s mode",
		(mode) => {
			const { nodes, edges } = getStructure(
				{
					...chainWith([device("Synth", true)]),
					options: { controlSurfaces: [{ id: "a", name: "A", connections: [] }] }
				},
				true,
				true,
				mode
			)
			const controls = nodes.filter((n) =>
				["controlSurface", "addControlSurface"].includes(n.type!)
			)
			const routing = nodes.filter((n) => !controls.includes(n))
			for (const control of controls) {
				for (const route of routing) {
					const axis = mode === "horizontal" ? "y" : "x"
					expect(control.position[axis]).toBeGreaterThan(route.position[axis] + 240)
				}
			}
			const speaker = nodes.find((n) => n.type === "speaker")!
			expect(edges.some((e) => e.source === speaker.id)).toBe(false)
			expect(nodes.find((n) => n.type === "addControlSurface")).toMatchObject({
				draggable: false,
				deletable: false
			})
		}
	)
	it("recognises a tappable node without a declared audio output", () => {
		expect(hasAudibleOutput({ output: audioNode() } as any)).toBe(true)
		expect(hasAudibleOutput({ output: { name: "webmidi port" } } as any)).toBe(false)
	})
})

describe("Output levels", () => {
	afterEach(() => vi.unstubAllGlobals())
	it("maps silence to zero and full scale to one", () => {
		expect(loudness(0)).toBe(0)
		expect(loudness(0.001)).toBe(0)
		expect(loudness(1)).toBe(1)
		expect(loudness(0.1)).toBeGreaterThan(0.5)
	})
	it("rises faster than it falls and settles at exactly zero", () => {
		expect(smoothLevel(0, 1, 0.033)).toBeGreaterThan(1 - smoothLevel(1, 0, 0.033))
		expect(smoothLevel(0.001, 0, 0.033)).toBe(0)
	})
	it("keeps decaying through steps too small to notify and reports reaching silence", () => {
		let frame: FrameRequestCallback | undefined
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			frame = callback
			return 1
		})
		vi.stubGlobal("cancelAnimationFrame", vi.fn())
		const node = audioNode()
		const output = device("Synth", true, { output: node }) as any
		const listener = vi.fn()
		const stop = watchOutputLevel(output, listener)
		let now = 100
		const run = (frames: number) => {
			for (let index = 0; index < frames; index++) {
				now += 40
				frame!(now)
			}
		}
		run(30)
		expect(listener.mock.lastCall![0]).toBeGreaterThan(0.5)
		node.analyser.getFloatTimeDomainData = (samples: Float32Array) => samples.fill(0)
		run(120)
		expect(listener.mock.lastCall![0]).toBe(0)
		stop()
	})
	it("shares one tap between watchers and removes it after the last one leaves", () => {
		let frame: FrameRequestCallback | undefined
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			frame = callback
			return 1
		})
		vi.stubGlobal("cancelAnimationFrame", vi.fn())
		const node = audioNode()
		const output = device("Synth", true, { output: node }) as any
		const first = vi.fn()
		const second = vi.fn()
		const stopFirst = watchOutputLevel(output, first)
		const stopSecond = watchOutputLevel(output, second)
		frame!(100)
		expect(node.context.createAnalyser).toHaveBeenCalledOnce()
		expect(node.connect).toHaveBeenCalledOnce()
		expect(first.mock.calls[0][0]).toBeGreaterThan(0)
		expect(second).toHaveBeenCalledWith(first.mock.calls[0][0])
		stopFirst()
		expect(node.disconnect).not.toHaveBeenCalled()
		stopSecond()
		expect(node.disconnect).toHaveBeenCalledOnce()
		expect(cancelAnimationFrame).toHaveBeenCalledOnce()
	})
})