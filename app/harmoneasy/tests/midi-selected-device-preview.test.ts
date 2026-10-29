// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import {
	createMidiInputControls,
	type MidiInputDeviceOption
} from "audiobus/io/inputs/midi-input-controls"
import * as registry from "audiobus/midi/hardware/device-profiles"
import { EVENT_CHANGE } from "audiobus/event-constants"

const controls: ReturnType<typeof createMidiInputControls>[] = []
beforeEach(() => {
	vi.spyOn(registry, "loadMidiProfilesForPorts").mockResolvedValue()
})
afterEach(() => {
	controls.splice(0).forEach((control) => control.destroy())
	vi.restoreAllMocks()
	document.body.replaceChildren()
})

it.each(["input", "output"] as const)(
	"shows selected %s artwork, description and abilities and clears it for All or unknown devices",
	(direction) => {
		const changed = vi.fn()
		const gui = createMidiInputControls(
			{},
			() => [
				{ id: "digit-cmpsr", name: "Renamed controller" },
				{
					id: "opaque-id",
					name: "Arturia MiniLab 3",
					portName: "MiniLab 3",
					manufacturer: "Arturia"
				},
				{ id: "unknown", name: "Other MIDI device" }
			],
			changed,
			direction
		)
		controls.push(gui)
		document.body.append(gui.element)
		const select = gui.element.querySelector("select")!
		const choose = (id: string) => {
			select.value = id
			select.dispatchEvent(new Event(EVENT_CHANGE))
		}
		expect(gui.element.querySelector("figure")).toBeNull()
		choose("digit-cmpsr")
		const first = gui.element.querySelector<HTMLElement>("figure")!
		expect(first.dataset.midiProfile).toBe("digit-cmpsr")
		expect(first.querySelector("img")!.src).toContain("/digit-cmpsr/panel.svg")
		expect(first.textContent).toContain(
			registry.MIDI_DEVICE_PROFILES["digit-cmpsr"].description
		)
		expect(first.textContent).toContain("Smart sustain")
		expect([...first.querySelectorAll("a")].map((link) => link.textContent)).toEqual([
			"Manufacturer",
			"Product",
			"MIDI documentation"
		])
		choose("opaque-id")
		expect(gui.element.querySelector<HTMLElement>("figure")!.dataset.midiProfile).toBe(
			"arturia-minilab-3"
		)
		expect(gui.element.querySelector("img")!.src).toContain("/arturia-minilab-3/panel.svg")
		choose("unknown")
		expect(gui.element.querySelector("figure")).toBeNull()
		choose("digit-cmpsr")
		choose("")
		expect(gui.element.querySelector("figure")).toBeNull()
		expect(gui.element.querySelectorAll("select")).toHaveLength(2)
		expect(changed).toHaveBeenCalledTimes(5)
	}
)

it("uses the hardware registry ID independently of native routing indexes and clears stale previews on disconnection", () => {
	let devices: MidiInputDeviceOption[] = [
		{ id: "3", registryId: "yamaha-reface-cs", name: "Custom port name" }
	]
	const gui = createMidiInputControls({ selectedDevice: "3" }, () => devices, undefined, "output")
	controls.push(gui)
	expect(gui.element.querySelector<HTMLElement>("figure")!.dataset.midiProfile).toBe(
		"yamaha-reface-cs"
	)
	devices = []
	gui.refresh()
	expect(gui.element.querySelector("figure")).toBeNull()
	expect(gui.element.querySelector<HTMLElement>(".midi-selected-device-preview")!.hidden).toBe(
		true
	)
	devices = [{ id: "3", registryId: "yamaha-reface-cs", name: "Custom port name" }]
	gui.refresh()
	expect(gui.element.querySelector("img")!.src).toContain("/yamaha-reface-cs/panel.svg")
})

it("refreshes when a matching profile arrives later and stops registry updates after GUI destruction", () => {
	let notify = () => {}
	const unsubscribe = vi.fn()
	vi.spyOn(registry, "onMidiDeviceProfilesChanged").mockImplementation((listener) => {
		notify = listener
		return unsubscribe
	})
	const id = "selected-preview-runtime"
	const gui = createMidiInputControls({ selectedDevice: id }, () => [{ id, name: "New device" }])
	controls.push(gui)
	try {
		expect(gui.element.querySelector("figure")).toBeNull()
		registry.MIDI_DEVICE_PROFILES[id] = {
			...registry.MIDI_DEVICE_PROFILES["arcana-strum"],
			id,
			ids: [id],
			name: "Runtime preview"
		}
		notify()
		expect(gui.element.querySelector("figure")!.textContent).toContain("Runtime preview")
		const snapshot = gui.element.innerHTML
		gui.destroy()
		expect(unsubscribe).toHaveBeenCalledOnce()
		registry.MIDI_DEVICE_PROFILES[id] = {
			...registry.MIDI_DEVICE_PROFILES[id],
			name: "Later change"
		}
		notify()
		expect(gui.element.innerHTML).toBe(snapshot)
	} finally {
		delete registry.MIDI_DEVICE_PROFILES[id]
	}
})