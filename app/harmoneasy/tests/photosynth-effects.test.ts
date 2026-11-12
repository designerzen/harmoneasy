// @vitest-environment happy-dom
import { expect, it, vi } from "vitest"
import { EFFECT_REGISTRY } from "../../../packages/audiobus/effects/effect-registry"
import { saturatorCurve } from "../../../packages/audiobus/effects/effect-saturator"
import type EffectChannelStrip from "../../../packages/audiobus/effects/effect-channel-strip"

const PARAMS = [
	"gain",
	"delayTime",
	"frequency",
	"detune",
	"Q",
	"pan",
	"threshold",
	"ratio",
	"knee",
	"attack",
	"release"
]

function audio() {
	const nodes: any[] = []
	const param = () => ({
		value: 0,
		setTargetAtTime: vi.fn(function (this: any, value: number) {
			this.value = value
		})
	})
	const node = (kind: string) => {
		const result: any = {
			kind,
			targets: new Set(),
			connect(target: any) {
				result.targets.add(target)
				return target
			},
			disconnect: vi.fn(),
			start: vi.fn(),
			stop: vi.fn()
		}
		PARAMS.forEach((name) => (result[name] = param()))
		nodes.push(result)
		return result
	}
	const base: any = {
		currentTime: 0,
		sampleRate: 48000,
		createBuffer: () => ({ getChannelData: () => new Float32Array(1000) })
	}
	const context = new Proxy(base, {
		get: (target, key) =>
			key in target
				? target[key]
				: typeof key === "string" && key.startsWith("create")
					? () => node(key.slice(6))
					: undefined
	})
	return { context, nodes }
}

const create = async (id: string, options: Record<string, any> = {}) => {
	const { context, nodes } = audio()
	const effect = await EFFECT_REGISTRY.find((entry) => entry.id === id)!.create(
		context as any,
		options
	)
	return { effect, nodes, kinds: (kind: string) => nodes.filter((node) => node.kind === kind) }
}

it("registers the new effects, with the strip and the bus last", () => {
	const ids = EFFECT_REGISTRY.map((entry) => entry.id)
	for (const id of ["dub-delay", "snare-reverb", "saturator", "expression"]) {
		expect(ids).toContain(id)
	}
	expect(ids.slice(-2)).toEqual(["channel-strip", "drum-bus"])
	expect(EFFECT_REGISTRY.find((entry) => entry.id === "channel-strip")).toMatchObject({
		name: "Channel Strip",
		mix: false
	})
})

it("keeps the dub delay's loop stable and slows its time changes", async () => {
	const { effect, kinds } = await create("dub-delay", { feedback: 5 })
	expect(effect.getParameter("feedback")).toBe(0.85)
	expect(effect.getParameter("mix")).toBe(0.4)
	const [delay] = kinds("Delay")
	effect.setParameter("time", 1)
	expect(delay.delayTime.setTargetAtTime).toHaveBeenCalledWith(1, 0, 0.25)
	const [filter] = kinds("BiquadFilter")
	expect(filter.targets).toContain(delay)
})

it("snare reverb keeps the dry sound and clamps its send", async () => {
	const { effect, kinds } = await create("snare-reverb", { amount: 3, lowCut: 1 })
	expect(effect.getParameter("amount")).toBe(1)
	expect(effect.getParameter("lowCut")).toBe(20)
	expect(effect.parameters.some((parameter) => parameter.id === "mix")).toBe(false)
	expect((effect.audioInput as any).targets).toContain((effect as any).wet)
	expect(kinds("Convolver")).toHaveLength(1)
	expect(kinds("BiquadFilter")[0].frequency.value).toBe(20)
})

it("saturator curve is asymmetric and stays inside full scale", () => {
	const curve = saturatorCurve()
	expect(Math.max(...curve)).toBeCloseTo(0.630035, 5)
	expect(Math.min(...curve)).toBeLessThan(-0.9)
	expect(Math.abs(curve[curve.length / 2])).toBeLessThan(0.01)
})

it("expression stays transparent at zero and deepens every stage with amount", async () => {
	const { effect, kinds } = await create("expression", { amount: 0 })
	const [filter] = kinds("BiquadFilter")
	const [compressor] = kinds("DynamicsCompressor")
	expect(compressor.ratio.value).toBe(1)
	const open = filter.frequency.value
	effect.setParameter("amount", 1)
	expect(compressor.ratio.value).toBeCloseTo(12)
	expect(compressor.threshold.value).toBeCloseTo(-48)
	expect(filter.frequency.value).toBeLessThan(open)
	effect.setParameter("compression", 0)
	expect(compressor.ratio.value).toBe(1)
	effect.setParameter("amount", 7)
	expect(effect.getParameter("amount")).toBe(1)
})

it("channel strip contains a panner, a delay and a compressor, with PhotoSYNTH defaults", async () => {
	const { effect, kinds } = await create("channel-strip")
	expect(kinds("StereoPanner")).toHaveLength(1)
	expect(kinds("Delay").length).toBeGreaterThanOrEqual(1)
	expect(kinds("DynamicsCompressor").length).toBeGreaterThanOrEqual(1)
	expect(effect.parameters.some((parameter) => parameter.id === "mix")).toBe(false)
	expect(effect.options).toMatchObject({
		delay: "off",
		delayTime: 0.14,
		delayFeedback: 0.1,
		pan: 0,
		compressor: "off",
		threshold: -24,
		ratio: 12,
		knee: 30,
		attack: 0.003,
		release: 0.25,
		expression: 0,
		trim: 1
	})
})

it("channel strip glides the panner and moves gain between bypass and compressor paths", async () => {
	const { effect, kinds } = await create("channel-strip")
	const [panner] = kinds("StereoPanner")
	effect.setParameter("pan", -2)
	expect(effect.getParameter("pan")).toBe(-1)
	expect(panner.pan.setTargetAtTime).toHaveBeenCalledWith(-1, 0, expect.any(Number))

	const [bypass, compressor] = [...panner.targets] as any[]
	expect(bypass.kind).toBe("Gain")
	expect(compressor.kind).toBe("DynamicsCompressor")
	const [compressed] = [...compressor.targets] as any[]
	expect(bypass.gain.value).toBe(1)
	expect(compressed.gain.value).toBe(0)
	effect.setParameter("compressor", "on")
	expect(bypass.gain.value).toBe(0)
	expect(compressed.gain.value).toBe(1)
	effect.setParameter("compressor", "off")
	expect(bypass.gain.value).toBe(1)
	expect(compressed.gain.value).toBe(0)
	effect.setParameter("ratio", 6)
	expect(compressor.ratio.value).toBe(6)
	for (const node of [panner, bypass, compressor, compressed]) {
		expect(node.disconnect).not.toHaveBeenCalled()
	}
})

it("channel strip echo switches by level and feedback without rewiring", async () => {
	const { effect, kinds } = await create("channel-strip", { delayLevel: 0.7, delayFeedback: 0.3 })
	const delay = kinds("Delay")[0]
	const [feedback, echo] = [...delay.targets] as any[]
	expect([feedback.gain.value, echo.gain.value]).toEqual([0, 0])
	effect.setParameter("delay", "on")
	expect([feedback.gain.value, echo.gain.value]).toEqual([0.3, 0.7])
	expect(delay.delayTime.value).toBe(0.14)
	effect.setParameter("delayTime", 0.5)
	expect(delay.delayTime.setTargetAtTime).toHaveBeenCalledWith(0.5, 0, expect.any(Number))
	effect.setParameter("delay", "off")
	expect([feedback.gain.value, echo.gain.value]).toEqual([0, 0])
	expect(delay.disconnect).not.toHaveBeenCalled()
})

it("channel strip convenience methods clamp, keep options in sync and honour a start time", async () => {
	const { effect, kinds } = await create("channel-strip")
	const strip = effect as EffectChannelStrip
	const [panner] = kinds("StereoPanner")
	strip.setPan(0.4)
	expect(strip.options.pan).toBe(0.4)
	expect(panner.pan.value).toBe(0.4)
	strip.setPan(9)
	expect(strip.options.pan).toBe(1)

	const gain = (strip as any).gain
	strip.setGain(0.5, 2)
	expect(strip.options.gain).toBe(0.5)
	expect(gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.5, 2, expect.any(Number))
	strip.setGain(-3)
	expect(strip.options.gain).toBe(0)
	expect(gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, expect.any(Number))

	const compressors = kinds("DynamicsCompressor")
	strip.setExpression(1)
	expect(strip.options.expression).toBe(1)
	// Depths default to zero, as the original's expression stages default to off.
	expect(compressors.every((node) => node.ratio.value <= 12)).toBe(true)
	strip.setParameter("expressionCompression", 1)
	expect(compressors.some((node) => node.threshold.value === -48)).toBe(true)
})

it("drum bus defaults reproduce the PhotoSYNTH percussion bus", async () => {
	const { effect, kinds } = await create("drum-bus")
	const [compressor, limiter] = kinds("DynamicsCompressor")
	expect(compressor.targets).toContain(limiter)
	expect(compressor.threshold.value).toBe(-50)
	expect(compressor.knee.value).toBe(40)
	expect(compressor.ratio.value).toBe(12)
	expect(compressor.attack.value).toBe(0)
	expect(compressor.release.value).toBe(0.25)
	expect(limiter.threshold.value).toBe(-5)
	expect(limiter.knee.value).toBe(0)
	expect(limiter.ratio.value).toBe(20)
	expect(limiter.attack.value).toBe(0.001)
	expect(limiter.release.value).toBe(0.1)
	effect.setParameter("threshold", -500)
	expect(effect.getParameter("threshold")).toBe(-100)
	expect(compressor.threshold.value).toBe(-100)
})