// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import InputCosmoDots from "../../../packages/audiobus/io/inputs/input-cosmo-dots"
import { createInputById } from "../../../packages/audiobus/io/input-factory"
import { deviceDefinition } from "../../../packages/audiobus/io/device-definition"
import {
	INPUT_EVENT,
	EVENT_CONFIGURATION_CHANGED
} from "../../../packages/audiobus/event-constants"
import {
	CONTROL_CHANGE,
	NOTE_OFF,
	NOTE_ON,
	PLAYBACK_TOGGLE
} from "../../../packages/audiobus/commands"

const devices: InputCosmoDots[] = []
function setup(options = {}) {
	vi.useFakeTimers()
	const input = new InputCosmoDots({ now: () => 12, ...options })
	devices.push(input)
	const receive = vi.fn()
	input.addEventListener(INPUT_EVENT, (event) => receive((event as any).command))
	return { input, receive }
}
afterEach(() => {
	devices.splice(0).forEach((input) => input.destroy())
	document.body.replaceChildren()
	vi.useRealTimers()
})
const key = (value: string, options = {}) =>
	window.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: value,
			bubbles: true,
			cancelable: true,
			...options
		})
	)

describe("Cosmo Dots input", () => {
	it("sends configured command fields for reassigned number keys", () => {
		const { input, receive } = setup()
		const dot = input.configuration[0]
		dot.trigger = "9"
		dot.command = {
			...dot.command,
			type: CONTROL_CHANGE,
			number: 74,
			value: 95,
			channel: 4,
			velocity: 70,
			pitchBend: 12,
			patch: 3,
			subtype: "custom",
			text: "Filter"
		}
		input.setDot(0, dot)
		key("0")
		expect(receive).not.toHaveBeenCalled()
		key("9")
		expect(receive).toHaveBeenLastCalledWith(expect.objectContaining(dot.command))
		vi.advanceTimersByTime(1000)
		expect(receive).toHaveBeenCalledOnce()
	})
	it("releases the original note even if a downstream handler mutates the command", () => {
		const { input, receive } = setup()
		input.addEventListener(INPUT_EVENT, (event) => {
			const command = (event as any).command
			if (command.type === NOTE_ON) {
				command.number = 90
			}
		})
		key("0")
		vi.advanceTimersByTime(200)
		expect(receive).toHaveBeenLastCalledWith(
			expect.objectContaining({ type: NOTE_OFF, number: 60 })
		)
	})
	it("registers eight numeric defaults and restores saved command settings", async () => {
		const input = (await createInputById("cosmo-dots")) as InputCosmoDots
		devices.push(input)
		expect(input.configuration.map((dot) => dot.trigger)).toEqual([
			"0",
			"1",
			"2",
			"3",
			"4",
			"5",
			"6",
			"7"
		])
		const dot = input.configuration[0]
		dot.trigger = "9"
		dot.command = { ...dot.command, type: CONTROL_CHANGE, number: 74, value: 91, channel: 3 }
		input.setDot(0, dot)
		const saved = JSON.parse(JSON.stringify(deviceDefinition(input)))
		const restored = (await createInputById(saved.type, saved.options)) as InputCosmoDots
		devices.push(restored)
		expect(restored.configuration).toEqual(input.configuration)
	})
	it("listens without a GUI, ignores repeats and sends timed note releases", () => {
		const { input, receive } = setup()
		key("0")
		key("0", { repeat: true })
		key("9")
		expect(receive).toHaveBeenCalledTimes(1)
		expect(receive).toHaveBeenLastCalledWith(
			expect.objectContaining({
				type: NOTE_ON,
				number: 60,
				channel: 1,
				startAt: 12,
				from: "Cosmo Dots"
			})
		)
		vi.advanceTimersByTime(200)
		expect(receive).toHaveBeenLastCalledWith(
			expect.objectContaining({ type: NOTE_OFF, number: 60, velocity: 0 })
		)
		input.destroy()
		key("0")
		expect(receive).toHaveBeenCalledTimes(2)
	})
	it("ignores typing, shortcuts and keys while another dialog is open", () => {
		const { receive } = setup()
		const field = document.createElement("input")
		document.body.append(field)
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "0", bubbles: true }))
		key("0", { ctrlKey: true })
		key("0", { isComposing: true })
		const dialog = document.createElement("dialog")
		document.body.append(dialog)
		dialog.showModal()
		key("0")
		expect(receive).not.toHaveBeenCalled()
	})
	it("activates onscreen dots and edits commands without playing in edit mode", async () => {
		const { input, receive } = setup()
		const panel = await input.createGui()
		document.body.append(panel)
		const buttons = panel.querySelectorAll("button")
		expect(buttons).toHaveLength(8)
		buttons[0].click()
		expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ type: NOTE_ON }))
		const edit = panel.querySelector("input")!
		edit.checked = true
		edit.dispatchEvent(new Event("change"))
		receive.mockClear()
		key("1")
		buttons[0].click()
		expect(receive).not.toHaveBeenCalled()
		const dialog = document.querySelector("dialog")!
		const trigger = dialog.querySelector("input")!
		trigger.dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true })
		)
		dialog.querySelector("select")!.value = PLAYBACK_TOGGLE
		const changed = vi.fn()
		input.addEventListener(EVENT_CONFIGURATION_CHANGED, changed)
		dialog.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }))
		await Promise.resolve()
		expect(changed).toHaveBeenCalledOnce()
		expect(buttons[0].textContent).toBe("ArrowUp")
		edit.checked = false
		edit.dispatchEvent(new Event("change"))
		key("ArrowUp")
		expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ type: PLAYBACK_TOGGLE }))
		vi.advanceTimersByTime(1000)
		expect(receive).toHaveBeenCalledTimes(1)
	})
	it("cancels dialog edits and releases notes on blur and GUI destruction", async () => {
		const { input, receive } = setup()
		const panel = await input.createGui()
		key("0")
		window.dispatchEvent(new Event("blur"))
		expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ type: NOTE_OFF }))
		const edit = panel.querySelector("input")!
		edit.checked = true
		edit.dispatchEvent(new Event("change"))
		panel.querySelector("button")!.click()
		const dialog = document.querySelector("dialog")!
		dialog.querySelector("input")!.value = "9"
		Array.from(dialog.querySelectorAll("button"))
			.find((button) => button.textContent === "Cancel")!
			.click()
		await Promise.resolve()
		expect(input.configuration[0].trigger).toBe("0")
		await input.destroyGui()
		key("1")
		await input.destroyGui()
		expect(receive).toHaveBeenLastCalledWith(
			expect.objectContaining({ type: NOTE_OFF, number: 61 })
		)
		expect(await input.createGui()).not.toBe(panel)
	})
})