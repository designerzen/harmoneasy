// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import GamepadVisualizerComponent from "../../../packages/audiobus/ui/gamepad-visualizer-component"
import GamePad, {
	COMMANDS,
	GAME_PAD_DISCONNECTED
} from "../../../packages/audiobus/hardware/gamepad/gamepad"
import InputGamePad from "../../../packages/audiobus/io/inputs/input-gamepad"
import InputGamePadMusic from "../../../packages/audiobus/io/inputs/input-gamepad-music"
import { NOTE_OFF, NOTE_ON } from "../../../packages/audiobus/commands/commands"

const disposables: { destroy(): void }[] = []
beforeEach(() => {
	vi.stubGlobal("navigator", { getGamepads: () => [] })
	vi.spyOn(console, "log").mockImplementation(() => {})
	vi.spyOn(console, "info").mockImplementation(() => {})
})
afterEach(() => {
	disposables.splice(0).forEach((item) => item.destroy())
	document.body.replaceChildren()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

function pointer(
	target: EventTarget,
	type: string,
	pointerId: number,
	init: PointerEventInit = {}
) {
	target.dispatchEvent(
		new PointerEvent(type, {
			bubbles: true,
			cancelable: true,
			pointerId,
			pointerType: "touch",
			button: 0,
			...init
		})
	)
}
function button(container: HTMLElement, command: string): SVGElement {
	return container.querySelector(`[data-command="${command}"]`)!
}
function setup() {
	const input = vi.fn()
	const view = new GamepadVisualizerComponent(input)
	disposables.push(view)
	const element = view.createContainer()
	document.body.append(element)
	const svg = element.querySelector("svg")!
	svg.setPointerCapture = vi.fn()
	svg.hasPointerCapture = vi.fn(() => true)
	svg.releasePointerCapture = vi.fn()
	vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
		left: 10,
		top: 20,
		width: 600,
		height: 360
	} as DOMRect)
	return { view, element, svg, input }
}

describe("interactive gamepad SVG", () => {
	it("plays simultaneous buttons and only releases the final finger on a shared button", () => {
		const { element, input, svg } = setup()
		const a = button(element, COMMANDS.A),
			b = button(element, COMMANDS.B)
		pointer(a.querySelector("text")!, "pointerdown", 1)
		pointer(a, "pointerdown", 2)
		pointer(b, "pointerdown", 3, { pointerType: "mouse" })
		expect(input.mock.calls).toEqual([
			[COMMANDS.A, 1],
			[COMMANDS.B, 1]
		])
		expect(a.getAttribute("aria-pressed")).toBe("true")
		pointer(document, "pointerup", 1)
		expect(input).toHaveBeenCalledTimes(2)
		pointer(document, "pointercancel", 2)
		expect(input).toHaveBeenLastCalledWith(COMMANDS.A, 0)
		expect(b.classList.contains("active")).toBe(true)
		pointer(svg, "lostpointercapture", 3)
		expect(input).toHaveBeenLastCalledWith(COMMANDS.B, 0)
		expect(svg.setPointerCapture).toHaveBeenCalledTimes(3)
	})

	it("drags both sticks independently, clamps diagonal movement and recenters on release", () => {
		const { element, input } = setup()
		const left = element.querySelector('[data-stick="left"]')!
		const right = element.querySelector('[data-stick="right"]')!
		pointer(left, "pointerdown", 1, { clientX: 235, clientY: 275 })
		pointer(right, "pointerdown", 2, { clientX: 415, clientY: 245 })
		pointer(document, "pointermove", 1, { clientX: 535, clientY: 575 })
		expect(input).toHaveBeenCalledWith(COMMANDS.RIGHT_STICK_Y, -1)
		expect(input.mock.calls.find(([key]) => key === COMMANDS.LEFT_STICK_X)?.[1]).toBeCloseTo(
			Math.SQRT1_2
		)
		expect(left.querySelector(".gamepad-stick-knob")!.classList.contains("active")).toBe(true)
		pointer(document, "pointerup", 1)
		expect(left.querySelector(".gamepad-stick-knob")!.getAttribute("transform")).toBe(
			"translate(0 0)"
		)
		expect(right.querySelector(".gamepad-stick-knob")!.getAttribute("transform")).toBe(
			"translate(0 -22)"
		)
		window.dispatchEvent(new Event("blur"))
		expect(input).toHaveBeenLastCalledWith(COMMANDS.RIGHT_STICK_Y, 0)
	})

	it("keeps hardware and virtual feedback independent and scoped to each SVG", () => {
		const first = setup(),
			second = setup()
		first.view.updateButtonVisual(COMMANDS.A, true)
		first.view.updateStickPosition("left", 0.5, -0.5)
		expect(first.input).not.toHaveBeenCalled()
		expect(second.element.querySelector(".active")).toBeNull()
		const a = button(first.element, COMMANDS.A)
		pointer(a, "pointerdown", 1)
		first.view.updateButtonVisual(COMMANDS.A, false)
		expect(a.classList.contains("active")).toBe(true)
		pointer(document, "pointerup", 1)
		expect(a.classList.contains("active")).toBe(false)
		pointer(button(first.element, COMMANDS.LEFT_SHOULDER), "pointerdown", 2)
		expect(first.element.querySelector('[data-stick="left"] .active')).not.toBeNull()
	})

	it("supports held keyboard activation and releases every virtual control on destruction", () => {
		const { view, element, input } = setup()
		const a = button(element, COMMANDS.A)
		a.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }))
		a.dispatchEvent(new KeyboardEvent("keydown", { key: " ", repeat: true, bubbles: true }))
		pointer(button(element, COMMANDS.B), "pointerdown", 2)
		expect(input).toHaveBeenCalledTimes(2)
		view.destroy()
		expect(input.mock.calls.slice(2)).toEqual([
			[COMMANDS.B, 0],
			[COMMANDS.A, 0]
		])
		pointer(a, "pointerdown", 3)
		expect(input).toHaveBeenCalledTimes(4)
	})
})

describe("gamepad input GUIs", () => {
	it.each([
		["raw", InputGamePad],
		["music", InputGamePadMusic]
	] as const)(
		"plays without hardware, caches the GUI and recreates it after cleanup (%s)",
		async (_name, Input) => {
			const input = new Input({ gamepadIndex: 2, now: () => 0 })
			disposables.push(input)
			const dispatch = vi.spyOn(input, "dispatch")
			const element = await input.createGui()
			document.body.append(element)
			expect(await input.createGui()).toBe(element)
			pointer(button(element, COMMANDS.A), "pointerdown", 1)
			const notes = dispatch.mock.calls
				.map(([command]) => command)
				.filter((command) => command.type === NOTE_ON)
			expect(notes.length).toBeGreaterThan(0)
			await input.destroyGui()
			const releases = dispatch.mock.calls
				.map(([command]) => command)
				.filter((command) => command.type === NOTE_OFF)
			expect(releases.map((command) => command.number).sort()).toEqual(
				notes.map((command) => command.number).sort()
			)
			expect(releases[0].from).toBe(notes[0].from)
			expect(input.gamePadManager.callbacks.size).toBe(1)
			expect(await input.createGui()).not.toBe(element)
		}
	)

	it("initializes hardware feedback, respects controller assignments and clears disconnected controls", async () => {
		const input = new InputGamePadMusic({ gamepadIndex: 1 })
		disposables.push(input)
		const pad = new GamePad(1)
		pad.index = 1
		pad.connected = true
		pad.a = true
		pad.leftstickX = 0.75
		input.gamePadManager.controllers.set(1, pad)
		const ignored = new GamePad(2)
		ignored.index = 2
		ignored.connected = true
		ignored.b = true
		input.gamePadManager.controllers.set(2, ignored)
		const element = await input.createGui()
		expect(button(element, COMMANDS.A).classList.contains("active")).toBe(true)
		expect(button(element, COMMANDS.B).classList.contains("active")).toBe(false)
		expect(
			element.querySelector('[data-stick="left"] circle.active')!.getAttribute("transform")
		).toBe("translate(16.5 0)")
		pad.a = false
		pad.b = true
		pad.rightstickY = -1
		input.gamePadManager.dispatchEvent(COMMANDS.B, 1, pad)
		expect(button(element, COMMANDS.A).classList.contains("active")).toBe(false)
		expect(button(element, COMMANDS.B).classList.contains("active")).toBe(true)
		expect(
			element.querySelector('[data-stick="right"] circle.active')!.getAttribute("transform")
		).toBe("translate(0 -22)")
		input.gamePadManager.controllers.delete(1)
		input.gamePadManager.dispatchEvent(GAME_PAD_DISCONNECTED, 0, pad)
		expect(element.querySelector(".active")).toBeNull()
		expect(element.querySelector("svg")).not.toBeNull()
	})

	it("releases the notes originally pressed after root changes and keeps overlapping chords held", async () => {
		const input = new InputGamePadMusic({ now: () => 0 })
		disposables.push(input)
		const dispatch = vi.spyOn(input, "dispatch")
		const element = await input.createGui()
		pointer(button(element, COMMANDS.A), "pointerdown", 1)
		pointer(button(element, COMMANDS.B), "pointerdown", 2)
		pointer(button(element, COMMANDS.UP), "pointerdown", 3)
		pointer(document, "pointerup", 1)
		let releases = dispatch.mock.calls
			.map(([command]) => command)
			.filter((command) => command.type === NOTE_OFF)
		expect(releases.map((command) => command.number)).toEqual([64])
		pointer(document, "pointerup", 2)
		releases = dispatch.mock.calls
			.map(([command]) => command)
			.filter((command) => command.type === NOTE_OFF)
		expect(releases.map((command) => command.number).sort()).toEqual([60, 63, 64, 67])
	})

	it("uses normalized stick values for musical dynamics and releases melodic notes on mode switches", async () => {
		const input = new InputGamePadMusic()
		disposables.push(input)
		const element = await input.createGui()
		const svg = element.querySelector("svg")!
		vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
			left: 0,
			top: 0,
			width: 600,
			height: 360
		} as DOMRect)
		pointer(element.querySelector('[data-stick="left"]')!, "pointerdown", 1, {
			clientX: 255,
			clientY: 255
		})
		expect(input.state.lastStickX).toBe(1)
		pointer(button(element, COMMANDS.SELECT), "pointerdown", 2)
		pointer(document, "pointerup", 2)
		const dispatch = vi.spyOn(input, "dispatch")
		pointer(button(element, COMMANDS.A), "pointerdown", 3)
		const note = dispatch.mock.calls.find(([command]) => command.type === NOTE_ON)![0]
		pointer(button(element, COMMANDS.SELECT), "pointerdown", 4)
		expect(
			dispatch.mock.calls.some(
				([command]) => command.type === NOTE_OFF && command.number === note.number
			)
		).toBe(true)
		expect(input.state.heldNotes.size).toBe(0)
	})
})