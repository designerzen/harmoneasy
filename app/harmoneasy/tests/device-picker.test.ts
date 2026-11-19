// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import { createDevicePicker } from "../source/components/graph/DevicePicker"
import { elementIcon } from "../source/components/graph/element-icons"
import type { ChainUIContext } from "../source/components/graph/chain-ui-context"

const factories = vi.hoisted(() => ({
	outputs: vi.fn(),
	instruments: vi.fn(),
	createOutput: vi.fn(),
	createInstrument: vi.fn()
}))
vi.mock("audiobus/instruments/instrument-factory-ui.ts", () => ({
	getInstrumentFactories: factories.instruments,
	createInstrumentById: factories.createInstrument
}))
vi.mock("audiobus/io/output-factory", () => ({ createOutputById: factories.createOutput }))
vi.mock("audiobus/midi/shared-webmidi", () => ({
	sharedWebMidi: Object.assign(new EventTarget(), { inputs: [], outputs: [] })
}))
vi.mock("audiobus/hardware/midi-devices/device-profiles", () => ({
	MIDI_DEVICE_PROFILES: {},
	matchMidiDeviceProfile: vi.fn(),
	loadMidiProfilesForPorts: vi.fn().mockResolvedValue(undefined),
	onMidiDeviceProfilesChanged: () => () => {}
}))

let picker: ReturnType<typeof createDevicePicker>
afterEach(() => {
	picker?.destroy()
	document.body.replaceChildren()
	vi.clearAllMocks()
})

it("lists shared plugins once as outputs and keeps instrument-only outputs playable", async () => {
	const plugin = {
		id: "wam2:test",
		name: "Test Piano (WAM2)",
		description: "Piano",
		type: "engine",
		subtype: "instrument"
	}
	const synth = { ...plugin, id: "synth-oscillator", name: "Synth Oscillator" }
	factories.outputs.mockResolvedValue([plugin])
	factories.instruments.mockReturnValue([plugin, synth])
	const output = { name: "Piano" }
	const instrument = { name: "Oscillator" }
	factories.createOutput.mockResolvedValue(output)
	factories.createInstrument.mockResolvedValue(instrument)
	const audioContext = {}
	const mixer = {}
	const manager = Object.assign(new EventTarget(), {
		devices: [],
		audioContext,
		outputMixer: mixer,
		addDevice: vi.fn()
	})
	const chain = { outputManager: { getFactories: factories.outputs } }
	picker = createDevicePicker({ chain, manager } as unknown as ChainUIContext, {
		direction: "output"
	})
	document.body.append(picker.element)
	await vi.waitFor(() => expect(picker.element.getAttribute("aria-busy")).toBe("false"))
	const choices = [...picker.element.querySelectorAll<HTMLButtonElement>(".element-choice")]
	expect(choices.map((button) => button.textContent).sort()).toEqual([
		"Synth Oscillator",
		"Test Piano (WAM2)"
	])
	expect(picker.element.textContent).toContain("2 matching outputs")
	choices.find((button) => button.textContent === plugin.name)!.click()
	await vi.waitFor(() => expect(manager.addDevice).toHaveBeenCalledWith(chain, output, "output"))
	expect(factories.createOutput).toHaveBeenCalledWith(plugin.id, { audioContext, mixer })
	;[...picker.element.querySelectorAll<HTMLButtonElement>(".element-choice")]
		.find((button) => button.textContent === synth.name)!
		.click()
	await vi.waitFor(() =>
		expect(manager.addDevice).toHaveBeenCalledWith(chain, instrument, "output")
	)
	expect(factories.createInstrument).toHaveBeenCalledWith(audioContext, synth.id, {
		audioContext,
		mixer
	})
})

it("uses the same instrument icon in the output picker and existing instrument nodes", () => {
	expect(elementIcon("output", "synth-oscillator")).toBe(
		elementIcon("instrument", "synth-oscillator")
	)
})

it("lists outputs this browser cannot run last, disabled and saying what they need", async () => {
	const synth = {
		id: "synth",
		name: "Synth",
		description: "",
		type: "engine",
		subtype: "instrument"
	}
	const bluetooth = {
		...synth,
		id: "ble-midi",
		name: "BLE MIDI",
		type: "midi",
		subtype: "device",
		requires: ["bluetooth"]
	}
	factories.outputs.mockResolvedValue([bluetooth, synth])
	factories.instruments.mockReturnValue([])
	const manager = Object.assign(new EventTarget(), { devices: [], addDevice: vi.fn() })
	picker = createDevicePicker(
		{ chain: { outputManager: { getFactories: factories.outputs } }, manager } as any,
		{ direction: "output" }
	)
	document.body.append(picker.element)
	await vi.waitFor(() => expect(picker.element.getAttribute("aria-busy")).toBe("false"))
	const sections = [...picker.element.querySelectorAll("section")]
	expect(sections.at(-1)!.classList).toContain("unavailable-choices")
	expect(picker.element.textContent).toContain("1 matching outputs")
	const disabled = sections.at(-1)!.querySelector<HTMLButtonElement>("button")!
	expect(disabled.disabled).toBe(true)
	expect(disabled.textContent).toContain("BLE MIDI")
	expect(disabled.textContent).toContain("Needs Web Bluetooth")
	disabled.click()
	expect(factories.createOutput).not.toHaveBeenCalled()
})
