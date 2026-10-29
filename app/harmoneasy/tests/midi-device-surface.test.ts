// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { MIDI_DEVICE_PROFILES } from "../../../packages/audiobus/midi/hardware/device-profiles"
import { createProfiledMidiGui } from "../../../packages/audiobus/midi/hardware/profiled-midi-gui"
import {
	createInputById,
	getAvailableInputFactories
} from "../../../packages/audiobus/io/input-factory"
import { deviceDefinition } from "../../../packages/audiobus/io/device-definition"
import InputProfiledMidiDevice from "../../../packages/audiobus/io/inputs/input-profiled-midi-device"
import { musicalCommand } from "../../../packages/audiobus/io/event-clip"
import { NOTE_ON, NOTE_OFF, CONTROL_CHANGE } from "../../../packages/audiobus/commands"
import {
	INPUT_EVENT,
	EVENT_BLUR,
	EVENT_CHANGE,
	EVENT_KEY_DOWN,
	EVENT_KEY_UP,
	EVENT_POINTER_DOWN,
	EVENT_POINTER_UP
} from "../../../packages/audiobus/event-constants"

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup()
	}
	document.body.replaceChildren()
	vi.unstubAllGlobals()
})
function gui(id = "roland-tb-3", options: Record<string, any> = {}) {
	const perform = vi.fn(),
		changed = vi.fn()
	const gui = createProfiledMidiGui(MIDI_DEVICE_PROFILES[id], options, perform, changed)
	gui.setConnected(true, "test-port")
	document.body.append(gui.element)
	cleanups.push(() => gui.destroy())
	const control = (id: string) =>
		gui.element.querySelector<SVGGElement>(`[data-surface-control="${id}"]`)!
	return { gui, perform, changed, options, control }
}
describe("registry hardware surfaces", () => {
	it.each(Object.keys(MIDI_DEVICE_PROFILES))(
		"%s has a validated SVG surface and every documented control appears on it",
		(id) => {
			const profile = MIDI_DEVICE_PROFILES[id]
			expect(profile.surface?.src).toMatch(/panel\.svg$/)
			expect(profile.surface!.elements.length).toBeGreaterThan(0)
			for (const control of profile.controls) {
				expect(
					profile.surface!.elements.some((element) => element.control === control.id)
				).toBe(true)
			}
			const view = guiForProfile(profile.id)
			expect(view.element.querySelector("svg")).not.toBeNull()
			expect(view.element.querySelectorAll("[data-surface-control]")).toHaveLength(
				profile.surface!.elements.length
			)
		}
	)
	it("lights notes and CCs from hardware without echo, with channel-aware note-off and panic", () => {
		const { gui, perform, control } = guiForTest()
		gui.receive(musicalCommand({ type: NOTE_ON, number: 48, velocity: 100, channel: 1 }))
		gui.receive(musicalCommand({ type: NOTE_ON, number: 48, velocity: 110, channel: 2 }))
		expect(control("touch-note-0").dataset.active).toBe("true")
		gui.receive(musicalCommand({ type: NOTE_OFF, number: 48, channel: 1 }))
		expect(control("touch-note-0").dataset.active).toBe("true")
		gui.receive(musicalCommand({ type: CONTROL_CHANGE, number: 123, channel: 2 }))
		expect(control("touch-note-0").dataset.active).toBe("false")
		gui.receive(musicalCommand({ type: CONTROL_CHANGE, number: 74, value: 90, channel: 2 }))
		expect(control("cutoff").getAttribute("aria-valuenow")).toBe("90")
		expect(perform).not.toHaveBeenCalled()
	})
	it("plays pressure-sensitive pads and keys, supports keyboard activation and flushes on focus loss", () => {
		const { perform, control } = guiForTest({ selectedChannel: 3 })
		const key = control("touch-note-0")
		key.dispatchEvent(
			new PointerEvent(EVENT_POINTER_DOWN, {
				button: 0,
				pointerId: 1,
				pointerType: "touch",
				pressure: 0.5
			})
		)
		expect(perform).toHaveBeenLastCalledWith({ type: "note", number: 48, channel: 3 }, 64)
		key.dispatchEvent(new PointerEvent(EVENT_POINTER_UP, { pointerId: 1 }))
		expect(perform).toHaveBeenLastCalledWith({ type: "note", number: 48, channel: 3 }, 0)
		key.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: "Enter" }))
		window.dispatchEvent(new Event(EVENT_BLUR))
		expect(perform).toHaveBeenLastCalledWith({ type: "note", number: 48, channel: 3 }, 0)
		expect(perform).toHaveBeenCalledTimes(4)
	})
	it("learns a configurable mapping, saves it, and generates the same mapped message virtually", () => {
		const { gui, options, control, changed, perform } = guiForTest()
		const learn = gui.element.querySelector<HTMLInputElement>('details input[type="checkbox"]')!
		learn.checked = true
		control("touch-note-0").dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: "Enter" }))
		gui.receive(musicalCommand({ type: NOTE_ON, number: 72, velocity: 100, channel: 4 }))
		expect(options.surfaceMappings["touch-note-0"]).toEqual({
			type: "note",
			number: 72,
			channel: 4
		})
		expect(changed).toHaveBeenCalledOnce()
		expect(perform).not.toHaveBeenCalled()
		expect(control("touch-note-0").dataset.active).toBe("true")
		gui.receive(musicalCommand({ type: NOTE_OFF, number: 72, channel: 4 }))
		control("touch-note-0").dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: "Enter" }))
		control("touch-note-0").dispatchEvent(new KeyboardEvent(EVENT_KEY_UP, { key: "Enter" }))
		expect(perform.mock.calls).toEqual([
			[{ type: "note", number: 72, channel: 4 }, 127],
			[{ type: "note", number: 72, channel: 4 }, 0]
		])
	})
	it("releases momentary CC pads with the same channel and controller used for the press", () => {
		const { perform, control } = gui("digit-cmpsr", { selectedChannel: 3 })
		control("up").dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: "Enter" }))
		control("up").dispatchEvent(new KeyboardEvent(EVENT_KEY_UP, { key: "Enter" }))
		expect(perform.mock.calls).toEqual([
			[{ type: "cc", number: 111, channel: 3 }, 127],
			[{ type: "cc", number: 111, channel: 3 }, 0]
		])
	})
	it("uses manually edited mappings and ignores malformed saved overrides", () => {
		const { gui, options, control, perform } = guiForTest({
			surfaceMappings: { "touch-note-0": { type: "note", number: 999 } }
		})
		const select = gui.element.querySelector<HTMLSelectElement>(
			'[aria-label="Hardware control to map"]'
		)!
		select.value = "touch-note-0"
		select.dispatchEvent(new Event(EVENT_CHANGE))
		const number = gui.element.querySelector<HTMLInputElement>(
			'[aria-label="MIDI note or CC number"]'
		)!
		number.value = "65"
		number.dispatchEvent(new Event(EVENT_CHANGE))
		expect(options.surfaceMappings["touch-note-0"]).toEqual({ type: "note", number: 65 })
		control("touch-note-0").dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: " " }))
		expect(perform).toHaveBeenLastCalledWith({ type: "note", number: 65, channel: 1 }, 127)
		gui.setConnected(false, "")
		expect(perform).toHaveBeenLastCalledWith({ type: "note", number: 65, channel: 1 }, 0)
	})
	it("offers virtual inputs without a MIDI API, routes real commands, and persists custom mappings", async () => {
		const input = (await createInputById("roland-tb-3", {
			virtualInput: true,
			selectedChannel: 2,
			surfaceMappings: { "touch-note-0": { type: "note", number: 60, channel: 2 } }
		})) as InputProfiledMidiDevice
		cleanups.push(() => input.destroy())
		await input.connect()
		expect(getAvailableInputFactories().some((factory) => factory.id === "roland-tb-3")).toBe(
			true
		)
		const events: any[] = []
		input.addEventListener(INPUT_EVENT, (event) => events.push((event as any).command))
		const panel = await input.createGui()
		const key = panel.querySelector<SVGGElement>('[data-surface-control="touch-note-0"]')!
		key.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: "Enter" }))
		key.dispatchEvent(new KeyboardEvent(EVENT_KEY_UP, { key: "Enter" }))
		expect(events).toEqual([
			expect.objectContaining({ type: NOTE_ON, number: 60, channel: 2 }),
			expect.objectContaining({ type: NOTE_OFF, number: 60, channel: 2 })
		])
		expect(deviceDefinition(input)).toMatchObject({
			type: "roland-tb-3",
			options: {
				virtualInput: true,
				surfaceMappings: { "touch-note-0": { type: "note", number: 60, channel: 2 } }
			}
		})
	})
})
function guiForProfile(id: string) {
	return gui(id).gui
}
function guiForTest(options: Record<string, any> = {}) {
	return gui("roland-tb-3", options)
}