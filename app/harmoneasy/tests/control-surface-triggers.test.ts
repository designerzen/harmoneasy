// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import { CONTROL_CHANGE, NOTE_OFF, NOTE_ON } from "audiobus/commands/commands"
import { EVENT_KEY_DOWN, EVENT_KEY_UP } from "audiobus/events/event-constants"
import { triggerLabel, validSurfaces } from "control-surface/model"
import type { SurfaceState, SurfaceTrigger } from "control-surface/types"
import {
	installSurfaceTriggers,
	learnSurfaceTrigger,
	registerTriggerView
} from "../source/components/graph/control-surface-triggers"

const cleanup: (() => void)[] = []
afterEach(() => {
	cleanup.splice(0).forEach((dispose) => dispose())
	document.body.replaceChildren()
})

const KEY = JSON.stringify(["synth", "go"])
function setup(trigger: SurfaceTrigger) {
	const surface: SurfaceState = {
		id: "surface",
		name: "Live",
		connections: [{ componentId: "synth", controlIds: ["go"] }],
		widgets: [{ key: KEY, trigger }]
	}
	const manager = {
		entries: [["chain-1", { options: { controlSurfaces: [surface] } }]],
		triggerHandler: undefined as undefined | ((command: any) => boolean)
	}
	const view = { trigger: vi.fn(() => true) }
	cleanup.push(installSurfaceTriggers(manager as never), registerTriggerView("surface", view))
	// Stands in for the musical keyboard and Cosmo Dots, which listen on window.
	const instrument = vi.fn()
	window.addEventListener(EVENT_KEY_DOWN, instrument)
	cleanup.push(() => window.removeEventListener(EVENT_KEY_DOWN, instrument))
	return { manager, view, instrument }
}
const press = (key: string, type = EVENT_KEY_DOWN) =>
	document.body.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }))

it("plays a gadget from its key and keeps that key away from notes and Cosmo Dots", () => {
	const { view, instrument } = setup({ key: "1" })
	press("1")
	press("1", EVENT_KEY_UP)
	expect(view.trigger.mock.calls).toEqual([
		[KEY, true],
		[KEY, false]
	])
	expect(instrument).not.toHaveBeenCalled()
	press("2")
	expect(instrument).toHaveBeenCalledTimes(1)
	const field = document.body.appendChild(document.createElement("input"))
	field.focus()
	press("1")
	expect(view.trigger).toHaveBeenCalledTimes(2)
})

it("consumes assigned MIDI notes and CC presses and lets everything else through", () => {
	const { manager, view } = setup({ midi: { type: "note", number: 60, channel: 0 } })
	const handle = manager.triggerHandler!
	expect(handle({ type: NOTE_ON, number: 60, channel: 3, velocity: 90 })).toBe(true)
	expect(handle({ type: NOTE_OFF, number: 60, channel: 3, velocity: 0 })).toBe(true)
	expect(handle({ type: NOTE_ON, number: 61, channel: 3, velocity: 90 })).toBe(false)
	expect(view.trigger.mock.calls).toEqual([
		[KEY, true],
		[KEY, false]
	])
	cleanup.splice(0).forEach((dispose) => dispose())
	const cc = setup({ midi: { type: "cc", number: 20, channel: 1 } })
	const control = (value: number, channel = 1) =>
		cc.manager.triggerHandler!({ type: CONTROL_CHANGE, number: 20, channel, value })
	expect(control(127)).toBe(true)
	expect(control(120)).toBe(true)
	expect(control(0)).toBe(true)
	expect(control(127, 2)).toBe(false)
	expect(cc.view.trigger.mock.calls).toEqual([
		[KEY, true],
		[KEY, false]
	])
})

it("learns the next key or MIDI press without playing it", async () => {
	const { manager, view, instrument } = setup({ key: "q" })
	let learning = learnSurfaceTrigger(new AbortController().signal)
	press("Q")
	expect(await learning).toEqual({ key: "q" })
	expect(instrument).not.toHaveBeenCalled()
	expect(view.trigger).not.toHaveBeenCalled()
	learning = learnSurfaceTrigger(new AbortController().signal)
	expect(manager.triggerHandler!({ type: NOTE_ON, number: 36, channel: 10, velocity: 1 })).toBe(
		true
	)
	expect(await learning).toEqual({ midi: { type: "note", number: 36, channel: 10 } })
	const abort = new AbortController()
	learning = learnSurfaceTrigger(abort.signal)
	abort.abort()
	await expect(learning).rejects.toBeDefined()
	press("q")
	expect(view.trigger).toHaveBeenCalledWith(KEY, true)
})

it("validates and describes saved triggers", () => {
	const surface = (trigger: unknown) => [
		{ id: "s", name: "S", connections: [], widgets: [{ key: KEY, trigger }] }
	]
	expect(validSurfaces(surface({ key: " ", midi: { type: "cc", number: 7, channel: 0 } }))).toBe(
		true
	)
	expect(validSurfaces(surface({}))).toBe(false)
	expect(validSurfaces(surface({ midi: { type: "pitch", number: 7, channel: 0 } }))).toBe(false)
	expect(validSurfaces(surface({ midi: { type: "note", number: 128, channel: 0 } }))).toBe(false)
	expect(triggerLabel({ key: " ", midi: { type: "note", number: 36, channel: 10 } })).toBe(
		"Key Space · MIDI note 36 ch 10"
	)
})

it("lets any input's CC follow dials and both axes of an XY pad", () => {
	const X = JSON.stringify(["synth", "cutoff"]),
		Y = JSON.stringify(["synth", "resonance"])
	const surface: SurfaceState = {
		id: "surface",
		name: "Live",
		connections: [{ componentId: "synth", controlIds: ["go", "cutoff", "resonance"] }],
		widgets: [
			{
				key: KEY,
				widget: "dial",
				trigger: { midi: { type: "cc", number: 16, channel: 0 } }
			},
			{
				key: X,
				yKey: Y,
				widget: "xy",
				trigger: { midi: { type: "cc", number: 16, channel: 0 } },
				yTrigger: { midi: { type: "cc", number: 17, channel: 0 } }
			}
		]
	}
	const manager = {
		entries: [["chain-1", { options: { controlSurfaces: [surface] } }]],
		triggerHandler: undefined as undefined | ((command: any) => boolean)
	}
	const view = { trigger: vi.fn(() => false), follow: vi.fn(() => true) }
	cleanup.push(installSurfaceTriggers(manager as never), registerTriggerView("surface", view))
	const handle = manager.triggerHandler!
	expect(
		handle({
			type: CONTROL_CHANGE,
			number: 16,
			channel: 5,
			value: 127,
			from: "phone"
		})
	).toBe(true)
	expect(
		handle({
			type: CONTROL_CHANGE,
			number: 17,
			channel: 5,
			value: 0,
			from: "phone"
		})
	).toBe(true)
	expect(
		handle({
			type: CONTROL_CHANGE,
			number: 18,
			channel: 5,
			value: 0,
			from: "phone"
		})
	).toBe(false)
	expect(view.follow.mock.calls).toEqual([
		[KEY, "x", 1],
		[X, "x", 1],
		[X, "y", 0]
	])
	expect(validSurfaces([surface])).toBe(true)
	expect(
		validSurfaces([
			{
				...surface,
				widgets: [{ key: X, yKey: Y, yTrigger: { midi: {} } }]
			}
		])
	).toBe(false)
})

it("learns any CC value for continuous gadgets but ignores notes and keys", async () => {
	const { manager, instrument } = setup({ key: "q" })
	const learning = learnSurfaceTrigger(new AbortController().signal, "cc")
	press("w")
	expect(instrument).toHaveBeenCalledTimes(1)
	expect(
		manager.triggerHandler!({
			type: NOTE_ON,
			number: 36,
			channel: 1,
			velocity: 90
		})
	).toBe(true)
	// A small move that never crosses the press threshold is still learned.
	expect(
		manager.triggerHandler!({
			type: CONTROL_CHANGE,
			number: 17,
			channel: 2,
			value: 3
		})
	).toBe(true)
	expect(await learning).toEqual({
		midi: { type: "cc", number: 17, channel: 2 }
	})
})