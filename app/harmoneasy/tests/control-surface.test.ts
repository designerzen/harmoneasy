// @vitest-environment happy-dom
import { PadLight, noteColor } from "../../../packages/control-surface/src/pad"
import { beatPulse } from "../../../packages/control-surface/src/beat"
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
import { musicRect, musicView } from "../../../packages/control-surface/src/music"
import { resizeMusicGrid } from "../../../packages/control-surface/src/music-dom"
import { sourceTheme } from "../../../packages/control-surface/src/themes"
import { createDomGui, createDomControl } from "control-surface/dom"
import { contactPressure } from "../../../packages/control-surface/src/pressure"
import { addKeyboardDownEvents } from "../../../packages/audiobus/hardware/keyboard/keyboard"
import { NOTE_ON, NOTE_OFF } from "../../../packages/audiobus/commands"
import {
	EVENT_BLUR,
	EVENT_KEY_DOWN,
	EVENT_KEY_UP,
	EVENT_POINTER_DOWN,
	EVENT_POINTER_MOVE,
	EVENT_POINTER_UP,
	EVENT_POINTER_CANCEL
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
	ergonomicOrder,
	playingLayout
} from "control-surface/model"
import type { ControlBinding, ControlDescriptor, SurfaceState } from "control-surface/types"
import { componentBindings, installComponentUi } from "audiobus/io/component-ui"
import { TransformerQuantise } from "audiobus/io/transformers/transformer-quantise"
import {
	surfaceBeat,
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
	it.each([
		"dial",
		"slider",
		"rotation",
		"toggle",
		"radio",
		"select",
		"xy",
		"range",
		"button",
		"pad",
		"color",
		"piano-roll",
		"guitar-tab",
		"relative-keys",
		"strum"
	] as const)(
		"keeps musical keys playing after focusing a %s gadget, with Escape returning to play",
		async (widget) => {
			const binding = bind(
				"control",
				{
					widget,
					choices: [
						{ label: "First", value: 0 },
						{ label: "Second", value: 1 }
					]
				},
				["xy", "range"].includes(widget)
					? [0.2, 0.8]
					: ["piano-roll", "guitar-tab", "relative-keys", "strum"].includes(widget)
						? []
						: widget === "color"
							? "#33ffb8"
							: widget === "toggle"
								? false
								: 0
			)
			const saved = state()
			saved.widgets = [{ key: binding.key }]
			const surface = new ControlSurface({
				state: saved,
				bindings: [binding],
				change: vi.fn()
			})
			views.push(surface)
			document.body.append(surface.element)
			await settle()
			const command = vi.fn()
			views.push({ destroy: addKeyboardDownEvents(command) })
			const panel = surface.element.querySelector<HTMLElement>(".cs-widget")!
			const controls = [...panel.querySelectorAll<HTMLElement>("input, select, button")]
			// Include the whole-panel pointer focus target used by dials and rotations.
			if (panel.tabIndex === -1) {
				controls.push(panel)
			}
			expect(controls.length).toBeGreaterThan(0)
			for (const control of controls) {
				control.focus()
				expect(document.activeElement).toBe(control)
				control.dispatchEvent(
					new KeyboardEvent(EVENT_KEY_DOWN, {
						key: "q",
						code: "KeyQ",
						bubbles: true,
						cancelable: true
					})
				)
				expect(command.mock.lastCall?.slice(0, 3)).toEqual([NOTE_ON, "q", 41])
				control.dispatchEvent(
					new KeyboardEvent(EVENT_KEY_DOWN, {
						key: "Escape",
						bubbles: true,
						cancelable: true
					})
				)
				expect(document.activeElement).toBe(surface.element.querySelector(".cs-viewport"))
				// Changing focus must neither stop transport nor lose the held key release.
				expect(command.mock.lastCall?.[0]).toBe(NOTE_ON)
				document.activeElement!.dispatchEvent(
					new KeyboardEvent(EVENT_KEY_UP, { key: "q", code: "KeyQ", bubbles: true })
				)
				expect(command.mock.lastCall?.slice(0, 3)).toEqual([NOTE_OFF, "q", 41])
			}
			expect(command.mock.calls).toHaveLength(controls.length * 2)
		}
	)
	it("preserves text and numeric editing, then restores notes with Escape, including external toolbars", async () => {
		const bindings = [
			bind("text", { widget: "text" }, "Patch"),
			bind("number", { widget: "number" }, 0.5)
		]
		const saved = state()
		saved.widgets = bindings.map(({ key }) => ({ key }))
		const toolbarHost = document.body.appendChild(document.createElement("header"))
		const surface = new ControlSurface({ state: saved, bindings, toolbarHost, change: vi.fn() })
		views.push(surface)
		document.body.append(surface.element)
		await settle()
		const command = vi.fn()
		views.push({ destroy: addKeyboardDownEvents(command) })
		const name = toolbarHost.querySelector<HTMLInputElement>(".cs-title")!
		for (const input of [
			...surface.element.querySelectorAll<HTMLInputElement>("input"),
			name
		]) {
			input.focus()
			for (const key of ["q", "2", "ArrowUp", "Enter", " "]) {
				input.dispatchEvent(
					new KeyboardEvent(EVENT_KEY_DOWN, { key, bubbles: true, cancelable: true })
				)
			}
			expect(command).not.toHaveBeenCalled()
			input.focus()
			input.dispatchEvent(
				new KeyboardEvent(EVENT_KEY_DOWN, {
					key: "Escape",
					bubbles: true,
					cancelable: true
				})
			)
			expect(document.activeElement).toBe(surface.element.querySelector(".cs-viewport"))
		}
		name.focus()
		name.value = "Unsaved"
		name.dispatchEvent(
			new KeyboardEvent(EVENT_KEY_DOWN, { key: "Escape", bubbles: true, cancelable: true })
		)
		expect(name.value).toBe(saved.name)
		const edit = toolbarHost.querySelector<HTMLButtonElement>("button")!
		edit.focus()
		edit.dispatchEvent(
			new KeyboardEvent(EVENT_KEY_DOWN, { key: "q", bubbles: true, cancelable: true })
		)
		expect(command.mock.lastCall?.slice(0, 3)).toEqual([NOTE_ON, "q", 41])
		edit.dispatchEvent(
			new KeyboardEvent(EVENT_KEY_DOWN, { key: "Escape", bubbles: true, cancelable: true })
		)
		expect(document.activeElement).toBe(surface.element.querySelector(".cs-viewport"))
	})
	it("keeps activation and navigation local and respects keys consumed by musical editors", async () => {
		const binding = bind("tab", createGuitarTabControl({ id: "tab", label: "Tab" }), [])
		const saved = state()
		saved.widgets = [{ key: binding.key }]
		const surface = new ControlSurface({ state: saved, bindings: [binding], change: vi.fn() })
		views.push(surface)
		document.body.append(surface.element)
		await settle()
		const command = vi.fn()
		views.push({ destroy: addKeyboardDownEvents(command) })
		const cell = surface.element.querySelector<HTMLButtonElement>(".cs-widget button")!
		cell.focus()
		for (const key of ["2", "Delete", "ArrowRight", " ", "Enter", "Home", "End"]) {
			document.activeElement!.dispatchEvent(
				new KeyboardEvent(EVENT_KEY_DOWN, { key, bubbles: true, cancelable: true })
			)
		}
		expect(command).not.toHaveBeenCalled()
	})
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
	it("lights pads by pitch and velocity with a longer decay for stronger strikes", () => {
		expect(noteColor(60)).toEqual(noteColor(72))
		expect(noteColor(60)[0]).toBeCloseTo(0.72)
		expect(noteColor(60)[1]).toBeCloseTo(0.08)
		expect(noteColor(67)).not.toEqual(noteColor(60))
		const soft = new PadLight(),
			hard = new PadLight()
		soft.set(0.25, 1)
		hard.set(0.9, 1)
		expect(hard.intensity(2)).toBe(0.9)
		expect(soft.intensity(2)).toBe(0.25)
		soft.set(0, 2)
		hard.set(0, 2)
		expect(hard.duration).toBeGreaterThan(soft.duration)
		expect(soft.intensity(2.4)).toBe(0)
		expect(hard.intensity(2.4)).toBeGreaterThan(0)
		expect(hard.intensity(3)).toBe(0)
		expect(hard.intensity(2.1, false)).toBe(0)
		hard.set(0.4, 3)
		expect(hard.intensity(3)).toBe(0.4)
		expect(hard.releasedAt).toBe(-1)
	})
	it("follows transport beats and stops cues when playback stops or motion is reduced", () => {
		const timer = {
			isRunning: true,
			BPM: 120,
			barsElapsed: 0,
			totalBars: 4,
			bar: 2,
			beatProgress: 0,
			totalDivisions: 24,
			timeElapsed: 1000,
			clockUnitsToSecondsScale: 0.001,
			lastRecordedTime: 1
		}
		expect(surfaceBeat(timer)).toBe(2)
		expect(beatPulse(surfaceBeat(timer))).toBe(0.3)
		timer.timeElapsed = 1010
		expect(surfaceBeat(timer)).toBeCloseTo(2.02)
		expect(beatPulse(surfaceBeat(timer))).toBeLessThan(0.3)
		timer.BPM = 60
		expect(surfaceBeat(timer)).toBeCloseTo(2.01)
		timer.timeElapsed = 9000
		expect(surfaceBeat(timer)).toBeCloseTo(2 + 1 / 24)
		timer.isRunning = false
		expect(surfaceBeat(timer)).toBeUndefined()
		expect(beatPulse(undefined)).toBe(0)
		expect(beatPulse(2, false)).toBe(0)
		expect(beatPulse(NaN)).toBe(0)
		expect(beatPulse(3)).toBe(0.3)
		expect(beatPulse(2.5)).toBeLessThan(0.001)
	})
	it("defaults to note data and cycles backgrounds without releasing held controls", async () => {
		const pad = bind("strike", { widget: "pad" }, 0),
			saved = state()
		saved.widgets = [{ key: pad.key }]
		const surface = new ControlSurface({
			state: saved,
			bindings: [pad],
			visualiserSources: [
				{
					id: "notes",
					label: "Note data",
					kinds: ["notes"],
					read: () => ({ samples: new Float32Array(128), level: 0 })
				},
				{
					id: "audio",
					label: "Synth audio",
					kinds: ["waveform", "spectrum"],
					read: () => ({ samples: new Float32Array(128), level: 0 })
				}
			],
			change: vi.fn()
		})
		views.push(surface)
		expect(saved.background).toMatchObject({ sourceId: "notes", kind: "notes" })
		const entry = (surface as any).entries[0]
		expect(surface.pointerDown(900, entry.visual.x + 20, entry.visual.y + 40, false, 0.8)).toBe(
			true
		)
		const cycle = surface.element.querySelector<HTMLButtonElement>(
			'[aria-label="Switch visualiser"]'
		)!
		cycle.click()
		expect(saved.background).toMatchObject({ sourceId: "audio", kind: "waveform" })
		expect((surface as any).gestures.size).toBe(1)
		cycle.click()
		expect(saved.background).toMatchObject({ kind: "spectrum" })
		// Two parameter-history choices follow the audio views, then off and back to notes.
		cycle.click()
		cycle.click()
		cycle.click()
		expect(saved.background).toBeNull()
		cycle.click()
		expect(saved.background).toMatchObject({ kind: "notes" })
		surface.pointerUp(900)
		await settle()
		expect(pad.value).toBe(0)
	})
	it("keeps parameter sources connected when only their visualiser remains", () => {
		const binding = bind("cutoff"),
			saved = state()
		saved.connections = [{ componentId: "synth", controlIds: ["cutoff"] }]
		saved.widgets = [
			{
				key: "history",
				widget: "visualiser",
				visualiser: { sourceId: `control:${binding.key}`, kind: "history" }
			}
		]
		const surface = new ControlSurface({ state: saved, bindings: [binding], change: vi.fn() })
		views.push(surface)
		;(surface as any).save()
		expect(saved.connections).toEqual([{ componentId: "synth", controlIds: ["cutoff"] }])
		saved.background = { sourceId: `control:${binding.key}`, kind: "level" }
		saved.widgets = []
		;(surface as any).save()
		expect(saved.connections).toHaveLength(1)
	})
	it("keeps musical targets at least 44 pixels with 11 pixel gaps when resized or zoomed", () => {
		for (const scale of [0.5, 1, 2, 3]) {
			for (const width of [280, 390, 700]) {
				const height = 46 + 200 / scale,
					rect = musicRect(width, height, scale),
					view = musicView(width, height, 12, 8, scale)
				expect(
					((rect.width + view.gap) / view.columns - view.gap) * scale
				).toBeGreaterThanOrEqual(43.999)
				expect(
					((rect.height + view.gap) / view.rows - view.gap) * scale
				).toBeGreaterThanOrEqual(43.999)
				expect(view.gap * scale).toBe(11)
			}
		}
		const control = createDomControl(
			bind("roll", createPianoRollControl({ id: "roll", label: "Roll" })),
			vi.fn()
		)
		const grid = control.element.querySelector<HTMLElement>('[role="grid"]')!
		const view = resizeMusicGrid(grid, 300, 260, 1)!
		expect(view.columns).toBeLessThan(8)
		expect(grid.querySelectorAll('[role="row"]:not([hidden])').length).toBe(view.rows)
		control.element
			.querySelector<HTMLButtonElement>('[aria-label="Next section of Roll"]')!
			.click()
		expect(view.column).toBe(view.columns)
		expect(grid.querySelector('[role="gridcell"]')!.hasAttribute("hidden")).toBe(true)
	})
	it("paginates all gadgets within bounded pages without overlaps", () => {
		const widgets = Array.from({ length: 75 }, (_, i) => ({
			span: (i % 3) + 1,
			height: 132 + i * 13,
			column: i % 7 === 0 ? 1 : undefined
		}))
		for (const width of [280, 390, 900, 1200]) {
			for (const height of [100, 300, 700]) {
				const layout = layoutWidgets(widgets, width, width, height)
				expect(layout.items).toHaveLength(widgets.length)
				expect(layout.pages).toBeGreaterThan(1)
				for (const [i, a] of layout.items.entries()) {
					expect(a.y + a.height).toBeLessThanOrEqual(height)
					expect(a.x + a.width).toBeLessThanOrEqual(width + 0.001)
					for (const b of layout.items.slice(i + 1).filter((b) => b.page === a.page)) {
						expect(
							a.x < b.x + b.width &&
								a.x + a.width > b.x &&
								a.y < b.y + b.height &&
								a.y + a.height > b.y
						).toBe(false)
					}
				}
			}
		}
	})
	it("fills sparse pages, balances hand zones, and distributes spare height without widening gaps", () => {
		expect(layoutWidgets([{}], 900, 900, 600).items[0]).toMatchObject({
			x: 0,
			y: 0,
			width: 900,
			height: 600
		})
		const pair = layoutWidgets([{}, {}], 900, 900, 600)
		expect(pair.items).toMatchObject([
			{ x: 0, y: 0, width: 438, height: 600 },
			{ x: 462, y: 0, width: 438, height: 600 }
		])
		const grid = layoutWidgets(
			Array.from({ length: 8 }, () => ({})),
			900,
			900,
			600
		)
		expect(grid.pages).toBe(1)
		expect(grid.height).toBe(600)
		for (const item of grid.items) {
			expect(item.height).toBeCloseTo((600 - 11) / 2)
		}
		expect(grid.items[4].y - grid.items[0].height).toBeCloseTo(11)
		expect(grid.items[3].x + grid.items[3].width).toBeCloseTo(900)
		expect(grid.items[7].y + grid.items[7].height).toBeCloseTo(600)
	})
	it("allows 44px simple gadgets and retains that physical minimum when zoomed", () => {
		for (const scale of [0.5, 1, 2]) {
			const gap = 11 / Math.min(1, scale)
			const height = 44 / scale
			const widgets = [
				"dial",
				"slider",
				"toggle",
				"pad",
				"text",
				"number",
				"color",
				"meter",
				"display"
			].map((widget) => ({ widget, height }))
			const layout = layoutWidgets(
				widgets,
				280 / scale,
				280,
				height * widgets.length + gap * (widgets.length - 1),
				scale
			)
			expect(layout.pages).toBe(1)
			for (const item of layout.items) {
				expect(item.height * scale).toBeCloseTo(44)
				expect(item.width * scale).toBeGreaterThanOrEqual(44)
			}
		}
	})
	it("compacts default sizes to fit more controls while respecting manually chosen sizes", () => {
		const widgets = Array.from({ length: 12 }, () => ({ widget: "dial", height: 172 }))
		expect(layoutWidgets(widgets, 900, 900, 500).pages).toBe(2)
		const compact = layoutWidgets(
			widgets.map((widget) => ({ ...widget, flexible: true })),
			900,
			900,
			500
		)
		expect(compact.pages).toBe(1)
		expect(compact.items.every((item) => item.height >= 132)).toBe(true)
		const fields = layoutWidgets(
			Array.from({ length: 6 }, () => ({ widget: "number", height: 100 })),
			390,
			390,
			340
		)
		expect(fields.pages).toBe(1)
		expect(fields.items.every((item) => item.height >= 100)).toBe(true)
	})
	it("fills masonry holes while preserving requested size proportions and scaled target gaps", () => {
		for (const scale of [0.5, 1, 2]) {
			const layout = layoutWidgets(
				[{ height: 300 }, { height: 132 }, { span: 2, height: 200 }],
				500,
				500,
				700,
				scale
			)
			expect(layout.pages).toBe(1)
			const [left, right, bottom] = layout.items
			expect(left.height).toBeCloseTo(right.height)
			expect(left.width + right.width + 11 / Math.min(1, scale)).toBeCloseTo(500)
			expect(bottom.width).toBe(500)
			expect(bottom.y - left.height).toBeCloseTo(11 / Math.min(1, scale))
			expect(bottom.y + bottom.height).toBeCloseTo(700)
			expect(left.height / bottom.height).toBeCloseTo(300 / 200)
		}
	})
	it("keeps a physical gap between all packed faces after filling irregular pages", () => {
		const widgets = Array.from({ length: 35 }, (_, i) => ({
			span: 1 + (i % 3),
			height: 132 + ((i * 71) % 400)
		}))
		for (const width of [280, 390, 900, 1200]) {
			for (const scale of [0.5, 1, 2]) {
				const layout = layoutWidgets(widgets, width, width, 700 / scale, scale)
				for (const [i, a] of layout.items.entries()) {
					for (const b of layout.items.slice(i + 1).filter((b) => b.page === a.page)) {
						const dx = Math.max(0, a.x - b.x - b.width, b.x - a.x - a.width)
						const dy = Math.max(0, a.y - b.y - b.height, b.y - a.y - a.height)
						expect(Math.hypot(dx, dy) * scale).toBeGreaterThanOrEqual(10.999)
					}
				}
				expect(layoutWidgets(widgets, width, width, 700 / scale, scale)).toEqual(layout)
			}
		}
	})
	it("adapts hand zones to visible width and keeps large gadgets inside their playing zone", () => {
		expect(playingLayout(300)).toMatchObject({ hands: 1, columns: 1, gutter: 0 })
		expect(playingLayout(390)).toMatchObject({ hands: 1, columns: 2 })
		expect(playingLayout(900)).toMatchObject({ hands: 2, columns: 4, gutter: 24 })
		expect(playingLayout(1200)).toMatchObject({ hands: 2, columns: 6 })
		expect(playingLayout(1100, 390)).toMatchObject({ hands: 1, columns: 2 })
		const layout = layoutWidgets(
			[
				{ span: 2, height: 280 },
				{ span: 2, height: 280 }
			],
			900
		)
		expect(layout.items[0].y).toBe(0)
		expect(layout.items[1].y).toBe(0)
		expect(layout.items[1].x - layout.items[0].width).toBeGreaterThanOrEqual(24)
	})
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
				for (const b of layout.items.slice(i + 1)) {
					expect(
						a.x < b.x + b.width &&
							a.x + a.width > b.x &&
							a.y < b.y + b.height &&
							a.y + a.height > b.y
					).toBe(false)
				}
			}
			expect(layoutWidgets(widgets, width)).toEqual(layout)
		}
		const holes = layoutWidgets(
			[{ height: 300 }, { height: 132 }, { span: 2, height: 200 }, { height: 132 }],
			500
		)
		expect(holes.items[3]).toMatchObject({ y: 143, x: 250 })
		const pinned = layoutWidgets([{ column: 2 }, { column: 2 }], 640)
		expect(pinned.items[1].y).toBe(183)
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
		expect(
			layoutWidgets(
				order.map((index) => widgets[index]),
				640
			).height
		).toBeLessThanOrEqual(layoutWidgets(widgets, 640).height)
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
	it("keeps corner resize grips available and reflows neighbours during mouse dragging", async () => {
		const bindings = [bind("a"), bind("b"), bind("c")],
			saved = state(),
			change = vi.fn()
		saved.widgets = bindings.map(({ key }) => ({ key }))
		const surface = new ControlSurface({ state: saved, bindings, change })
		views.push(surface)
		document.body.append(surface.element)
		await settle()
		;[...surface.element.querySelectorAll<HTMLButtonElement>("button")]
			.find((button) => button.textContent === "Edit layout")!
			.click()
		const handle = surface.element.querySelector<HTMLButtonElement>(".cs-resize-handle")!
		handle.setPointerCapture = vi.fn()
		expect(handle.closest(".cs-widget-tools")).toBeNull()
		expect(handle.getAttribute("aria-label")).toBe("Resize a")
		const before = (surface as any).entries.map((entry: any) => ({ ...entry.visual }))
		handle.dispatchEvent(
			new PointerEvent(EVENT_POINTER_DOWN, {
				pointerId: 1,
				button: 0,
				clientX: 100,
				clientY: 100,
				bubbles: true
			})
		)
		handle.dispatchEvent(
			new PointerEvent(EVENT_POINTER_MOVE, {
				pointerId: 1,
				clientX: 440,
				clientY: 130,
				bubbles: true
			})
		)
		expect(saved.widgets[0]).toMatchObject({ span: 3, height: 202 })
		expect((surface as any).entries[0].visual.width).not.toBe(before[0].width)
		expect((surface as any).entries[1].visual.x).not.toBe(before[1].x)
		handle.dispatchEvent(new PointerEvent(EVENT_POINTER_UP, { pointerId: 1, bubbles: true }))
		expect(change).toHaveBeenCalledWith(saved)
	})
	it("allows resizing only while the external titlebar edit toggle is on", async () => {
		const toolbarHost = document.body.appendChild(document.createElement("header"))
		const binding = bind("a"),
			saved = state(),
			change = vi.fn()
		saved.widgets = [{ key: binding.key }]
		const surface = new ControlSurface({
			state: saved,
			bindings: [binding],
			toolbarHost,
			change
		})
		views.push(surface)
		document.body.append(surface.element)
		await settle()
		const toggle = toolbarHost.querySelector<HTMLButtonElement>("button[aria-pressed]")!
		expect(toggle.getAttribute("aria-pressed")).toBe("false")
		expect(surface.element.querySelector(".cs-resize-handle")).toBeNull()
		toggle.click()
		expect(toggle.getAttribute("aria-pressed")).toBe("true")
		const handle = surface.element.querySelector<HTMLButtonElement>(".cs-resize-handle")!
		handle.setPointerCapture = vi.fn()
		handle.dispatchEvent(
			new PointerEvent(EVENT_POINTER_DOWN, {
				pointerId: 7,
				button: 0,
				clientX: 100,
				clientY: 100,
				bubbles: true
			})
		)
		handle.dispatchEvent(
			new PointerEvent(EVENT_POINTER_MOVE, {
				pointerId: 7,
				clientX: 300,
				clientY: 130,
				bubbles: true
			})
		)
		expect(saved.widgets[0].height).toBe(202)
		toggle.click()
		expect(toggle.getAttribute("aria-pressed")).toBe("false")
		expect(surface.element.classList.contains("cs-editing")).toBe(false)
		expect(surface.element.querySelector(".cs-resize-handle")).toBeNull()
		expect(saved.widgets[0]).toEqual({ key: binding.key })
		handle.dispatchEvent(
			new PointerEvent(EVENT_POINTER_MOVE, { pointerId: 7, clientX: 400, clientY: 200 })
		)
		handle.dispatchEvent(new PointerEvent(EVENT_POINTER_UP, { pointerId: 7 }))
		handle.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: "ArrowDown" }))
		handle.click()
		expect(saved.widgets[0]).toEqual({ key: binding.key })
		expect(change).not.toHaveBeenCalled()
		expect(document.querySelector("dialog")).toBeNull()
	})
	it("restores automatic sizing when a resize drag is cancelled", async () => {
		const binding = bind("a"),
			saved = state(),
			change = vi.fn()
		saved.widgets = [{ key: binding.key }]
		const surface = new ControlSurface({ state: saved, bindings: [binding], change })
		views.push(surface)
		document.body.append(surface.element)
		await settle()
		;[...surface.element.querySelectorAll<HTMLButtonElement>("button")]
			.find((button) => button.textContent === "Edit layout")!
			.click()
		const handle = surface.element.querySelector<HTMLButtonElement>(".cs-resize-handle")!
		handle.setPointerCapture = vi.fn()
		handle.dispatchEvent(
			new PointerEvent(EVENT_POINTER_DOWN, {
				pointerId: 2,
				button: 0,
				clientX: 100,
				clientY: 100,
				bubbles: true
			})
		)
		handle.dispatchEvent(
			new PointerEvent(EVENT_POINTER_MOVE, {
				pointerId: 2,
				clientX: 300,
				clientY: 130,
				bubbles: true
			})
		)
		handle.dispatchEvent(
			new PointerEvent(EVENT_POINTER_CANCEL, { pointerId: 2, bubbles: true })
		)
		expect(saved.widgets[0]).toEqual({ key: binding.key })
		expect(change).not.toHaveBeenCalled()
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
		saved.widgets[1].span = 6
		expect(validSurfaces([saved])).toBe(true)
		saved.widgets[1].span = 7
		expect(validSurfaces([saved])).toBe(false)
		saved.widgets[1].span = 2
		saved.widgets[1].height = Infinity
		expect(validSurfaces([saved])).toBe(false)
		const layout = layoutWidgets(
			[{ height: 250 }, { height: 400 }, { height: 132 }, { height: 200 }],
			640
		)
		expect(layout.items[3].y).toBe(0)
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
	it("keeps the colour key at the very bottom and reserves its space without a hand-layout description", async () => {
		const binding = bind("a"),
			saved = state()
		saved.widgets = [{ key: binding.key }]
		const surface = new ControlSurface({ state: saved, bindings: [binding], change: vi.fn() })
		views.push(surface)
		document.body.append(surface.element)
		await settle()
		const key = surface.element.querySelector<HTMLElement>(".cs-source-key")!
		expect(surface.element.lastElementChild).toBe(key)
		expect(key.getAttribute("aria-label")).toBe("Control sources")
		expect(key.textContent).toBe("Synth")
		expect(surface.element.querySelector(".cs-play-guide")).toBeNull()
		const before = (surface as any).pageHeight
		vi.spyOn(key, "getBoundingClientRect").mockReturnValue({ height: 40 } as DOMRect)
		;(surface as any).layout()
		expect((surface as any).pageHeight).toBeCloseTo(before - 48)
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
			addControls: [{ label: "Add Synth controls…", action: addControls }],
			menuActions: () => [
				{ label: "Open another surface", action: vi.fn() },
				{ label: "Remove control surface", editOnly: true, action: vi.fn() }
			]
		})
		views.push(surface)
		const name = toolbarHost.querySelector<HTMLInputElement>(".cs-title")!
		expect(name.hidden).toBe(false)
		expect(name.readOnly).toBe(true)
		const edit = toolbarHost.querySelector<HTMLButtonElement>("button")!
		const add = [...toolbarHost.querySelectorAll<HTMLButtonElement>("button")].find(
			(button) => button.textContent === "+ Add"
		)!
		expect(add.hidden).toBe(true)
		expect(edit.textContent).toBe("Edit layout")
		edit.click()
		expect(surface.isEditing).toBe(true)
		expect(name.readOnly).toBe(false)
		expect(add.hidden).toBe(false)
		name.value = "  My performance  "
		name.dispatchEvent(new Event("change"))
		expect(saved.name).toBe("My performance")
		expect(change).toHaveBeenCalledWith(saved)
		name.value = "   "
		name.dispatchEvent(new Event("change"))
		expect(name.value).toBe("My performance")
		const buttons = [...toolbarHost.querySelectorAll<HTMLButtonElement>("button")]
		expect(buttons[0].textContent).toBe("Perform")
		expect(toolbarHost.querySelector(".cs-toolbar")!.lastElementChild!.textContent).toBe(
			"Enter VR"
		)
		expect(
			toolbarHost.querySelector(".cs-toolbar")!.children[1].classList.contains("cs-settings")
		).toBe(true)
		const settings = toolbarHost.querySelector<HTMLButtonElement>(
			'[aria-label="Surface settings"]'
		)!
		const menu = toolbarHost.querySelector<HTMLElement>(".cs-settings-menu")!
		expect(menu.hidden).toBe(true)
		settings.click()
		expect(menu.hidden).toBe(false)
		expect(menu.querySelector('[aria-label="Surface theme"]')).not.toBeNull()
		expect(menu.textContent).not.toContain("Add Synth")
		expect(menu.textContent).toContain("Remove control surface")
		settings.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: "Escape", bubbles: true }))
		add.click()
		const chooser = document.querySelector<HTMLDialogElement>(".cs-add-dialog")!
		expect(chooser.open).toBe(true)
		expect(chooser.getAttribute("aria-labelledby")).toBe(chooser.querySelector("h2")!.id)
		Array.from(chooser.querySelectorAll<HTMLButtonElement>("button"))
			.find((button) => button.textContent === "Add Synth controls…")!
			.click()
		expect(addControls).toHaveBeenCalledOnce()
		expect(menu.hidden).toBe(true)
		edit.click()
		expect(add.hidden).toBe(true)
		expect(name.readOnly).toBe(true)
		settings.click()
		expect(menu.querySelector("label")!.hidden).toBe(true)
		expect(menu.textContent).not.toContain("Remove control surface")
		expect(menu.textContent).toContain("Open another surface")
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
		const second = (surface as any).entries[1].visual
		surface.pointerDown(2, second.x + second.width / 2, second.y + 90, false, 0.8)
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
		const second = (surface as any).entries[1].visual,
			third = (surface as any).entries[2].visual
		expect(surface.pointerDown(2, second.x + second.width / 2, second.y + 90)).toBe(true)
		surface.pointerMove(2, second.x + second.width * 0.9, second.y + 90)
		surface.pointerUp(1)
		surface.pointerUp(2)
		await settle()
		expect(a.value).toBeGreaterThan(0.5)
		expect(b.value).toBeGreaterThan(0.5)
		const calls = a.write.mock.calls.length
		surface.pointerMove(1, 100, 50)
		await settle()
		expect(a.write).toHaveBeenCalledTimes(calls)
		surface.pointerDown(3, third.x + third.width * 0.9, third.y + 90)
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
		const visual = (surface as any).entries[0].visual
		surface.pointerDown(4, visual.x + visual.width * 0.8, visual.y + 40)
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

describe("surface choice radios", () => {
	it.each([2, 4, 6, 7])(
		"uses radios for %i choices on new and saved surfaces below seven options",
		async (count) => {
			const binding = bind(
				"choice",
				{
					widget: "select",
					choices: Array.from({ length: count }, (_, value) => ({
						label: String(value),
						value
					}))
				},
				0
			)
			const saved = state()
			saved.widgets = [{ key: binding.key }, { key: binding.key, widget: "select" }]
			const surface = new ControlSurface({
				state: saved,
				bindings: [binding],
				change: vi.fn()
			})
			views.push(surface)
			await settle()
			const controls = surface.element.querySelectorAll(".cs-semantic")
			expect(controls[0].querySelectorAll('input[type="radio"]').length).toBe(
				count < 7 ? count : 0
			)
			expect(controls[0].querySelectorAll("select").length).toBe(count < 7 ? 0 : 1)
			expect(controls[1].querySelectorAll('input[type="radio"]').length).toBe(
				count < 7 ? count : 0
			)
			expect(controls[1].querySelectorAll("select").length).toBe(count < 7 ? 0 : 1)
		}
	)

	it("keeps typed values and isolates native radio groups", () => {
		const binding = bind("chord", {
			widget: "radio",
			choices: [
				{ label: "Major", value: [0, 4, 7] },
				{ label: "Minor", value: [0, 3, 7] }
			]
		})
		const apply = vi.fn()
		const first = createDomControl(binding, apply),
			second = createDomControl(binding, vi.fn())
		document.body.append(first.element, second.element)
		first.update([0, 4, 7])
		second.update([0, 4, 7])
		const radios = first.element.querySelectorAll<HTMLInputElement>('input[type="radio"]')
		radios[1].click()
		expect(apply).toHaveBeenCalledWith([0, 3, 7])
		expect(second.element.querySelector<HTMLInputElement>("input")!.checked).toBe(true)
		first.update([0, 3, 7])
		expect(radios[0].checked).toBe(false)
		expect(radios[1].checked).toBe(true)
	})

	it("renders waveform icons, synchronizes external changes, and blocks disabled radios", () => {
		const binding = bind("shape", {
			widget: "radio",
			disabled: true,
			choices: ["sine", "square", "sawtooth", "triangle"].map((value) => ({
				label: value,
				value
			}))
		})
		const apply = vi.fn(),
			control = createDomControl(binding, apply)
		control.update("sawtooth")
		expect(control.element.querySelectorAll("svg")).toHaveLength(4)
		const radios = control.element.querySelectorAll<HTMLInputElement>("input")
		expect(radios[2].checked).toBe(true)
		radios[0].click()
		expect(apply).not.toHaveBeenCalled()
		control.update("triangle")
		expect(radios[3].checked).toBe(true)
	})

	it("maps each two-row waveform tile to its value", async () => {
		const binding = bind(
			"shape",
			{
				widget: "select",
				choices: ["sine", "square", "sawtooth", "triangle"].map((value) => ({
					label: value,
					value
				}))
			},
			"sine"
		)
		const saved = state()
		saved.widgets = [{ key: binding.key }]
		const surface = new ControlSurface({ state: saved, bindings: [binding], change: vi.fn() })
		views.push(surface)
		await settle()
		const visual = (surface as any).entries[0].visual
		for (let index = 0; index < 4; index++) {
			surface.pointerDown(
				index + 1,
				visual.x + 8 + (((index % 2) + 0.5) * (visual.width - 16)) / 2,
				visual.y + 32 + ((Math.floor(index / 2) + 0.5) * (visual.height - 40)) / 2
			)
			surface.pointerUp(index + 1)
			await settle()
			expect(binding.value).toBe(binding.descriptor.choices![index].value)
		}
	})
})