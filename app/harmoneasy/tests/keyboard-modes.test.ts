// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import InputKeyboard from "../../../packages/audiobus/io/inputs/input-keyboard"
import { keyboardConfiguration } from "../../../packages/audiobus/hardware/keyboard/keyboard-configuration"
import { NOTE_ON, NOTE_OFF, PLAYBACK_TOGGLE, TEMPO_TAP } from "../../../packages/audiobus/commands"
import {
	EVENT_KEY_DOWN,
	EVENT_KEY_UP,
	EVENT_BLUR
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