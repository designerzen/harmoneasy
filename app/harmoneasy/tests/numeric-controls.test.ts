// @vitest-environment happy-dom
import { expect, it, vi } from "vitest"
import { directDescriptor, widgetChoices } from "control-surface/model"
import { createDomControl } from "control-surface/dom"
import { EVENT_KEY_DOWN } from "../../../packages/control-surface/src/events"
import type { ControlBinding, ControlDescriptor } from "control-surface/types"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { TransformerMIDIFilePlayer } from "audiobus/io/transformers/transformer-midi-file-player"
import { componentBindings, subscribeControlSchema } from "audiobus/io/component-ui"

const descriptor: ControlDescriptor = {
	id: "channel",
	label: "Channel",
	widget: "number",
	min: 1,
	max: 16,
	step: 1
}
const binding = (d: ControlDescriptor): ControlBinding => ({
	key: d.id,
	sourceLabel: "Test",
	descriptor: d,
	read: () => 1,
	write: vi.fn()
})

it("replaces numeric editors with direct choices or sliders, preserving explicit values and bounds", () => {
	expect(directDescriptor(descriptor).choices).toHaveLength(16)
	expect(directDescriptor({ ...descriptor, max: 10000 }).widget).toBe("slider")
	expect(directDescriptor({ ...descriptor, step: 0.01 }).widget).toBe("slider")
	expect(directDescriptor({ ...descriptor, step: 0 }).widget).toBe("slider")
	expect(
		directDescriptor({
			...descriptor,
			widget: "select",
			choices: [
				{ label: "Auto", value: -1 },
				{ label: "Lead", value: 3 }
			]
		}).choices
	).toEqual([
		{ label: "Auto", value: -1 },
		{ label: "Lead", value: 3 }
	])
	expect(
		directDescriptor({ ...descriptor, widget: "select", choices: [{ label: "1", value: "1" }] })
			.widget
	).toBe("radio")
	expect(widgetChoices(descriptor)).toEqual(["radio"])
	expect(
		directDescriptor({
			...descriptor,
			widget: "select",
			choices: [
				{ label: "Auto", value: "auto" },
				{ label: "1", value: 1 }
			]
		}).widget
	).toBe("radio")
	expect(widgetChoices({ ...descriptor, max: 10000 })).not.toContain("number")
	const single = createDomControl(binding({ ...descriptor, min: 5, max: 5 }), vi.fn())
	expect(single.element.querySelector<HTMLElement>(".cs-choice-navigation")!.hidden).toBe(true)
	single.destroy?.()
	for (const d of [descriptor, { ...descriptor, max: 10000 }]) {
		const control = createDomControl(binding(d), vi.fn())
		expect(control.element.querySelector('input[type="number"],select')).toBeNull()
		control.destroy?.()
	}
})

it("pages choices without changing the value, selects in one click, and reveals external changes", () => {
	const apply = vi.fn(),
		control = createDomControl(binding(descriptor), apply)
	document.body.append(control.element)
	try {
		const pages = control.choices!
		pages.resize(153, 145, 1)
		control.update(1)
		const next = control.element.querySelector<HTMLButtonElement>(
			'[aria-label="Next Channel options"]'
		)!
		next.click()
		expect(apply).not.toHaveBeenCalled()
		const visible = [
			...control.element.querySelectorAll<HTMLInputElement>('input[type="radio"]')
		].filter((radio) => !radio.closest("[hidden]"))
		expect(visible).toHaveLength(2)
		visible[0].click()
		expect(apply).toHaveBeenLastCalledWith(3)
		control.update(16)
		const selected = control.element.querySelector<HTMLInputElement>("input:checked")!
		expect(selected.getAttribute("aria-label")).toBe("16")
		expect(selected.closest("[hidden]")).toBeNull()
		selected.dispatchEvent(
			new KeyboardEvent(EVENT_KEY_DOWN, { key: "Home", bubbles: true, cancelable: true })
		)
		expect(apply).toHaveBeenLastCalledWith(1)
		expect(document.activeElement?.getAttribute("aria-label")).toBe("1")
		const { columns, rows, height, gap } = pages.layout
		expect((153 - gap * (columns - 1)) / columns).toBeGreaterThanOrEqual(44)
		expect((height - gap * (rows - 1)) / rows).toBeGreaterThanOrEqual(44)
		pages.resize(306, 290, 0.5)
		expect(pages.layout.gap * 0.5).toBe(11)
	} finally {
		control.destroy?.()
		control.element.remove()
	}
})

it("leaves disabled and readonly choices inert", () => {
	const apply = vi.fn(),
		control = createDomControl(binding({ ...descriptor, readOnly: true }), apply)
	try {
		control.element.querySelector<HTMLInputElement>("input")!.click()
		expect(apply).not.toHaveBeenCalled()
	} finally {
		control.destroy?.()
	}
})

it("publishes Auto and actual playable MIDI tracks when a file loads", async () => {
	const { Midi } = createRequire(resolve("../../packages/audiobus/package.json"))("@tonejs/midi")
	const midi = new Midi()
	const track = midi.addTrack()
	track.name = "Lead"
	track.addNote({ midi: 60, time: 0, duration: 1, velocity: 0.8 })
	const source = new TransformerMIDIFilePlayer({ playbackMode: "step" })
	const changed = vi.fn(),
		unsubscribe = subscribeControlSchema(source, changed)
	const nativeFetch = globalThis.fetch
	globalThis.fetch = vi.fn(async () => new Response(Uint8Array.from(midi.toArray()).buffer))
	try {
		await source.loadMIDIFile("test.mid")
		const control = source.getUiDescriptor().controls.find((item) => item.id === "trackIndex")!
		expect(control.label).toBe("Melody track")
		expect(control.widget).toBe("radio")
		expect(control.choices?.[0]).toEqual({ label: "Auto", value: -1 })
		expect(control.choices?.some((choice) => choice.label.includes("Lead"))).toBe(true)
		expect(control.choices).toHaveLength(2)
		expect(changed).toHaveBeenCalledOnce()
	} finally {
		globalThis.fetch = nativeFetch
		unsubscribe()
		source.destroy()
	}
})

it("shows off and on choices as one switch while keeping saved 0/1 values", async () => {
	const transformer = new TransformerMIDIFilePlayer({ loop: 1 as unknown as boolean })
	const bindings = await componentBindings(transformer, "player")
	const loop = bindings.find((binding) => binding.descriptor.id === "loop")!
	expect(loop.descriptor.widget).toBe("toggle")
	expect(loop.descriptor.choices).toBeUndefined()
	expect(widgetChoices(loop.descriptor)).toEqual(["toggle"])
	expect(loop.read()).toBe(true)
	await loop.write(false)
	expect(transformer.options.loop).toBe(0)
	expect(loop.read()).toBe(false)
	const playback = bindings.find((binding) => binding.descriptor.id === "playbackMode")!
	expect(playback.descriptor.widget).not.toBe("toggle")
	transformer.destroy()
})
