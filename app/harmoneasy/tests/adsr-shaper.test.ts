// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { AdsrShaper } from "../../../packages/audiobus/ui/controls/adsr-shaper/adsr-shaper.ts"
import { EVENT_INPUT, EVENT_CHANGE } from "../../../packages/audiobus/event-constants.ts"

afterEach(() => {
	document.body.replaceChildren()
	vi.restoreAllMocks()
})

function setup() {
	const editor = document.createElement("adsr-shaper") as AdsrShaper
	document.body.append(editor)
	return { editor, root: editor.shadowRoot! }
}

describe("ADSR shaper", () => {
	it("edits a dial by vertical dragging and keeps its numeric value and graph synchronized", () => {
		const { editor, root } = setup()
		const dial = root.querySelector<HTMLInputElement>('[aria-label="Attack dial"]')!
		dial.setPointerCapture = vi.fn()
		dial.dispatchEvent(
			new PointerEvent("pointerdown", {
				pointerId: 1,
				button: 0,
				clientY: 100,
				bubbles: true
			})
		)
		dial.dispatchEvent(
			new PointerEvent("pointermove", { pointerId: 1, clientY: 84, bubbles: true })
		)
		expect(editor.value.attack).toBe(0.41)
		expect(root.querySelector<HTMLInputElement>('[name="attack"]')!.value).toBe("0.41")
		expect(root.querySelector(".line")!.getAttribute("d")).toContain("C")
		dial.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true }))
		dial.dispatchEvent(
			new PointerEvent("pointermove", { pointerId: 1, clientY: 0, bubbles: true })
		)
		expect(editor.value.attack).toBe(0.41)
	})
	it("clamps external values without emitting edits and redraws the envelope", () => {
		const { editor, root } = setup()
		const input = vi.fn()
		editor.addEventListener(EVENT_INPUT, input)
		const before = root.querySelector(".line")!.getAttribute("d")
		editor.setAttribute("attack-max", "2")
		editor.value = { attack: 10, sustain: -1, release: NaN }
		expect(editor.value).toEqual({ attack: 2, decay: 0.2, sustain: 0, release: 0.15 })
		expect(root.querySelector(".line")!.getAttribute("d")).not.toBe(before)
		expect(input).not.toHaveBeenCalled()
	})

	it("edits sustain as a percentage and exposes seconds through keyboard controls", () => {
		const { editor, root } = setup()
		const events: CustomEvent[] = []
		document.body.addEventListener(EVENT_INPUT, (event) => events.push(event as CustomEvent), {
			once: true
		})
		const sustain = root.querySelector<HTMLInputElement>('[name="sustain"]')!
		sustain.value = "42"
		sustain.dispatchEvent(new Event(EVENT_INPUT, { bubbles: true }))
		expect(events).toHaveLength(1)
		expect(events[0].detail.sustain).toBe(0.42)
		expect(events[0].composed).toBe(true)
		const attack = root.querySelector('[data-stage="attack"]')!
		attack.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true }))
		expect(editor.value.attack).toBe(0.02)
		attack.dispatchEvent(new KeyboardEvent("keydown", { key: "End" }))
		expect(editor.value.attack).toBe(4)
	})

	it("drags decay time and sustain together, ignores other pointers and stops on cancellation", () => {
		const { editor, root } = setup()
		const graph = root.querySelector<HTMLElement>(".graph")!
		vi.spyOn(graph, "getBoundingClientRect").mockReturnValue({
			width: 560,
			height: 180
		} as DOMRect)
		graph.setPointerCapture = vi.fn()
		const change = vi.fn()
		editor.addEventListener(EVENT_CHANGE, change)
		root.querySelector('[data-stage="decay"]')!.dispatchEvent(
			new PointerEvent("pointerdown", {
				pointerId: 1,
				button: 0,
				clientX: 100,
				clientY: 100,
				bubbles: true
			})
		)
		graph.dispatchEvent(
			new PointerEvent("pointermove", { pointerId: 2, clientX: 420, clientY: 220 })
		)
		expect(editor.value.decay).toBe(0.2)
		graph.dispatchEvent(
			new PointerEvent("pointermove", {
				pointerId: 1,
				clientX: 100 + 106 * (Math.sqrt(0.3 / 4) - Math.sqrt(0.2 / 4)),
				clientY: 124
			})
		)
		expect(editor.value).toMatchObject({ decay: 0.3, sustain: 0.45 })
		graph.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1 }))
		graph.dispatchEvent(
			new PointerEvent("pointermove", { pointerId: 1, clientX: 420, clientY: 220 })
		)
		expect(editor.value).toMatchObject({ decay: 0.3, sustain: 0.45 })
		expect(change).toHaveBeenCalledTimes(1)
	})
})