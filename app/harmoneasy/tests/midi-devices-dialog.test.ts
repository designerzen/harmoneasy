// @vitest-environment happy-dom
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { createMidiDevicesDialog } from "../source/services/midi-devices-dialog"
import * as registry from "audiobus/hardware/midi-devices/device-profiles"
import {
	EVENT_CLOSED,
	EVENT_DEVICE_LIST_CHANGED,
	EVENT_MIDI_CHANNELS_CHANGED,
	EVENT_READY,
	EVENT_TOGGLE,
	EVENT_VISIBILITY_CHANGE
} from "audiobus/events/event-constants"

const mock = vi.hoisted(() => ({
	service: Object.assign(new EventTarget(), {
		inputs: [] as any[],
		outputs: [] as any[],
		isReady: true,
		observedChannels: vi.fn((_id: string) => [3])
	})
}))
vi.mock("audiobus/midi/shared-webmidi", () => ({
	sharedWebMidi: mock.service
}))
const markup = readFileSync(resolve("index.html"), "utf8")
let dispose: () => void
let hidden = false
const connections = vi.fn((_port: { id: string }) => [] as string[])
const dialog = () => document.querySelector<HTMLDialogElement>("#midi-dialog")!
const rows = () => document.querySelector<HTMLUListElement>("#midi-devices-list")!
const status = () => document.querySelector<HTMLElement>("#midi-devices-status")!
const open = () => {
	dialog().showModal()
	dialog().dispatchEvent(new Event(EVENT_TOGGLE))
}
const close = () => {
	dialog().close()
	dialog().dispatchEvent(new Event(EVENT_TOGGLE))
}
function port(id: string, type = "input") {
	const events = new Map<string, Set<() => void>>()
	return {
		id,
		type,
		name: id,
		manufacturer: "Test maker",
		state: "connected",
		connection: "open",
		events,
		addListener: vi.fn((type: string, callback: () => void) => {
			const listeners = events.get(type) ?? new Set()
			listeners.add(callback)
			events.set(type, listeners)
		}),
		removeListener: vi.fn((type: string, callback: () => void) =>
			events.get(type)?.delete(callback)
		),
		emit(type: string) {
			for (const callback of events.get(type) ?? []) {
				callback()
			}
		}
	}
}
beforeEach(() => {
	vi.clearAllMocks()
	mock.service.observedChannels.mockReturnValue([3])
	vi.spyOn(registry, "loadMidiProfilesForPorts").mockResolvedValue()
	hidden = false
	vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden)
	const page = new DOMParser().parseFromString(markup, "text/html")
	document.body.replaceChildren(
		page.querySelector("#action-bar")!.cloneNode(true),
		page.querySelector("#midi-dialog")!.cloneNode(true)
	)
	mock.service.inputs = [port("Keys <b>")]
	mock.service.outputs = [port("Synth", "output")]
	mock.service.isReady = true
	connections.mockReturnValue([])
	dispose = createMidiDevicesDialog(document, connections)
})
afterEach(() => {
	dispose()
	vi.restoreAllMocks()
	document.body.replaceChildren()
})

it("lists devices inside the MIDI dialog with ports, channels, chains and capabilities while visible", () => {
	expect(document.querySelector("#action-bar #btn-midi")).not.toBeNull()
	expect(document.querySelector("#btn-midi-devices")).toBeNull()
	connections.mockImplementation((port) => (port.id === "Synth" ? ["Lead"] : []))
	open()
	expect(rows().children).toHaveLength(2)
	expect(rows().textContent).toContain("Keys <b>")
	expect(rows().querySelector("b")).toBeNull()
	const [keys, synth] = rows().children
	expect(keys.textContent).toContain("ConnectedPortsIn · openChannels heard3")
	expect(keys.textContent).toContain("Not used by any chain")
	expect(keys.textContent).toContain("Sends MIDI")
	expect(synth.textContent).toContain("Out · open")
	expect(synth.textContent).toContain("ChainsLead")
	expect(synth.textContent).toContain("Receives MIDI")
	expect(synth.textContent).not.toContain("Channels heard")
	expect(status().textContent).toBe("2 connected")
	mock.service.inputs[0].connection = "closed"
	mock.service.inputs[0].emit(EVENT_CLOSED)
	expect(rows().textContent).toContain("In · idle")
	mock.service.observedChannels.mockReturnValue([3, 7])
	mock.service.dispatchEvent(new Event(EVENT_MIDI_CHANNELS_CHANGED))
	expect(rows().textContent).toContain("3, 7")
	mock.service.inputs.push(port("Pads"))
	mock.service.dispatchEvent(new Event(EVENT_DEVICE_LIST_CHANGED))
	expect(rows().children).toHaveLength(3)
})

it("groups a device's input and output ports and keeps unplugged devices listed as disconnected", () => {
	mock.service.inputs = [{ ...port("in-1"), name: "Keystation" }]
	mock.service.outputs = [{ ...port("out-1", "output"), name: "Keystation" }]
	open()
	expect(rows().textContent).toContain("Keystation")
	const keystation = [...rows().children].find((item) =>
		item.textContent!.includes("Keystation")
	)!
	expect(keystation.textContent).toContain("In · open")
	expect(keystation.textContent).toContain("Out · open")
	expect(keystation.textContent).toContain("Sends MIDI · Receives MIDI")
	mock.service.inputs = [port("Pads")]
	mock.service.outputs = []
	mock.service.dispatchEvent(new Event(EVENT_DEVICE_LIST_CHANGED))
	const items = [...rows().children] as HTMLElement[]
	expect(items[0].textContent).toContain("Pads")
	expect(items[0].dataset.state).toBe("connected")
	const gone = items.find((item) => item.textContent!.includes("Keystation"))!
	expect(gone.dataset.state).toBe("disconnected")
	expect(gone.textContent).toContain("Disconnected")
	expect(gone.textContent).not.toContain("· open")
	expect(status().textContent).toBe("1 connected · 3 disconnected")
})

it("remembers ports that come and go while closed but does no rendering work until opened", () => {
	expect(mock.service.inputs[0].addListener).not.toHaveBeenCalled()
	expect(registry.loadMidiProfilesForPorts).not.toHaveBeenCalled()
	mock.service.inputs = [port("Brief visit")]
	mock.service.dispatchEvent(new Event(EVENT_DEVICE_LIST_CHANGED))
	mock.service.inputs = []
	mock.service.dispatchEvent(new Event(EVENT_DEVICE_LIST_CHANGED))
	expect(rows().children).toHaveLength(0)
	expect(mock.service.observedChannels).not.toHaveBeenCalled()
	open()
	expect(rows().textContent).toContain("Brief visit")
	close()
	const snapshot = rows().innerHTML
	const oldPort = mock.service.outputs[0]
	expect([...oldPort.events.values()].every((listeners) => listeners.size === 0)).toBe(true)
	vi.mocked(registry.loadMidiProfilesForPorts).mockClear()
	mock.service.inputs = [port("New controller")]
	mock.service.dispatchEvent(new Event(EVENT_MIDI_CHANNELS_CHANGED))
	expect(rows().innerHTML).toBe(snapshot)
	expect(registry.loadMidiProfilesForPorts).not.toHaveBeenCalled()
	open()
	expect(rows().textContent).toContain("New controller")
})

function profile(id: string, extra: Partial<registry.MidiDeviceProfile> = {}) {
	registry.MIDI_DEVICE_PROFILES[id] = {
		id,
		schemaVersion: 1,
		name: id,
		manufacturer: "Profile maker",
		description: "",
		ids: [id],
		portNames: [],
		documentation: [],
		abilities: [],
		hardwareControls: [],
		notice: "",
		controls: [],
		modes: [],
		gui: { type: "column" },
		...extra
	}
}

it("shows profile artwork, abilities and product links for matching IDs and exact port names", () => {
	profile("test-keys", {
		name: "Test Keys",
		icon: "/test-keys.svg",
		portNames: ["Keys MKII"],
		abilities: ["Velocity keys"],
		productUrl: "https://example.com/keys",
		documentation: [{ title: "MIDI", url: "https://example.com/midi" }]
	})
	profile("test-synth")
	mock.service.inputs = [{ ...port("host-assigned-id"), name: "Keys MKII" }, port("unknown")]
	mock.service.outputs = [port("test-synth", "output")]
	try {
		open()
		expect(registry.loadMidiProfilesForPorts).toHaveBeenCalledTimes(1)
		const profiled = rows().querySelectorAll<HTMLElement>("[data-midi-profile]")
		expect([...profiled].map((item) => item.dataset.midiProfile).sort()).toEqual([
			"test-keys",
			"test-synth"
		])
		const keys = rows().querySelector<HTMLElement>('[data-midi-profile="test-keys"]')!
		expect(keys.querySelector("img")!.getAttribute("src")).toBe("/test-keys.svg")
		expect(keys.textContent).toContain("Profile maker · Test Keys")
		expect(keys.textContent).toContain("Sends MIDI · Velocity keys")
		expect([...keys.querySelectorAll("a")].map((link) => link.textContent)).toEqual([
			"Product",
			"MIDI documentation"
		])
		expect(keys.querySelector("a")!.href).toBe("https://example.com/keys")
		expect(rows().querySelector("input, select, button")).toBeNull()
	} finally {
		delete registry.MIDI_DEVICE_PROFILES["test-keys"]
		delete registry.MIDI_DEVICE_PROFILES["test-synth"]
	}
})

it("shows profiles arriving after opening and ignores registry notifications after closing", () => {
	let notify = () => {}
	const unsubscribe = vi.fn()
	vi.spyOn(registry, "onMidiDeviceProfilesChanged").mockImplementation((listener) => {
		notify = listener
		return unsubscribe
	})
	const id = "preview-test-controller"
	mock.service.inputs = [port(id)]
	mock.service.outputs = []
	try {
		open()
		expect(rows().querySelector("[data-midi-profile]")).toBeNull()
		profile(id, { name: "Newly loaded preview" })
		notify()
		expect(rows().querySelector("[data-midi-profile]")!.textContent).toContain(
			"Newly loaded preview"
		)
		close()
		expect(unsubscribe).toHaveBeenCalledOnce()
		registry.MIDI_DEVICE_PROFILES[id].name = "Updated while closed"
		const snapshot = rows().innerHTML
		notify()
		expect(rows().innerHTML).toBe(snapshot)
		open()
		expect(rows().textContent).toContain("Updated while closed")
	} finally {
		delete registry.MIDI_DEVICE_PROFILES[id]
	}
})

it("suspends updates in a hidden browser tab and resumes when visible", () => {
	open()
	hidden = true
	document.dispatchEvent(new Event(EVENT_VISIBILITY_CHANGE))
	const snapshot = rows().innerHTML
	mock.service.observedChannels.mockClear()
	mock.service.inputs = [port("While away")]
	mock.service.dispatchEvent(new Event(EVENT_DEVICE_LIST_CHANGED))
	expect(rows().innerHTML).toBe(snapshot)
	expect(mock.service.observedChannels).not.toHaveBeenCalled()
	hidden = false
	document.dispatchEvent(new Event(EVENT_VISIBILITY_CHANGE))
	expect(rows().textContent).toContain("While away")
	close()
	expect(
		[...mock.service.inputs[0].events.values()].every((listeners) => listeners.size === 0)
	).toBe(true)
})

it("shows readiness and empty states without requesting access and releases listeners when disposed", () => {
	dispose()
	mock.service.inputs = []
	mock.service.outputs = []
	mock.service.isReady = false
	dispose = createMidiDevicesDialog(document, connections)
	open()
	expect(status().textContent).toContain("starts with the session")
	mock.service.isReady = true
	mock.service.dispatchEvent(new Event(EVENT_READY))
	expect(status().textContent).toContain("No MIDI devices found")
	expect(rows().hidden).toBe(true)
	dispose()
	mock.service.inputs = [port("After cleanup")]
	mock.service.dispatchEvent(new Event(EVENT_DEVICE_LIST_CHANGED))
	expect(rows().children).toHaveLength(0)
})
