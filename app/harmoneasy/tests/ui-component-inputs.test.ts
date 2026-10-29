// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { UI_INPUT_COMPONENTS } from "../../../packages/audiobus/ui/input-components"
import { loadUIComponent } from "../../../packages/audiobus/ui/components"
import {
	createInputById,
	getAvailableInputFactories
} from "../../../packages/audiobus/io/input-factory"
import { getInputDefinition } from "../../../packages/audiobus/io/input-definitions"
import { deviceDefinition } from "../../../packages/audiobus/io/device-definition"
import InputWebComponent from "../../../packages/audiobus/io/inputs/input-web-component"
import {
	INPUT_EVENT,
	NOTE_ON,
	NOTE_OFF,
	PITCH_BEND,
	CONTROL_CHANGE,
	PROGRAM_CHANGE
} from "../../../packages/audiobus/commands"
import {
	dispatchInstrumentEvent,
	noteDetail
} from "../../../packages/audiobus/ui/interfaces/instrument"

// Happy DOM does not implement ElementInternals and mishandles the star SVG's embedded styles.
vi.mock(
	"../../../packages/audiobus/ui/controllers/star-controller/star-controller.svg?raw",
	() => ({ default: "<svg></svg>" })
)
beforeAll(() => {
	if (!HTMLElement.prototype.attachInternals) {
		Object.defineProperty(HTMLElement.prototype, "attachInternals", {
			configurable: true,
			value: () => ({ setFormValue() {} })
		})
	}
})

const inputs: InputWebComponent[] = []
afterEach(async () => {
	for (const input of inputs.splice(0)) {
		input.destroy()
	}
	document.body.replaceChildren()
})

async function setup(component = "svg-keyboard", options = {}) {
	const input = (await createInputById(component, {
		now: () => 123,
		...options
	})) as InputWebComponent
	inputs.push(input)
	const commands: any[] = []
	input.addEventListener(INPUT_EVENT, (event: any) => commands.push(event.command))
	const element = await input.createGui()
	document.body.append(element)
	return { input, element, commands }
}

describe("Photosynth UI inputs", () => {
	it.each(Object.entries(UI_INPUT_COMPONENTS))(
		"offers and mounts %s as an input",
		async (id, component) => {
			expect(getAvailableInputFactories().some((factory) => factory.id === id)).toBe(true)
			expect(getInputDefinition(id)?.category).toBe("UI")
			const { input, element } = await setup(id)
			expect(element.localName).toBe(component.tag)
			expect(element.shadowRoot?.childElementCount).toBeGreaterThan(0)
			expect(deviceDefinition(input)?.type).toBe(id)
			expect(await input.createGui()).toBe(element)
		}
	)

	it("routes real controller notes, channels, velocity and original MIDI 2 packets", async () => {
		const { element, commands } = await setup("svg-keyboard", {
			attributes: { group: 2, channel: 3 }
		})
		const keyboard = element as any
		keyboard.noteOn(64, 0.5, 10)
		keyboard.noteOff(64, 0.25, 10)
		expect(commands.map((command) => command.type)).toEqual([NOTE_ON, NOTE_OFF])
		expect(commands[0]).toMatchObject({ number: 64, channel: 4, velocity: 64, time: 123 })
		expect(commands[0].ump).toEqual(
			noteDetail(NOTE_ON, 64, 0.5, 10, { group: 2, channel: 3 }).ump
		)
		expect(commands[1].ump[1] >>> 16).toBe(Math.round(0.25 * 65535))
	})

	it("preserves bend, controller and program messages and resets held state on teardown", async () => {
		const { input, element, commands } = await setup()
		const keyboard = element as any
		keyboard.noteOn(60, 1, 1)
		keyboard.pitchBend(0.5)
		keyboard.controlChange(64, 1)
		keyboard.programChange(12, 130)
		expect(commands.map((command) => command.type)).toEqual([
			NOTE_ON,
			PITCH_BEND,
			CONTROL_CHANGE,
			PROGRAM_CHANGE
		])
		expect(commands[3].ump[1]).toBe((12 << 24) | (1 << 8) | 2)
		await input.destroyGui()
		expect(commands.filter((command) => command.type === NOTE_OFF)).toHaveLength(1)
		expect(commands.filter((command) => command.type === PITCH_BEND).at(-1).value).toBe(8192)
		expect(commands.filter((command) => command.type === CONTROL_CHANGE).at(-1).value).toBe(0)
		expect(element.isConnected).toBe(false)
	})

	it("keeps shared pitches sounding until the last gesture releases them", async () => {
		const { input, element, commands } = await setup()
		const address = { group: 0, channel: 0 }
		for (const id of [1, 2]) {
			dispatchInstrumentEvent(element, NOTE_ON, noteDetail(NOTE_ON, 60, 1, id, address))
		}
		dispatchInstrumentEvent(element, NOTE_OFF, noteDetail(NOTE_OFF, 60, 0, 1, address))
		expect(commands.map((command) => command.type)).toEqual([NOTE_ON])
		await input.destroyGui()
		expect(commands.map((command) => command.type)).toEqual([NOTE_ON, NOTE_OFF])
	})

	it("releases notes on DOM removal and restores settings when reopened", async () => {
		const { input, element, commands } = await setup("svg-keyboard", {
			attributes: { min: 48, max: 72 }
		})
		;(element as any).noteOn(60, 1, 1)
		element.remove()
		expect(commands.at(-1).type).toBe(NOTE_OFF)
		await input.destroyGui()
		const replacement = await input.createGui()
		expect(replacement.getAttribute("min")).toBe("48")
		expect(replacement).not.toBe(element)
	})

	it("cancels pending GUI creation when destroyed", async () => {
		const input = new InputWebComponent({ component: "note-slider" })
		inputs.push(input)
		const pending = input.createGui()
		input.destroy()
		await expect(pending).rejects.toMatchObject({ name: "AbortError" })
	})

	it("restores a saved piano roll sequence when reopened", async () => {
		const notes = [{ midi: 60, start: 0, duration: 2, velocity: 0.75 }]
		const { input, element } = await setup("piano-roll", { notes })
		expect((element as any).notes).toEqual(notes)
		await input.destroyGui()
		const replacement = await input.createGui()
		expect((replacement as any).notes).toEqual(notes)
	})

	it.each([
		"horizontal-bars-audio-viz",
		"vertical-bars-audio-viz",
		"waveform-audio-viz",
		"spectrum-audio-viz",
		"pointer-audio-viz",
		"song-audio-viz",
		"spectrum-visualiser",
		"butterchurn-visualiser",
		"sion-player"
	])("loads the standalone %s component", async (tag) => {
		await loadUIComponent(tag)
		expect(customElements.get(tag)).toBeDefined()
	})
})