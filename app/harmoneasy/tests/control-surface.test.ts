// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	ControlSurface,
	createDialControl,
	createPanControl,
	createRotationControl,
	createGuitarTabControl,
	createPianoRollControl,
	createRelativeKeysControl,
	RelativeKeys,
	Strum,
	createStrumControl
} from "control-surface"
import { sourceTheme } from "../../../packages/control-surface/src/themes"
import { createDomGui, createDomControl } from "control-surface/dom"
import { contactPressure } from "../../../packages/control-surface/src/pressure"
import {
	EVENT_BLUR,
	EVENT_KEY_DOWN,
	EVENT_KEY_UP
} from "../../../packages/control-surface/src/events"
import {
	bindingKey,
	denormalize,
	dialOptions,
	dialPosition,
	normalize,
	validSurfaces,
	validateValue,
	layoutWidgets,
	widgetPoint,
	ergonomicOrder
} from "control-surface/model"
import type { ControlBinding, ControlDescriptor, SurfaceState } from "control-surface/types"
import { componentBindings, installComponentUi } from "audiobus/io/component-ui"
import { TransformerQuantise } from "audiobus/io/transformers/transformer-quantise"
import {
	disconnectSurface,
	selectSurfaceControls,
	CONTROL_HANDLE,
	SURFACE_HANDLE
} from "../source/components/graph/control-surfaces"
import { getStructure } from "../source/components/graph/layout"
import { deviceId } from "audiobus/io/device-definition"
import {
	intersectPanel,
	multiplyMatrices,
	startSurfaceXR
} from "../../../packages/control-surface/src/xr"

vi.mock("../../../packages/control-surface/src/renderer", () => ({
	GpuSurfaceRenderer: {
		create: vi.fn(async () => {
			throw new Error("No test GPU")
		})
	}
}))
const views: { destroy(): void }[] = []
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
})
afterEach(() => {
	views.splice(0).forEach((view) => view.destroy())
	document.body.replaceChildren()
	vi.unstubAllGlobals()
})
const settle = async () => {
	for (let i = 0; i < 12; i++) {
		for (const view of views) {
			;(view as unknown as { flushWrites?(): void }).flushWrites?.()
		}
		await Promise.resolve()
	}
}
function state(): SurfaceState {
	return { id: "surface", name: "Performance", connections: [], widgets: [], theme: "neon" }
}
function bind(
	id: string,
	descriptor: Partial<ControlDescriptor> = {},
	initial: any = 0.5
): ControlBinding & { value: any; write: ReturnType<typeof vi.fn> } {
	const binding = {
		key: bindingKey("synth", id),
		sourceLabel: "Synth",
		descriptor: { id, label: id, widget: "dial" as const, min: 0, max: 1, ...descriptor },
		value: initial,
		read: () => binding.value,
		write: vi.fn(async (value) => {
			binding.value = value
		})
	}
	return binding
}

describe("shared component controls", () => {
	it("recovers note ownership after an asynchronous output failure", async () => {
		const component = installComponentUi({
			getUiDescriptor: () => ({ controls: [] }),
			noteOn: vi
				.fn()
				.mockRejectedValueOnce(new Error("Output unavailable"))
				.mockResolvedValue(undefined),
			noteOff: vi.fn()
		})
		const relative = (await componentBindings(component, "recover"))[0]
		const contacts = [0.5, 0.5, 1, 60, 0.8, 0.5, 0.5]
		await expect(relative.write(contacts)).rejects.toThrow("Output unavailable")
		expect(component.noteOff).toHaveBeenCalledWith(60)
		await relative.write(contacts)
		expect(component.noteOn).toHaveBeenCalledTimes(2)
		await relative.write([])
	})
	it("offers live musical controls on note-capable sources and shares held-note ownership", async () => {
		const component = installComponentUi({
			name: "Synth",
			getUiDescriptor: () => ({ controls: [] }),
			noteOn: vi.fn(),
			noteOff: vi.fn()
		})
		const controls = await componentBindings(component, "synth")
		expect(controls.map((b) => b.descriptor.widget)).toEqual([
			"relative-keys",
			"piano-roll",
			"guitar-tab",
			"strum"
		])
		const [relative, roll] = controls
		await relative.write([0.5, 0.5, 1, 60, 0.5, 0.5, 0.5])
		expect(component.noteOn).toHaveBeenLastCalledWith(60, 64)
		const notes = Array(96).fill(0)
		notes[88] = 0.8
		await roll.write(notes)
		expect(component.noteOn).toHaveBeenCalledTimes(1)
		await relative.write([])
		expect(component.noteOff).not.toHaveBeenCalled()
		await roll.write(Array(96).fill(0))
		expect(component.noteOff).toHaveBeenLastCalledWith(60)
	})
	it("lets strums ring, retriggers repeated plucks and releases on cleanup", async () => {
		vi.useFakeTimers()
		try {
			const component = installComponentUi({
				getUiDescriptor: () => ({ controls: [] }),
				noteOn: vi.fn(),
				noteOff: vi.fn()
			})
			const binding = (await componentBindings(component, "strings")).find(
				(b) => b.descriptor.widget === "strum"
			)!
			await binding.write([1, 0, 64, 0.25])
			expect(component.noteOn).toHaveBeenLastCalledWith(64, 32)
			await binding.write([2, 0, 64, 0.8])
			expect(component.noteOn).toHaveBeenCalledTimes(2)
			await vi.advanceTimersByTimeAsync(800)
			expect(component.noteOff).toHaveBeenLastCalledWith(64)
			await binding.write([3, 1, 59, 1])
			await binding.write([])
			expect(component.noteOff).toHaveBeenLastCalledWith(59)
			expect(vi.getTimerCount()).toBe(0)
		} finally {
			vi.useRealTimers()
		}
	})
	it("keeps synchronous component writes synchronous and notifies only the changed control", async () => {
		const component = installComponentUi({
			getUiDescriptor: () => ({
				controls: ["a", "b"].map((id) => ({ id, label: id, widget: "dial" as const }))
			}),
			getControlValue: () => 0,
			setControlValue: vi.fn()
		})
		const [a, b] = await componentBindings(component, "engine"),
			changedA = vi.fn(),
			changedB = vi.fn()
		const unsubscribeA = a.subscribe!(changedA),
			unsubscribeB = b.subscribe!(changedB)
		expect(a.sourceId).toBe("engine")
		expect(b.sourceId).toBe(a.sourceId)
		expect(a.write(0.5)).toBeUndefined()
		expect(changedA).toHaveBeenCalledTimes(1)
		expect(changedB).not.toHaveBeenCalled()
		unsubscribeA()
		unsubscribeB()
	})
	it("generates live Transformer controls without GUI introspection and preserves numeric choices", async () => {
		const transformer = new TransformerQuantise(),
			bindings = await componentBindings(transformer, "quantise"),
			gui = createDomGui(bindings)
		views.push(gui)
		document.body.append(gui.element)
		await settle()
		const toggle = gui.element.querySelector<HTMLInputElement>('input[type="checkbox"]')!
		expect(toggle.checked).toBe(true)
		toggle.checked = false
		toggle.dispatchEvent(new Event("input"))
		await settle()
		expect(transformer.options.enabled).toBe(false)
		const select = gui.element.querySelector("select")!
		select.value = "2"
		select.dispatchEvent(new Event("change"))
		await settle()
		expect(transformer.options.step).toBe(3)
		transformer.setConfig("step", 16)
		await settle()
		expect(select.selectedOptions[0].textContent).toBe("16")
	})
	it("exposes legacy GUI controls without moving them or replacing custom GUIs", async () => {
		const panel = document.createElement("div"),
			input = document.createElement("input"),
			host = document.createElement("div")
		input.type = "range"
		input.name = "gain"
		input.min = "0"
		input.max = "10"
		input.step = "0.5"
		input.value = "2"
		panel.append(input)
		host.append(panel)
		document.body.append(host)
		const changed = vi.fn()
		input.addEventListener("input", changed)
		const createGui = vi.fn(async () => panel)
		const component = installComponentUi({ name: "Legacy", createGui }),
			bindings = await componentBindings(component, "legacy")
		expect(panel.parentElement).toBe(host)
		expect(bindings[0].descriptor.widget).toBe("slider")
		await bindings[0].write(7.24)
		expect(input.value).toBe("7")
		expect(changed).toHaveBeenCalledOnce()
		input.value = "4"
		expect(await bindings[0].read()).toBe(4)
		expect(await component.createGui!()).toBe(panel)
		expect(createGui).toHaveBeenCalledOnce()
	})
	it("keeps legacy controls alive when a graph GUI closes and releases them with the last surface", async () => {
		const panel = document.createElement("div"),
			input = document.createElement("input"),
			destroy = vi.fn()
		input.type = "range"
		input.name = "level"
		panel.append(input)
		const component = installComponentUi({ createGui: async () => panel, destroyGui: destroy })
		const [binding] = await componentBindings(component, "legacy"),
			unsubscribe = binding.subscribe!(() => {})
		await component.destroyGui!()
		expect(destroy).not.toHaveBeenCalled()
		await binding.write(12)
		expect(input.value).toBe("12")
		unsubscribe()
		await settle()
		expect(destroy).toHaveBeenCalledOnce()
		const empty = installComponentUi({ name: "No controls" })
		expect((await empty.getUiDescriptor!()).controls).toEqual([])
		expect(await empty.createGui!()).toBeInstanceOf(HTMLElement)
		empty.destroyGui!()
	})
	it("clamps and quantizes parameters, preserves typed choices, and rejects invalid values", () => {
		const d: ControlDescriptor = {
			id: "cutoff",
			label: "Cutoff",
			widget: "dial",
			min: 20,
			max: 20000,
			scale: "log"
		}
		expect(normalize(d, denormalize(d, 0.5))).toBeCloseTo(0.5)
		expect(() => validateValue(d, Infinity)).toThrow()
		expect(validateValue({ ...d, scale: "linear", min: 0, max: 10, step: 0.5 }, 7.24)).toBe(7)
		expect(
			validateValue(
				{
					id: "scale",
					label: "Scale",
					widget: "select",
					choices: [{ label: "Major", value: [0, 2, 4] }]
				},
				[0, 2, 4]
			)
		).toEqual([0, 2, 4])
	})
})

describe("surface interaction and bindings", () => {
	it("packs holes and honours preferred columns without overlapping at any screen width", () => {
		const widgets = Array.from({ length: 75 }, (_, i) => ({
			span: 1 + (i % 3),
			height: 132 + ((i * 71) % 580),
			column: i % 7 === 0 ? i % 3 : undefined,
			rotation: (i % 4) * 90
		}))
		for (const width of [280, 390, 640, 760, 1200]) {
			const layout = layoutWidgets(widgets, width)
			for (const [i, a] of layout.items.entries()) {
				expect(a.x).toBeGreaterThanOrEqual(0)
				expect(a.x + a.width).toBeLessThanOrEqual(width + 0.001)
				expect(a.y + a.height).toBeLessThanOrEqual(layout.height)
				for (const b of layout.items.slice(i + 1))
					expect(
						a.x < b.x + b.width &&
							a.x + a.width > b.x &&
							a.y < b.y + b.height &&
							a.y + a.height > b.y
					).toBe(false)
			}
			expect(layoutWidgets(widgets, width)).toEqual(layout)
		}
		const holes = layoutWidgets(
			[{ height: 300 }, { height: 132 }, { span: 2, height: 200 }, { height: 132 }],
			640
		)
		expect(holes.items[3]).toMatchObject({ y: 0 })
		expect(holes.items[3].x).toBeCloseTo((640 / 3) * 2)
		const pinned = layoutWidgets([{ column: 2 }, { column: 2 }], 640)
		expect(pinned.items[1].y).toBe(180)
	})
	it("automatically arranges related controls compactly and persists the chosen order", async () => {
		const widgets = Array.from({ length: 24 }, (_, i) => ({
			span: i % 4 === 0 ? 2 : 1,
			height: 132 + ((i * 71) % 300),
			sourceId: `source-${i % 3}`,
			group: i % 2 ? "Sound" : "Performance",
			widget: i % 4 === 0 ? "piano-roll" : "dial"
		}))
		const order = ergonomicOrder(widgets, 640)
		expect([...order].sort((a, b) => a - b)).toEqual(widgets.map((_, i) => i))
		expect(ergonomicOrder(widgets, 640)).toEqual(order)
		const a = bind("a"),
			b = bind("b"),
			saved = state(),
			change = vi.fn()
		saved.widgets = [
			{ key: a.key, column: 2, height: 300 },
			{ key: b.key, column: 2 }
		]
		const surface = new ControlSurface({ state: saved, bindings: [a, b], change })
		views.push(surface)
		await settle()
		;[...surface.element.querySelectorAll<HTMLButtonElement>("button")]
			.find((button) => button.textContent === "Auto arrange")!
			.click()
		expect(saved.widgets.every((widget) => widget.column === undefined)).toBe(true)
		expect(saved.widgets.find((widget) => widget.key === a.key)!.height).toBe(300)
		expect(change).toHaveBeenCalled()
		expect(validSurfaces(JSON.parse(JSON.stringify([saved])))).toBe(true)
	})
	it("strums every crossed string on fast swipes in both directions", () => {
		const apply = vi.fn(),
			strum = new Strum(undefined, apply)
		strum.down(1, 0.5, 0.01, 0.25)
		strum.move(1, 0.5, 0.99, 0.8)
		expect(apply.mock.calls.map(([v]) => v[1])).toEqual([0, 1, 2, 3, 4, 5])
		strum.move(1, 0.5, 0.01, 0.6)
		expect(apply.mock.calls.slice(6).map(([v]) => v[1])).toEqual([4, 3, 2, 1, 0])
		expect(apply.mock.lastCall![0][3]).toBe(0.6)
		strum.up(1)
		expect(strum.contacts.size).toBe(0)
		strum.release()
		expect(apply.mock.lastCall).toEqual([[], true])
		expect(() =>
			validateValue(createStrumControl({ id: "s", label: "Strings" }), [1, 100, 64, 0.5])
		).toThrow()
	})
	it("edits musical grids with one Tab stop, announced cells and arrow navigation", () => {
		const d = createPianoRollControl({
			id: "notes",
			label: "Phrase",
			music: { steps: 4, notes: [64, 60] }
		})
		const apply = vi.fn(),
			control = createDomControl(bind("notes", d, d.defaultValue), apply)
		document.body.append(control.element)
		const grid = control.element.querySelector('[role="grid"]')!
		expect(grid.getAttribute("aria-rowcount")).toBe("2")
		expect(grid.getAttribute("aria-colcount")).toBe("4")
		const buttons = [...grid.querySelectorAll<HTMLButtonElement>("button")]
		expect(buttons.filter((b) => b.tabIndex === 0)).toHaveLength(1)
		buttons[0].click()
		expect(apply.mock.lastCall![0]).toEqual([1, 0, 0, 0, 0, 0, 0, 0])
		expect(buttons[0].getAttribute("aria-label")).toContain("E4, step 1, velocity 100 percent")
		buttons[0].dispatchEvent(
			new KeyboardEvent(EVENT_KEY_DOWN, { key: "ArrowDown", bubbles: true })
		)
		expect(document.activeElement).toBe(buttons[4])
		buttons[4].dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: "+", bubbles: true }))
		expect(apply.mock.lastCall![0][4]).toBeCloseTo(0.1)
		control.update([1, 0, 0, 0, 0.5, 0, 0, 0])
		expect(document.activeElement).toBe(buttons[4])
		expect(buttons[4].getAttribute("aria-label")).toContain("50 percent")
		expect(() => validateValue(d, [1])).toThrow()
		control.element.remove()
	})
	it("announces guitar strings, frets and pitches, and supports rests", () => {
		const d = createGuitarTabControl({
				id: "tab",
				label: "Guitar",
				music: { steps: 2, tuning: [64, 59] }
			}),
			apply = vi.fn()
		const control = createDomControl(bind("tab", d, d.defaultValue), apply)
		const button = control.element.querySelector("button")!
		expect(button.getAttribute("aria-label")).toContain("String 1, E4, step 1, rest")
		button.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: "3" }))
		expect(button.getAttribute("aria-label")).toContain("fret 3, G4")
		button.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: "Delete" }))
		expect(apply.mock.lastCall![0]).toEqual([-1, -1, -1, -1])
		expect(() =>
			createGuitarTabControl({ id: "bad", label: "Bad", music: { steps: 100000 } })
		).toThrow()
	})
	it("saves independent sizes, rotation and keyboard sorting without losing focus", async () => {
		const a = bind("a"),
			b = bind("b"),
			saved = state(),
			change = vi.fn()
		saved.widgets = [{ key: a.key }, { key: b.key }]
		const surface = new ControlSurface({ state: saved, bindings: [a, b], change })
		document.body.append(surface.element)
		views.push(surface)
		await settle()
		const button = (name: string) =>
			[...surface.element.querySelectorAll<HTMLButtonElement>("button")].find(
				(b) => b.getAttribute("aria-label") === name
			)!
		;[...surface.element.querySelectorAll<HTMLButtonElement>("button")]
			.find((b) => b.textContent === "Edit layout")!
			.click()
		button("Resize a").dispatchEvent(
			new KeyboardEvent(EVENT_KEY_DOWN, { key: "ArrowRight", bubbles: true })
		)
		button("Resize a").dispatchEvent(
			new KeyboardEvent(EVENT_KEY_DOWN, { key: "ArrowDown", bubbles: true })
		)
		expect(saved.widgets[0]).toMatchObject({ span: 2, height: 196 })
		button("Rotate a").click()
		expect(saved.widgets[0].rotation).toBe(90)
		expect(surface.element.querySelector<HTMLElement>(".cs-widget")!.style.transform).toBe(
			"rotate(90deg)"
		)
		button("Move later a").click()
		expect(saved.widgets.map((w) => w.key)).toEqual([b.key, a.key])
		expect(document.activeElement).toBe(button("Move later a"))
		expect(change).toHaveBeenCalled()
		expect(validSurfaces([saved])).toBe(true)
		saved.widgets[1].height = Infinity
		expect(validSurfaces([saved])).toBe(false)
		const layout = layoutWidgets(
			[{ height: 250 }, { height: 400 }, { height: 132 }, { height: 200 }],
			640
		)
		expect(layout.items[3].y).toBe(140)
	})
	it("maps rotated surface hits back to gadget coordinates", async () => {
		const slider = bind("slide", { widget: "slider" }),
			saved = state()
		saved.widgets = [{ key: slider.key, rotation: 90, height: 300 }]
		const surface = new ControlSurface({ state: saved, bindings: [slider], change: vi.fn() })
		views.push(surface)
		await settle()
		const v = (surface as any).entries[0].visual
		const localX = v.x + v.width * 0.8,
			localY = v.y + v.height / 2
		const world = widgetPoint(localX, localY, { ...v, rotation: -90 })
		expect(surface.pointerDown(31, world.x, world.y)).toBe(true)
		surface.pointerUp(31)
		await settle()
		expect(slider.value).toBeGreaterThan(0.8)
	})
	it("anchors relative notes to the first touch, preserves it after lift and resets for the next gesture", () => {
		const apply = vi.fn(),
			keys = new RelativeKeys(undefined, apply)
		keys.width = 480
		keys.height = 240
		keys.down(1, 0.3, 0.4, 0.25)
		keys.down(2, 0.5, 0.2, 0.75)
		expect(keys.contacts.get(1)!.note).toBe(60)
		expect(keys.contacts.get(2)!.note).toBe(67)
		expect(keys.contacts.get(2)!.pressure).toBe(0.75)
		keys.up(1)
		expect(keys.anchor).toEqual({ x: 0.3, y: 0.4 })
		keys.move(2, 0.6, 0.2, 0.5)
		expect(keys.contacts.get(2)!.note).toBe(68)
		keys.release()
		expect(apply.mock.lastCall).toEqual([[], true])
		keys.down(3, 0.8, 0.8, 1)
		expect(keys.contacts.get(3)!.note).toBe(60)
		expect(keys.anchor).toEqual({ x: 0.8, y: 0.8 })
		expect(
			validateValue(
				createRelativeKeysControl({ id: "r", label: "Relative" }),
				apply.mock.lastCall![0]
			)
		).toEqual(apply.mock.lastCall![0])
	})
	it("releases relative voices on blur and preserves quick note edges through asynchronous bindings", async () => {
		const relative = bind("r", createRelativeKeysControl({ id: "r", label: "Relative" }), []),
			saved = state()
		saved.widgets = [{ key: relative.key }]
		let finish!: () => void
		relative.write.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve
				})
		)
		const surface = new ControlSurface({ state: saved, bindings: [relative], change: vi.fn() })
		views.push(surface)
		await settle()
		expect(surface.pointerDown(1, 80, 80, false, 0.5)).toBe(true)
		window.dispatchEvent(new Event(EVENT_BLUR))
		finish()
		await settle()
		expect(relative.write.mock.calls.map(([value]) => value)).toHaveLength(2)
		expect(relative.write.mock.lastCall![0]).toEqual([])
	})
	it("keeps source themes stable across surfaces and separates identically named components", async () => {
		const a = { ...bind("a"), sourceId: "synth-one" },
			b = { ...bind("b"), sourceId: "synth-one" },
			c = { ...bind("c"), sourceId: "synth-two" }
		const make = (bindings: ControlBinding[]) => {
			const saved = state()
			saved.widgets = bindings.map(({ key }) => ({ key }))
			const surface = new ControlSurface({ state: saved, bindings, change: vi.fn() })
			views.push(surface)
			return surface
		}
		const first = make([a, b, c]),
			second = make([c, { ...a, sourceLabel: "Renamed" }])
		await settle()
		const panels = [...first.element.querySelectorAll<HTMLElement>(".cs-widget")]
		const colour = (element: HTMLElement) => element.style.getPropertyValue("--cs-source")
		expect(colour(panels[0])).toBe(colour(panels[1]))
		expect(colour(panels[0])).not.toBe(colour(panels[2]))
		expect(colour(second.element.querySelectorAll<HTMLElement>(".cs-widget")[1])).toBe(
			colour(panels[0])
		)
		expect(panels[0].getAttribute("aria-label")).toBe("Synth: a")
		expect(sourceTheme("synth-one")).toEqual(sourceTheme("synth-one"))
	})
	it("creates reusable procedural dial descriptors without user-facing configuration", () => {
		expect(createPanControl({ id: "pan", label: "Pan" })).toMatchObject({
			widget: "dial",
			min: -1,
			max: 1,
			defaultValue: 0,
			dial: { mode: "pan", centerDetent: true }
		})
		expect(createPanControl({ id: "balance", label: "Balance", min: 0, max: 1 })).toMatchObject(
			{ defaultValue: 0.5 }
		)
		expect(createRotationControl({ id: "heading", label: "Heading" })).toMatchObject({
			min: 0,
			max: 360,
			unit: "°",
			dial: { mode: "rotation", input: "angular" }
		})
		expect(
			createRotationControl({ id: "phase", label: "Phase", min: 0, max: 1 }).step
		).toBeCloseTo(1 / 360)
		expect(
			createDialControl({
				id: "arc",
				label: "Arc",
				dial: { startAngle: 45, sweepAngle: 120, ticks: 12 }
			}).dial
		).toMatchObject({ startAngle: 45, sweepAngle: 120, ticks: 12 })
		expect(() => createDialControl({ id: "bad", label: "Bad", dial: { ticks: 5000 } })).toThrow(
			RangeError
		)
	})
	it("validates saved dial options and resolves pan and rotation presets", () => {
		expect(dialOptions({ mode: "pan" })).toMatchObject({
			startAngle: -90,
			sweepAngle: 180,
			centerDetent: true
		})
		expect(dialOptions({ mode: "rotation" })).toMatchObject({
			sweepAngle: 360,
			input: "angular"
		})
		expect(dialPosition(0.508, dialOptions({ mode: "pan" }))).toBe(0.5)
		expect(dialPosition(1.1, dialOptions({ mode: "rotation" }))).toBeCloseTo(0.1)
		const saved = state()
		saved.widgets = [{ key: "pan", widget: "dial", dial: { mode: "pan", ticks: 12 } }]
		expect(validSurfaces([saved])).toBe(true)
		saved.widgets[0].dial!.sweepAngle = 0
		expect(validSurfaces([saved])).toBe(false)
		saved.widgets[0].dial = { ticks: 50000 }
		expect(validSurfaces([saved])).toBe(false)
	})
	it("maps a pan dial to its existing bipolar parameter range and snaps to center", async () => {
		const pan = bind("pan", { min: -1, max: 1 }, -0.2),
			saved = state()
		saved.widgets = [{ key: pan.key, dial: { mode: "pan" } }]
		const surface = new ControlSurface({ state: saved, bindings: [pan], change: vi.fn() })
		views.push(surface)
		await settle()
		surface.pointerDown(1, 100, 100)
		surface.pointerMove(1, 100, 84.8)
		surface.pointerUp(1)
		await settle()
		expect(pan.value).toBe(0)
	})
	it("unwraps circular drag angles across the seam and wraps rotational values", async () => {
		const rotation = bind("heading", { min: 0, max: 360 }, 356.4),
			saved = state()
		saved.widgets = [{ key: rotation.key, dial: { mode: "rotation" } }]
		const surface = new ControlSurface({ state: saved, bindings: [rotation], change: vi.fn() })
		views.push(surface)
		await settle()
		const visual = (
			surface as unknown as {
				entries: { visual: { x: number; y: number; width: number; height: number } }[]
			}
		).entries[0].visual
		const cx = visual.x + visual.width / 2,
			cy = visual.y + 48 + (visual.height - 76) / 2
		const point = (angle: number) => [cx + Math.sin(angle) * 35, cy - Math.cos(angle) * 35]
		const start = point(3),
			end = point(-3)
		surface.pointerDown(1, start[0], start[1])
		surface.pointerMove(1, end[0], end[1])
		surface.pointerUp(1)
		await settle()
		expect(rotation.value).toBeCloseTo(12.6253229)
	})
	it("wraps rotation dials using keyboard arrows", async () => {
		const rotation = bind(
				"heading",
				{ min: 0, max: 360, step: 1, dial: { mode: "rotation" } },
				359
			),
			saved = state()
		saved.widgets = [{ key: rotation.key }]
		const surface = new ControlSurface({ state: saved, bindings: [rotation], change: vi.fn() })
		views.push(surface)
		document.body.append(surface.element)
		await settle()
		const input = surface.element.querySelector<HTMLInputElement>(".cs-dial input")!
		input.value = "359"
		input.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: "ArrowRight" }))
		await settle()
		expect(rotation.value).toBe(0)
		input.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: "ArrowLeft" }))
		await settle()
		expect(rotation.value).toBe(359)
	})
	it("keeps a dial selected after dragging and while its keyboard control is focused", async () => {
		const dial = bind("cutoff"),
			saved = state()
		saved.widgets = [{ key: dial.key }]
		const surface = new ControlSurface({ state: saved, bindings: [dial], change: vi.fn() })
		views.push(surface)
		document.body.append(surface.element)
		await settle()
		const entry = (
			surface as unknown as {
				entries: { element: HTMLElement; visual: { focused?: boolean } }[]
			}
		).entries[0]
		surface.pointerDown(1, 90, 90)
		surface.pointerUp(1)
		expect(entry.visual.focused).toBe(true)
		entry.element.querySelector("input")!.focus()
		expect(entry.visual.focused).toBe(true)
		const other = document.createElement("button")
		document.body.append(other)
		other.focus()
		expect(entry.visual.focused).toBe(false)
	})
	it("edits the title and opens control settings from the external title bar", () => {
		const toolbarHost = document.body.appendChild(document.createElement("header"))
		const saved = state(),
			change = vi.fn(),
			addControls = vi.fn()
		const surface = new ControlSurface({
			state: saved,
			bindings: [],
			change,
			toolbarHost,
			addControls: [{ label: "Add Synth controls…", action: addControls }]
		})
		views.push(surface)
		const name = toolbarHost.querySelector<HTMLInputElement>(".cs-title")!
		expect(name.hidden).toBe(false)
		name.value = "  My performance  "
		name.dispatchEvent(new Event("change"))
		expect(saved.name).toBe("My performance")
		expect(change).toHaveBeenCalledWith(saved)
		name.value = "   "
		name.dispatchEvent(new Event("change"))
		expect(name.value).toBe("My performance")
		const buttons = [...toolbarHost.querySelectorAll<HTMLButtonElement>("button")]
		expect(buttons[0].textContent).toBe("Edit layout")
		expect(toolbarHost.querySelector(".cs-toolbar")!.lastElementChild!.textContent).toBe(
			"Enter VR"
		)
		expect(toolbarHost.querySelector(".cs-toolbar")!.children[1].className).toBe("cs-settings")
		const settings = toolbarHost.querySelector<HTMLButtonElement>(
			'[aria-label="Surface settings"]'
		)!
		const menu = toolbarHost.querySelector<HTMLElement>(".cs-settings-menu")!
		expect(menu.hidden).toBe(true)
		settings.click()
		expect(menu.hidden).toBe(false)
		menu.querySelector<HTMLButtonElement>("button")!.click()
		expect(addControls).toHaveBeenCalledOnce()
		expect(menu.hidden).toBe(true)
		settings.click()
		settings.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: "Escape", bubbles: true }))
		expect(menu.hidden).toBe(true)
		surface.destroy()
		expect(toolbarHost.children).toHaveLength(0)
	})
	it("starts dial gestures throughout the whole panel and keeps dragging outside its bounds", async () => {
		const dial = bind("cutoff"),
			saved = state()
		saved.widgets = [{ key: dial.key }]
		const surface = new ControlSurface({ state: saved, bindings: [dial], change: vi.fn() })
		views.push(surface)
		await settle()
		const { x, y, width, height } = (
			surface as unknown as {
				entries: { visual: { x: number; y: number; width: number; height: number } }[]
			}
		).entries[0].visual
		const corners = [
			[x + 2, y + 2],
			[x + width - 2, y + 2],
			[x + 2, y + height - 2],
			[x + width - 2, y + height - 2]
		]
		for (const [index, [px, py]] of corners.entries()) {
			expect(surface.pointerDown(index, px, py)).toBe(true)
			surface.pointerMove(index, px, py - 16)
			surface.pointerUp(index)
			await settle()
			expect(dial.value).toBeCloseTo(0.5 + (index + 1) * 0.1)
		}
		expect(surface.pointerDown(10, x - 1, y + 10)).toBe(false)
		expect(surface.pointerDown(11, x + width + 3, y + 10)).toBe(false)
	})
	it("draws the latest dial value while coalescing a high-rate pointer burst into one engine write", async () => {
		const dial = bind("cutoff"),
			saved = state()
		saved.widgets = [{ key: dial.key }]
		const surface = new ControlSurface({ state: saved, bindings: [dial], change: vi.fn() })
		views.push(surface)
		await settle()
		surface.pointerDown(1, 90, 100)
		for (let i = 0; i < 100; i++) {
			surface.pointerMove(1, 90, 100 - i / 2)
		}
		expect(dial.write).not.toHaveBeenCalled()
		const entry = (surface as unknown as { entries: { visual: { value: number } }[] })
			.entries[0]
		expect(entry.visual.value).toBeGreaterThan(0.8)
		await settle()
		expect(dial.write).toHaveBeenCalledTimes(1)
		expect(dial.value).toBe(entry.visual.value)
	})
	it("uses real pressure, ignores the unsupported-pressure sentinel, and clamps contact values", () => {
		expect(contactPressure(0.5, "mouse")).toBeUndefined()
		expect(contactPressure(0.5, "touch")).toBeUndefined()
		expect(contactPressure(0.25, "touch")).toBe(0.25)
		expect(contactPressure(0.5, "touch", true)).toBe(0.5)
		expect(contactPressure(0.5, "pen")).toBe(0.5)
		expect(contactPressure(2, "pen")).toBe(1)
	})
	it("tracks pad pressure independently and releases the final finger without leaving a held value", async () => {
		const a = bind("kick", { widget: "pad" }, 0),
			b = bind("snare", { widget: "pad" }, 0),
			saved = state()
		saved.widgets = [a, b].map((binding) => ({ key: binding.key }))
		const surface = new ControlSurface({ state: saved, bindings: [a, b], change: vi.fn() })
		views.push(surface)
		await settle()
		surface.pointerDown(1, 90, 90, false, 0.25)
		surface.pointerDown(2, 330, 90, false, 0.8)
		await settle()
		expect(a.value).toBe(0.25)
		expect(b.value).toBe(0.8)
		surface.pointerMove(1, 90, 90, false, 0.6)
		surface.pointerDown(3, 90, 90, false, 0.9)
		await settle()
		surface.pointerUp(3)
		await settle()
		expect(a.value).toBe(0.6)
		surface.pointerUp(1)
		await settle()
		expect(a.value).toBe(0)
		expect(b.value).toBe(0.8)
		window.dispatchEvent(new Event(EVENT_BLUR))
		await settle()
		expect(b.value).toBe(0)
	})
	it("preserves quick pad hits and their releases while an asynchronous write is pending", async () => {
		const pad = bind("hit", { widget: "pad" }, 0),
			saved = state()
		let complete!: () => void
		pad.write.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					complete = resolve
				})
		)
		saved.widgets = [{ key: pad.key }]
		const surface = new ControlSurface({ state: saved, bindings: [pad], change: vi.fn() })
		views.push(surface)
		await settle()
		surface.pointerDown(1, 90, 90, false, 0.3)
		surface.pointerMove(1, 90, 90, false, 0.7)
		surface.pointerUp(1)
		surface.pointerDown(2, 90, 90, false, 0.8)
		surface.pointerUp(2)
		complete()
		await settle()
		expect(pad.write.mock.calls.map(([value]) => value)).toEqual([0.3, 0, 0.8, 0])
	})
	it("supports momentary pad keys, ignores key repeat, and releases on focus loss", async () => {
		const pad = bind("hit", { widget: "pad" }, 0),
			saved = state()
		saved.widgets = [{ key: pad.key }]
		const surface = new ControlSurface({ state: saved, bindings: [pad], change: vi.fn() })
		views.push(surface)
		document.body.append(surface.element)
		await settle()
		const button = surface.element.querySelector<HTMLButtonElement>(".cs-pad button")!
		button.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: " " }))
		button.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: " ", repeat: true }))
		await settle()
		expect(pad.value).toBe(1)
		expect(pad.write).toHaveBeenCalledTimes(1)
		button.dispatchEvent(new KeyboardEvent(EVENT_KEY_UP, { key: " " }))
		await settle()
		expect(pad.value).toBe(0)
		button.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: "Enter" }))
		button.dispatchEvent(new Event(EVENT_BLUR))
		await settle()
		expect(pad.value).toBe(0)
	})
	it("sends pad release after an in-flight write when the surface is destroyed", async () => {
		const pad = bind("hit", { widget: "pad" }, 0),
			saved = state()
		let complete!: () => void
		pad.write.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					complete = resolve
				})
		)
		saved.widgets = [{ key: pad.key }]
		const surface = new ControlSurface({ state: saved, bindings: [pad], change: vi.fn() })
		await settle()
		surface.pointerDown(1, 90, 90, false, 0.5)
		surface.destroy()
		complete()
		await settle()
		expect(pad.write.mock.calls.map(([value]) => value)).toEqual([0.5, 0])
	})
	it("does not lose repeated trigger actions while an earlier write is pending", async () => {
		const trigger = bind("fill", { widget: "button" }, 0),
			saved = state()
		saved.widgets = [{ key: trigger.key }]
		const surface = new ControlSurface({ state: saved, bindings: [trigger], change: vi.fn() })
		views.push(surface)
		await settle()
		for (let id = 1; id <= 3; id++) {
			surface.pointerDown(id, 90, 90)
			surface.pointerUp(id)
		}
		await settle()
		expect(trigger.write).toHaveBeenCalledTimes(3)
	})
	it("supports concurrent pointers on different controls, cancellation, and typed radio choices", async () => {
		const a = bind("cutoff"),
			b = bind("density", { widget: "slider" }),
			radio = bind(
				"wave",
				{
					widget: "radio",
					choices: [
						{ label: "Saw", value: 0 },
						{ label: "Square", value: 1 }
					]
				},
				0
			)
		const saved = state()
		saved.widgets = [a, b, radio].map((binding) => ({ key: binding.key }))
		const surface = new ControlSurface({
			state: saved,
			bindings: [a, b, radio],
			change: vi.fn()
		})
		views.push(surface)
		document.body.append(surface.element)
		await settle()
		expect(surface.pointerDown(1, 100, 90)).toBe(true)
		surface.pointerMove(1, 100, 58)
		expect(surface.pointerDown(2, 330, 90)).toBe(true)
		surface.pointerMove(2, 380, 90)
		surface.pointerUp(1)
		surface.pointerUp(2)
		await settle()
		expect(a.value).toBeGreaterThan(0.5)
		expect(b.value).toBeGreaterThan(0.5)
		const calls = a.write.mock.calls.length
		surface.pointerMove(1, 100, 50)
		await settle()
		expect(a.write).toHaveBeenCalledTimes(calls)
		surface.pointerDown(3, 590, 90)
		surface.pointerUp(3)
		await settle()
		expect(radio.value).toBe(1)
	})
	it("keeps saved unavailable controls visible and provides semantic controls when WebGPU fails", async () => {
		const saved = state()
		saved.widgets = [{ key: "missing" }]
		const surface = new ControlSurface({ state: saved, bindings: [], change: vi.fn() })
		views.push(surface)
		document.body.append(surface.element)
		await settle()
		expect(surface.element.textContent).toContain("Unavailable control")
		expect(surface.element.textContent).toContain("No test GPU")
		expect(saved.widgets).toEqual([{ key: "missing" }])
	})
	it("creates a cross-component XY pad and writes both mapped parameters", async () => {
		const a = bind("cutoff", { min: 20, max: 20000, scale: "log" }, 200),
			b = bind("density")
		const saved = state()
		saved.widgets = [{ key: a.key, yKey: b.key, widget: "xy", span: 2 }]
		const surface = new ControlSurface({ state: saved, bindings: [a, b], change: vi.fn() })
		views.push(surface)
		document.body.append(surface.element)
		await settle()
		surface.pointerDown(4, 360, 60)
		surface.pointerUp(4)
		await settle()
		expect(a.value).toBeGreaterThan(1000)
		expect(b.value).toBeGreaterThan(0.5)
	})
})

describe("graph control connections", () => {
	function chain() {
		const output = {
			name: "Synth",
			getUiDescriptor: () => ({
				controls: [{ id: "cutoff", label: "Cutoff", widget: "dial", min: 20, max: 20000 }]
			}),
			getControlValue: () => 100,
			setControlValue: vi.fn()
		}
		const componentId = deviceId(output),
			s = state()
		s.connections = [{ componentId, controlIds: ["cutoff"] }]
		s.widgets = [{ key: bindingKey(componentId, "cutoff") }]
		const chain: any = {
			inputs: [],
			outputs: [output],
			transformers: [],
			options: { controlSurfaces: [s] },
			removeOutput: vi.fn(),
			setGraphOptions(options: any) {
				Object.assign(this.options, options)
			}
		}
		return { chain, output, componentId }
	}
	it("places surfaces beyond Outputs with dedicated control edges and only detaches bindings", () => {
		const { chain, componentId } = chainFixture()
		const { nodes, edges } = getStructure(chain, true, true, "horizontal")
		const surface = nodes.find((n) => n.type === "controlSurface")!,
			output = nodes.find((n) => n.type === "output")!
		expect(surface.position.x).toBeGreaterThan(output.position.x)
		expect(edges.find((e) => e.target === surface.id)).toMatchObject({
			sourceHandle: CONTROL_HANDLE,
			targetHandle: SURFACE_HANDLE,
			data: { controlSurfaceId: "surface", componentId }
		})
		disconnectSurface(chain, "surface", componentId)
		expect(chain.options.controlSurfaces[0].widgets).toEqual([])
		expect(chain.outputs).toHaveLength(1)
		expect(chain.removeOutput).not.toHaveBeenCalled()
	})
	const chainFixture = chain
	it("only commits control selections when Apply is pressed", async () => {
		const { chain, componentId } = chainFixture()
		const original = structuredClone(chain.options.controlSurfaces)
		const dialog = selectSurfaceControls(chain, "surface", componentId)
		views.push(dialog)
		await settle()
		const checkbox = document.querySelector<HTMLInputElement>('dialog input[type="checkbox"]')!
		expect(checkbox.checked).toBe(true)
		checkbox.checked = false
		expect(chain.options.controlSurfaces).toEqual(original)
		document
			.querySelector("dialog form")!
			.dispatchEvent(new Event("submit", { cancelable: true }))
		expect(chain.options.controlSurfaces[0].connections).toEqual([])
	})
	it("validates saved surface state and projects XR rays into local panel coordinates", () => {
		expect(validSurfaces([state()])).toBe(true)
		expect(validSurfaces([{ ...state(), widgets: [{ key: "bad", span: -10 }] }])).toBe(false)
		const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
		expect(intersectPanel(identity, 600, 300)).toEqual({ x: 300, y: 150 })
		expect(multiplyMatrices(identity, identity)).toEqual(identity)
	})
	it("ends an XR session and releases input if a frame cannot be rendered", async () => {
		let frameCallback: ((time: number, frame: any) => void) | undefined
		const session = Object.assign(new EventTarget(), {
			inputSources: [],
			requestReferenceSpace: async () => ({}),
			updateRenderState: vi.fn(),
			requestAnimationFrame: vi.fn((callback) => {
				frameCallback = callback
				return 1
			}),
			end: vi.fn(async () => {})
		})
		vi.stubGlobal("navigator", { xr: { requestSession: vi.fn(async () => session) } })
		vi.stubGlobal(
			"XRGPUBinding",
			class {
				getPreferredColorFormat() {
					return "bgra8unorm"
				}
				createProjectionLayer() {
					return {}
				}
			}
		)
		const ended = vi.fn(),
			failed = vi.fn(),
			renderer = { device: {}, format: "bgra8unorm", setFormat: vi.fn(async () => {}) }
		await startSurfaceXR(
			renderer as any,
			() => ({ widgets: [], width: 600, height: 300 }),
			{ pointerDown: vi.fn(), pointerMove: vi.fn(), pointerUp: vi.fn() },
			ended,
			failed
		)
		frameCallback!(0, {
			getViewerPose() {
				throw new Error("Tracking failed")
			}
		})
		await settle()
		expect(failed).toHaveBeenCalledOnce()
		expect(ended).toHaveBeenCalledOnce()
		expect(session.end).toHaveBeenCalledOnce()
	})
})