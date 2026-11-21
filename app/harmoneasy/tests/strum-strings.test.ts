// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import {
	StrumStrings,
	strumTuning
} from "../../../packages/audiobus/ui/controllers/strum-strings/strum-strings"
import { createInputById } from "../../../packages/audiobus/io/input-factory"
import type InputWebComponent from "../../../packages/audiobus/io/inputs/input-web-component"
import { INPUT_EVENT, NOTE_OFF, NOTE_ON } from "../../../packages/audiobus/commands/commands"

afterEach(() => {
	document.body.replaceChildren()
})

/** Mount with a fixed canvas size; six guitar strings across 120px sit 20px apart. */
function mount(attributes: Record<string, string> = {}, width = 300, height = 120) {
	const element = document.createElement("strum-strings") as StrumStrings
	for (const [name, value] of Object.entries(attributes)) {
		element.setAttribute(name, value)
	}
	const canvas = element.shadowRoot!.querySelector("canvas")!
	canvas.getBoundingClientRect = () =>
		({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0 }) as DOMRect
	document.body.append(element)
	const events: { type: string; note: number; velocity: number; id: number }[] = []
	for (const type of [NOTE_ON, NOTE_OFF]) {
		element.addEventListener(type, (event) => {
			const { note, velocity, id } = (event as CustomEvent).detail
			events.push({ type, note: note.noteNumber, velocity, id })
		})
	}
	let time = 0
	const pointer = (type: string, x: number, y: number, step = 10) => {
		time += step
		const event = new PointerEvent(type, {
			pointerId: 1,
			pointerType: "touch",
			clientX: x,
			clientY: y,
			buttons: type === "pointerup" ? 0 : 1,
			bubbles: true
		})
		Object.defineProperty(event, "timeStamp", { value: time })
		canvas.dispatchEvent(event)
	}
	return { element, events, pointer }
}

describe("strum strings", () => {
	it("parses presets and note lists, falling back to guitar", () => {
		expect(strumTuning("ukulele")).toEqual([67, 60, 64, 69])
		expect(strumTuning("48, 55 200 x 60")).toEqual([48, 55, 60])
		expect(strumTuning("")).toEqual([40, 45, 50, 55, 59, 64])
	})

	it("plucks capo-shifted notes and replaces a ringing note on re-pluck", () => {
		const { element, events } = mount({ capo: "2" })
		expect(element.notes).toEqual([42, 47, 52, 57, 61, 66])
		element.pluck(0, 0.5)
		element.pluck(0, 0.8)
		expect(events.map((e) => [e.type, e.note])).toEqual([
			[NOTE_ON, 42],
			[NOTE_OFF, 42],
			[NOTE_ON, 42]
		])
		expect(events[1].id).toBe(events[0].id)
		element.stop()
		expect(events.at(-1)).toMatchObject({ type: NOTE_OFF, note: 42, id: events[2].id })
	})

	it("strums every string in order in either direction", () => {
		const { element, events } = mount({ tuning: "bass" })
		element.strum(1, 0.7, 0)
		element.stop()
		element.strum(-1, 0.7, 0)
		expect(events.filter((e) => e.type === NOTE_ON).map((e) => e.note)).toEqual([
			28, 33, 38, 43, 43, 38, 33, 28
		])
	})

	it("strums down and back up in one gesture made of small moves", () => {
		const { events, pointer } = mount()
		pointer("pointerdown", 150, 2)
		for (let y = 6; y <= 118; y += 4) {
			pointer("pointermove", 150, y, 8)
		}
		for (let y = 114; y >= 2; y -= 4) {
			pointer("pointermove", 150, y, 8)
		}
		pointer("pointerup", 150, 2)
		expect(events.filter((e) => e.type === NOTE_ON).map((e) => e.note)).toEqual([
			40, 45, 50, 55, 59, 64, 64, 59, 55, 50, 45, 40
		])
	})

	it("sounds each string a fast drag crosses, in the order they are met", () => {
		const { events, pointer } = mount()
		pointer("pointerdown", 150, 0)
		pointer("pointermove", 150, 120, 20)
		expect(events.map((e) => e.note)).toEqual([40, 45, 50, 55, 59, 64])
		expect(events.every((e) => e.type === NOTE_ON && e.velocity > 0.9)).toBe(true)
		pointer("pointermove", 150, 0, 20)
		expect(
			events
				.slice(6)
				.filter((e) => e.type === NOTE_ON)
				.map((e) => e.note)
		).toEqual([64, 59, 55, 50, 45, 40])
	})

	it("holds a pushed string silently, then plucks it on release", () => {
		const { events, pointer } = mount()
		pointer("pointerdown", 150, 20)
		pointer("pointermove", 150, 33)
		pointer("pointermove", 150, 36)
		expect(events).toEqual([])
		pointer("pointerup", 150, 36)
		expect(events).toHaveLength(1)
		expect(events[0]).toMatchObject({ type: NOTE_ON, note: 45 })
		expect(events[0].velocity).toBeGreaterThan(0.2)
		expect(events[0].velocity).toBeLessThan(0.7)
	})

	it("lets a string ease back to rest without sounding, and plucks one pushed past its limit", () => {
		const { events, pointer } = mount()
		pointer("pointerdown", 150, 20)
		pointer("pointermove", 150, 32)
		pointer("pointermove", 150, 30)
		pointer("pointerup", 150, 30)
		expect(events).toEqual([])
		pointer("pointerdown", 150, 20, 1000)
		pointer("pointermove", 150, 34, 1000)
		pointer("pointermove", 150, 40, 1000)
		expect(events.map((e) => e.note)).toEqual([45])
	})

	it("plucks a string that is tapped", () => {
		const { events, pointer } = mount()
		pointer("pointerdown", 150, 50)
		pointer("pointerup", 150, 50)
		expect(events.map((e) => [e.type, e.note])).toEqual([[NOTE_ON, 50]])
	})

	it("lays strings across the longer side unless told otherwise", () => {
		expect(mount({}, 120, 300).element.dataset.axis).toBe("vertical")
		expect(mount({}, 300, 120).element.dataset.axis).toBe("horizontal")
		expect(mount({ orientation: "vertical" }, 300, 120).element.dataset.axis).toBe("vertical")
	})

	it("ignores input while disabled", () => {
		const { element, events, pointer } = mount({ disabled: "" })
		element.pluck(0)
		pointer("pointerdown", 150, 0)
		pointer("pointermove", 150, 120)
		expect(events).toEqual([])
	})

	it("routes notes through the input chain and saves its settings", async () => {
		const input = (await createInputById("strum-strings", {
			now: () => 0,
			attributes: { tuning: "harp" }
		})) as InputWebComponent
		const commands: any[] = []
		input.addEventListener(INPUT_EVENT, (event: any) => commands.push(event.command))
		const element = (await input.createGui()) as StrumStrings
		document.body.append(element)
		expect(element.notes[0]).toBe(48)
		element.pluck(2, 1)
		expect(commands.at(-1)).toMatchObject({ type: NOTE_ON, number: 52, velocity: 127 })
		const select = element.shadowRoot!.querySelector<HTMLSelectElement>("[data-tuning]")!
		select.value = "ukulele"
		select.dispatchEvent(new Event("change"))
		expect(commands.at(-1)).toMatchObject({ type: NOTE_OFF, number: 52 })
		expect(input.options.attributes.tuning).toBe("ukulele")
		input.destroy()
	})
})