// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ControlSurface } from "../../../packages/control-surface/src/surface"
import { GpuSurfaceRenderer } from "../../../packages/control-surface/src/renderer"
import { withEnvelopeBindings } from "../../../packages/control-surface/src/envelope-bindings"
import { envelopeGeometry } from "../../../packages/control-surface/src/envelope"
import { bindingKey, validSurfaces } from "../../../packages/control-surface/src/model"
import { featuredBindings } from "../../../packages/control-surface/src/curate"
import type { ControlBinding } from "../../../packages/control-surface/src/types"

let surface: ControlSurface | undefined
beforeEach(() => {
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn(() => 1)
	)
	vi.stubGlobal("cancelAnimationFrame", vi.fn())
	vi.stubGlobal(
		"IntersectionObserver",
		class {
			observe() {}
			disconnect() {}
		}
	)
	vi.spyOn(GpuSurfaceRenderer, "create").mockRejectedValue(new Error("Test fallback"))
})
afterEach(() => {
	surface?.destroy()
	surface = undefined
	document.body.replaceChildren()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

function controls(prefix = "", milliseconds = false): ControlBinding[] {
	return ["attack", "decay", "sustain", "release"].map((stage, index) => {
		const max = index === 2 ? (milliseconds ? 100 : 1) : milliseconds ? 4000 : 4
		let value = [0.2, 0.4, 0.65, 0.6][index] * (milliseconds ? (index === 2 ? 100 : 1000) : 1)
		return {
			key: bindingKey(
				"output",
				prefix ? prefix + stage[0].toUpperCase() + stage.slice(1) : stage
			),
			sourceId: "output",
			sourceLabel: "Any synth",
			descriptor: {
				id: prefix ? prefix + stage[0].toUpperCase() + stage.slice(1) : stage,
				label: prefix ? prefix + stage[0].toUpperCase() + stage.slice(1) : stage,
				widget: "dial",
				min: 0,
				max,
				step: milliseconds ? 1 : 0.001,
				unit: index === 2 ? "%" : milliseconds ? "ms" : "s"
			},
			read: () => value,
			write: vi.fn((next) => {
				value = Number(next)
			}),
			subscribe: vi.fn(() => vi.fn())
		}
	})
}

describe("surface envelopes across output engines", () => {
	it("discovers separate amplitude/filter envelopes, converts units and preserves scalar bindings", async () => {
		const originals = [...controls(), ...controls("filter", true)]
		const bindings = withEnvelopeBindings(originals)
		const envelopes = bindings.filter((b) => b.descriptor.widget === "envelope")
		expect(envelopes).toHaveLength(2)
		expect(bindings).toHaveLength(10)
		expect(featuredBindings(bindings, 2)).toEqual(envelopes)
		expect(await envelopes[1].read()).toEqual([0.2, 0.4, 0.65, 0.6])
		await envelopes[1].write([0.001, 0.8, 0.4, 1.2])
		expect(originals[4].write).toHaveBeenCalledWith(1)
		expect(originals[6].write).toHaveBeenCalledWith(40)
		expect(await envelopes[1].read()).toEqual([0.001, 0.8, 0.4, 1.2])
		const unsubscribe = envelopes[1].subscribe!(vi.fn())
		unsubscribe()
		expect(
			originals
				.slice(4)
				.every((b) => vi.mocked(b.subscribe!).mock.results[0].value.mock.calls.length === 1)
		).toBe(true)
		await expect(envelopes[0].write([1, NaN, 0.2, 1])).rejects.toThrow()
	})

	it("avoids grouping incomplete sets or parameters from different outputs", () => {
		expect(withEnvelopeBindings(controls().slice(0, 3))).toHaveLength(3)
		const mixed = controls()
		mixed[3].sourceId = "other-output"
		expect(withEnvelopeBindings(mixed)).toHaveLength(4)
	})

	it("edits graph points through surface pointer input and retains the accessible fallback", async () => {
		const binding = withEnvelopeBindings(controls())[0]
		const state = {
			id: "surface",
			name: "Envelope",
			connections: [],
			widgets: [{ key: binding.key, widget: "envelope" as const, span: 2 }],
			theme: "neon" as const
		}
		expect(validSurfaces([state])).toBe(true)
		surface = new ControlSurface({
			state,
			bindings: [binding],
			change: vi.fn(),
			fitHeight: false
		})
		document.body.append(surface.element)
		for (let i = 0; i < 20; i++) {
			await Promise.resolve()
		}
		const entry = (surface as any).entries[0]
		const v = entry.visual
		const { points } = envelopeGeometry(binding.descriptor, v.value, v.width, v.height)
		const [x, y] = points[2]
		expect(surface.pointerDown(1, v.x + x, v.y + y)).toBe(true)
		expect(surface.pointerDown(2, v.x + x, v.y + y)).toBe(false)
		surface.pointerMove(1, v.x + x + 10, v.y + y + 10)
		;(surface as any).flushWrites()
		surface.pointerUp(1)
		for (let i = 0; i < 20; i++) {
			await Promise.resolve()
		}
		const changed = (await binding.read()) as number[]
		expect(changed[1]).toBeGreaterThan(0.4)
		expect(changed[2]).toBeLessThan(0.65)
		expect(surface.element.querySelectorAll('input[type="number"]')).toHaveLength(4)
		const input = surface.element.querySelector<HTMLInputElement>('[aria-label$=" Sustain"]')!
		input.value = "35"
		input.dispatchEvent(new Event("input", { bubbles: true }))
		;(surface as any).flushWrites()
		for (let i = 0; i < 20; i++) {
			await Promise.resolve()
		}
		expect(((await binding.read()) as number[])[2]).toBe(0.35)
	})

	it("builds GPU line and handle instances and updates the release endpoint", async () => {
		const binding = withEnvelopeBindings(controls())[0]
		const renderer = Object.create(GpuSurfaceRenderer.prototype)
		renderer.quad = vi.fn()
		renderer.text = vi.fn()
		renderer.contact = vi.fn()
		renderer.centeredText = vi.fn()
		renderer.drawingColor = [0.2, 0.7, 0.9]
		const visual = {
			x: 0,
			y: 0,
			width: 500,
			height: 280,
			descriptor: binding.descriptor,
			value: await binding.read()
		}
		renderer.drawEnvelope(visual, 1)
		expect(renderer.quad.mock.calls.some((call: number[]) => call[4] === 20)).toBe(true)
		expect(renderer.quad.mock.calls.filter((call: number[]) => call[4] === 22)).toHaveLength(4)
		const endpoint = renderer.quad.mock.calls.filter((call: number[]) => call[4] === 22)[3][0]
		visual.value = [0.2, 0.4, 0.65, 2]
		renderer.drawEnvelope(visual, 1)
		expect(
			renderer.quad.mock.calls.filter((call: number[]) => call[4] === 22)[7][0]
		).toBeGreaterThan(endpoint)
		expect(renderer.quad.mock.calls.filter((call: number[]) => call[4] === 23)).toHaveLength(8)
	})
})