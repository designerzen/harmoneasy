// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import InputKeyboard from "../../../packages/audiobus/io/inputs/input-keyboard"
import { keyboardConfiguration } from "../../../packages/audiobus/hardware/keyboard/keyboard-configuration"
import { NOTE_ON, NOTE_OFF, PLAYBACK_TOGGLE, TEMPO_TAP } from "../../../packages/audiobus/commands"
import {
	EVENT_KEY_DOWN,
	EVENT_KEY_UP,
	EVENT_BLUR,
	EVENT_TOGGLE
} from "../../../packages/audiobus/event-constants"
import { defineDevice, deviceDefinition } from "../../../packages/audiobus/io/device-definition"

const inputs: InputKeyboard[] = []
const setup = (options = {}) => {
	const input = new InputKeyboard(options)
	inputs.push(input)
	return { input, dispatch: vi.spyOn(input, "dispatch") }
}
const key = (value: string, type = EVENT_KEY_DOWN, code = value) =>
	window.dispatchEvent(new KeyboardEvent(type, { key: value, code, cancelable: true }))
afterEach(() => {
	inputs.splice(0).forEach((input) => input.destroy())
	document.body.replaceChildren()
})

it.each(["combined", "notes", "shortcuts"])("routes %s mode", (mode) => {
	const { dispatch } = setup({ mode })
	key("q")
	key("q", EVENT_KEY_UP)
	key("Enter")
	key("Enter", EVENT_KEY_UP)
	expect(dispatch.mock.calls.map(([command]) => command.type)).toEqual(
		mode === "notes"
			? [NOTE_ON, NOTE_OFF]
			: mode === "shortcuts"
				? [PLAYBACK_TOGGLE]
				: [NOTE_ON, NOTE_OFF, PLAYBACK_TOGGLE]
	)
})

it("round-trips custom bindings through device persistence and releases held notes", () => {
	const { input, dispatch } = setup({
		mode: "custom",
		bindings: [
			{ key: "a", command: NOTE_ON, value: 72 },
			{ key: " ", command: TEMPO_TAP, value: 0 }
		]
	})
	defineDevice(input, { factory: "input", type: "keyboard" })
	const saved = JSON.parse(JSON.stringify(deviceDefinition(input)))
	expect(saved.options).toEqual(input.configuration)
	key("a", EVENT_KEY_DOWN, "KeyA")
	key("A", EVENT_KEY_UP, "KeyA")
	key("q")
	key("q", EVENT_KEY_UP)
	key(" ")
	key(" ", EVENT_KEY_UP)
	key("a")
	input.setConfiguration({ mode: "notes", bindings: [] })
	key("a", EVENT_KEY_UP)
	expect(dispatch.mock.calls.map(([c]) => [c.type, c.value])).toEqual([
		[NOTE_ON, 72],
		[NOTE_OFF, 72],
		[TEMPO_TAP, 0],
		[NOTE_ON, 72],
		[NOTE_OFF, 72]
	])
	input.destroy()
	const restored = setup(saved.options)
	key("a")
	window.dispatchEvent(new Event(EVENT_BLUR))
	expect(restored.dispatch.mock.calls.map(([c]) => [c.type, c.number, c.velocity])).toEqual([
		[NOTE_ON, 72, 127],
		[NOTE_OFF, 72, 0]
	])
})

it("selects and learns bindings without emitting commands, including duplicate keys", async () => {
	const { input, dispatch } = setup({
		mode: "custom",
		bindings: [
			{ key: "a", command: NOTE_ON, value: 60 },
			{ key: "b", command: TEMPO_TAP, value: 0 }
		]
	})
	const gui = await input.createGui()
	document.body.append(gui)
	const settings = gui.querySelector("details")!
	settings.open = true
	settings.dispatchEvent(new Event(EVENT_TOGGLE))
	const select = gui.querySelector<HTMLSelectElement>('select[aria-label="Key"]')!
	select.value = "c"
	select.dispatchEvent(new Event("change"))
	expect(input.configuration.bindings.some((binding) => binding.key === "c")).toBe(true)
	const learn = [...gui.querySelectorAll("button")].find(
		(button) => button.textContent === "Learn key"
	)!
	learn.click()
	key("c")
	expect(dispatch).not.toHaveBeenCalled()
	expect(input.configuration.bindings.filter((binding) => binding.key === "c")).toHaveLength(1)
	key("c", EVENT_KEY_UP)
	key("c")
	expect(dispatch).toHaveBeenCalledOnce()
	await input.destroyGui()
	key("c", EVENT_KEY_UP)
})

it("rejects malformed serialized bindings", () => {
	expect(
		keyboardConfiguration({
			mode: "custom",
			bindings: [
				{ key: "q", command: NOTE_ON, value: 128 },
				{ key: "w", command: "unknown", value: 0 },
				{ key: "e", command: NOTE_ON, value: NaN }
			]
		}).bindings
	).toEqual([])
})

it("starts with a playable keyboard and no per-key editor", async () => {
	const { input, dispatch } = setup()
	const gui = await input.createGui()
	document.body.append(gui)
	expect(gui.querySelector(".qwerty-keyboard")).not.toBeNull()
	expect(gui.querySelector("fieldset")).toBeNull()
	key("q")
	key("q", EVENT_KEY_UP)
	expect(dispatch.mock.calls.map(([command]) => command.type)).toEqual([NOTE_ON, NOTE_OFF])
	const mode = gui.querySelector<HTMLSelectElement>('select[aria-label="Operating mode"]')!
	mode.value = "custom"
	mode.dispatchEvent(new Event("change"))
	expect(input.configuration.bindings.length).toBeGreaterThan(40)
	expect(gui.querySelector("fieldset")).toBeNull()
	const settings = gui.querySelector("details")!
	settings.open = true
	settings.dispatchEvent(new Event(EVENT_TOGGLE))
	expect(gui.querySelectorAll("fieldset")).toHaveLength(1)
	key("q")
	key("q", EVENT_KEY_UP)
	expect(dispatch.mock.calls.map(([command]) => [command.type, command.value])).toEqual([
		[NOTE_ON, 41],
		[NOTE_OFF, 41],
		[NOTE_ON, 41],
		[NOTE_OFF, 41]
	])
})

it("keeps saved custom mappings collapsed and edits the selected binding", async () => {
	const { input } = setup({
		mode: "custom",
		bindings: [
			{ key: "a", command: NOTE_ON, value: 60 },
			{ key: "b", command: NOTE_ON, value: 62 }
		]
	})
	const gui = await input.createGui()
	document.body.append(gui)
	expect(gui.querySelector("fieldset")).toBeNull()
	const settings = gui.querySelector("details")!
	settings.open = true
	settings.dispatchEvent(new Event(EVENT_TOGGLE))
	const picker = gui.querySelector<HTMLSelectElement>('select[aria-label="Edit binding"]')!
	picker.value = "1"
	picker.dispatchEvent(new Event("change"))
	const value = gui.querySelector<HTMLInputElement>('input[aria-label="Value"]')!
	value.value = "70"
	value.dispatchEvent(new Event("change"))
	expect(input.configuration.bindings).toEqual([
		{ key: "a", command: NOTE_ON, value: 60 },
		{ key: "b", command: NOTE_ON, value: 70 }
	])
	expect(gui.querySelectorAll("fieldset")).toHaveLength(1)
})