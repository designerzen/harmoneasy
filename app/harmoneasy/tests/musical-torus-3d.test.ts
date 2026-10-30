// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import { createMusicalTorus } from "../../../packages/audiobus/ui/musical-torus"
import { torusPitch } from "../../../packages/audiobus/ui/musical-torus"
import {
	EVENT_CHANGE,
	EVENT_POINTER_DOWN,
	EVENT_POINTER_MOVE,
	EVENT_POINTER_UP,
	EVENT_POINTER_CANCEL
} from "../../../packages/audiobus/event-constants"

afterEach(() => document.body.replaceChildren())

function setup() {
	const audition = vi.fn(),
		toggle = vi.fn(),
		torus = createMusicalTorus({ audition, toggle })
	document.body.append(torus.element)
	const svg = torus.element.querySelector("svg")!
	const view = torus.element.querySelector('input[type="checkbox"]') as HTMLInputElement
	const controls = torus.element.querySelector('[aria-label="3D view controls"]') as HTMLElement
	const angles = [...controls.querySelectorAll("input")]
	const pointer = (type: string, x: number, y: number, extra: PointerEventInit = {}) =>
		svg.dispatchEvent(
			new PointerEvent(type, {
				pointerId: 1,
				button: 0,
				clientX: x,
				clientY: y,
				bubbles: true,
				...extra
			})
		)
	const switchView = (enabled: boolean) => {
		view.checked = enabled
		view.dispatchEvent(new Event(EVENT_CHANGE))
	}
	return { torus, svg, controls, angles, audition, toggle, pointer, switchView }
}

it("keeps 3D optional and restores the original view after switching back", () => {
	const { svg, controls, switchView } = setup()
	const original = svg.querySelector("polygon")!.getAttribute("points")
	expect(controls.hidden).toBe(true)
	expect(svg.dataset.view).toBe("fixed")
	switchView(true)
	expect(controls.hidden).toBe(false)
	expect(svg.querySelectorAll("polygon")).toHaveLength(144)
	expect(svg.style.touchAction).toBe("none")
	switchView(false)
	expect(svg.dataset.view).toBe("fixed")
	expect(svg.querySelector("polygon")!.getAttribute("points")).toBe(original)
})

it("rotates on all three axes, wraps angles, and resets without changing the pitch set", () => {
	const { svg, angles, controls, switchView, pointer, audition, toggle } = setup()
	switchView(true)
	const original = svg.querySelector("polygon")!.getAttribute("points")
	pointer(EVENT_POINTER_DOWN, 10, 10)
	pointer(EVENT_POINTER_MOVE, 110, 90)
	pointer(EVENT_POINTER_UP, 110, 90)
	expect(angles.map((input) => input.value)).toEqual(["85", "103", "0"])
	expect(svg.querySelector("polygon")!.getAttribute("points")).not.toBe(original)
	pointer(EVENT_POINTER_DOWN, 10, 10)
	pointer(EVENT_POINTER_MOVE, 110, 10, { shiftKey: true })
	pointer(EVENT_POINTER_UP, 110, 10)
	expect(angles[2].value).toBe("60")
	angles[1].value = "300"
	angles[1].dispatchEvent(new Event(EVENT_CHANGE))
	pointer(EVENT_POINTER_DOWN, 10, 10)
	pointer(EVENT_POINTER_MOVE, 10, 210)
	pointer(EVENT_POINTER_UP, 10, 210)
	expect(angles[1].value).toBe("60")
	expect(audition).not.toHaveBeenCalled()
	expect(toggle).not.toHaveBeenCalled()
	controls.querySelector("button")!.click()
	expect(angles.map((input) => input.value)).toEqual(["25", "55", "0"])
	expect(svg.querySelector("polygon")!.getAttribute("points")).toBe(original)
})

it("suppresses drag clicks, handles cancellation and other pointers, then permits note clicks", () => {
	const { svg, angles, pointer, switchView, audition } = setup()
	switchView(true)
	const capture = vi.fn(),
		release = vi.fn()
	svg.setPointerCapture = capture
	svg.hasPointerCapture = () => true
	svg.releasePointerCapture = release
	pointer(EVENT_POINTER_DOWN, 10, 10)
	pointer(EVENT_POINTER_MOVE, 100, 100, { pointerId: 2 })
	expect(angles[0].value).toBe("25")
	pointer(EVENT_POINTER_MOVE, 100, 100)
	expect(capture).toHaveBeenCalledWith(1)
	pointer(EVENT_POINTER_CANCEL, 100, 100)
	expect(release).toHaveBeenCalledWith(1)
	svg.querySelector('[tabindex="0"]')!.dispatchEvent(
		new MouseEvent("click", { detail: 1, bubbles: true })
	)
	expect(audition).not.toHaveBeenCalled()
	pointer(EVENT_POINTER_DOWN, 10, 10)
	pointer(EVENT_POINTER_MOVE, 12, 11)
	pointer(EVENT_POINTER_UP, 12, 11)
	svg.querySelector('[tabindex="0"]')!.dispatchEvent(
		new MouseEvent("click", { detail: 1, bubbles: true })
	)
	expect(audition).toHaveBeenCalledWith(0)
})

it("plays a captured note tap once without replaying the following click", () => {
	const { svg, pointer, switchView, audition } = setup()
	switchView(true)
	svg.querySelector('[tabindex="0"]')!.dispatchEvent(
		new PointerEvent(EVENT_POINTER_DOWN, {
			pointerId: 1,
			button: 0,
			clientX: 20,
			clientY: 20,
			bubbles: true
		})
	)
	pointer(EVENT_POINTER_UP, 20, 20)
	expect(audition).toHaveBeenCalledExactlyOnceWith(0)
	svg.querySelector('[tabindex="0"]')!.dispatchEvent(
		new MouseEvent("click", { detail: 1, bubbles: true })
	)
	expect(audition).toHaveBeenCalledTimes(1)
})

it("makes every surface facet a pitch control without circular overlays", () => {
	const { svg, switchView, audition } = setup()
	switchView(true)
	expect(svg.querySelectorAll("circle")).toHaveLength(0)
	expect(svg.querySelectorAll('g[role="button"] > polygon')).toHaveLength(144)
	for (let a = 0; a < 12; a++) {
		for (let b = 0; b < 12; b++) {
			const facet = svg.querySelector(`g[data-fret="${a}"][data-string="${b}"] > polygon`)!
			facet.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }))
			expect(audition).toHaveBeenLastCalledWith(torusPitch(a, b))
		}
	}
	expect(audition).toHaveBeenCalledTimes(144)
})

it("maps captured face taps to editing and suppresses rotation gestures on faces", () => {
	const { torus, svg, switchView, pointer, toggle, audition } = setup()
	switchView(true)
	const mode = torus.element.querySelector("select")!
	mode.value = "edit"
	mode.dispatchEvent(new Event(EVENT_CHANGE))
	const press = () =>
		svg
			.querySelector('g[data-fret="2"][data-string="1"] > polygon')!
			.dispatchEvent(
				new PointerEvent(EVENT_POINTER_DOWN, {
					pointerId: 1,
					button: 0,
					clientX: 20,
					clientY: 20,
					bubbles: true
				})
			)
	press()
	pointer(EVENT_POINTER_UP, 20, 20)
	expect(toggle).toHaveBeenCalledExactlyOnceWith(7)
	press()
	pointer(EVENT_POINTER_MOVE, 70, 70)
	pointer(EVENT_POINTER_UP, 70, 70)
	expect(toggle).toHaveBeenCalledTimes(1)
	expect(audition).not.toHaveBeenCalled()
})