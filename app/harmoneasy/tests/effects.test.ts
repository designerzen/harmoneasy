// @vitest-environment happy-dom
import { expect, it, vi } from "vitest"
import { EFFECT_REGISTRY } from "../../../packages/audiobus/effects/effect-registry"
import { bitcrusherCurve } from "../../../packages/audiobus/effects/effect-bitcrusher"
import { distortionCurve } from "../../../packages/audiobus/effects/effect-distortion"
import { OUTPUT_DEFINITIONS } from "../../../packages/audiobus/io/output-definitions"
import {
	EVENT_CHANGE,
	EVENT_CONFIGURATION_CHANGED
} from "../../../packages/audiobus/events/event-constants"

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
			stop: vi.fn(),
			setPeriodicWave: vi.fn()
		}
		PARAMS.forEach((name) => (result[name] = param()))
		nodes.push(result)
		return result
	}
	const base: any = {
		currentTime: 0,
		sampleRate: 100,
		createBuffer: () => ({ getChannelData: () => new Float32Array(1000) }),
		createPeriodicWave: () => ({})
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

it("offers every classic effect as an audio processor Output with its own ID", () => {
	expect(EFFECT_REGISTRY.length).toBeGreaterThanOrEqual(20)
	for (const effect of EFFECT_REGISTRY) {
		const id = effect.id === "impulse-response" ? "impulse-response" : `effect:${effect.id}`
		expect(OUTPUT_DEFINITIONS[id]).toMatchObject({
			name: effect.name,
			type: "audio",
			subtype: "effect"
		})
	}
})

it("builds each effect from native nodes with a control for every parameter, and tears it down", async () => {
	for (const entry of EFFECT_REGISTRY) {
		const { context, nodes } = audio()
		const effect = await entry.create(context as any)
		expect(effect.audioInput).toBeDefined()
		expect(effect.output).toBeDefined()
		expect(effect.type).toBe(entry.id)
		for (const parameter of effect.parameters) {
			expect(effect.getParameter(parameter.id)).toBe(parameter.initial)
		}
		expect(effect.parameters.some((parameter) => parameter.id === "mix")).toBe(
			entry.mix !== false
		)
		const panel = await effect.createGui()
		const controls = panel.querySelectorAll("input[type=number], select")
		expect(controls.length, entry.id).toBe(
			effect.parameters.length + (entry.id === "impulse-response" ? 1 : 0)
		)
		await effect.destroy()
		for (const node of nodes) {
			expect(node.disconnect, `${entry.id} ${node.kind}`).toHaveBeenCalled()
			if (node.kind === "Oscillator") {
				expect(node.start).toHaveBeenCalled()
				expect(node.stop).toHaveBeenCalled()
			}
		}
	}
})

it("restores saved values, clamps out-of-range values and rejects unknown choices", async () => {
	const delay = EFFECT_REGISTRY.find((entry) => entry.id === "delay")!
	const { context } = audio()
	const effect = await delay.create(context as any, { time: 99, feedback: 0.5, mix: 0.2 })
	expect(effect.options).toEqual({ time: 2, feedback: 0.5, tone: 6000, mix: 0.2 })
	const filter = EFFECT_REGISTRY.find((entry) => entry.id === "filter")!
	const restored = await filter.create(context as any, { filterType: "bogus", frequency: 440 })
	expect(restored.getParameter("filterType")).toBe("lowpass")
	expect(restored.getParameter("frequency")).toBe(440)
})

it("glides parameter changes and saves them when edited in the GUI", async () => {
	const { context, nodes } = audio()
	const effect = await EFFECT_REGISTRY.find((entry) => entry.id === "delay")!.create(
		context as any
	)
	const delay = nodes.find((node) => node.kind === "Delay")
	effect.setParameter("time", 1)
	expect(delay.delayTime.setTargetAtTime).toHaveBeenCalledWith(1, 0, expect.any(Number))
	const tremolo = await EFFECT_REGISTRY.find((entry) => entry.id === "tremolo")!.create(
		context as any
	)
	const saved = vi.fn()
	tremolo.addEventListener(EVENT_CONFIGURATION_CHANGED, saved)
	const select = (await tremolo.createGui()).querySelector("select")!
	select.value = "square"
	select.dispatchEvent(new Event(EVENT_CHANGE))
	expect(tremolo.options.waveform).toBe("square")
	expect(saved).toHaveBeenCalledTimes(1)
})

it("shapes distortion and quantisation curves within full scale", () => {
	for (const character of ["soft", "hard", "fuzz", "fold"]) {
		const curve = distortionCurve(character, 50)
		expect(Math.max(...curve)).toBeLessThanOrEqual(1)
		expect(Math.min(...curve)).toBeGreaterThanOrEqual(-1)
		expect(curve[curve.length / 2 - 1]).toBeCloseTo(0, 2)
	}
	expect(new Set(bitcrusherCurve(2))).toEqual(new Set([-1, -0.5, 0, 0.5, 1]))
})