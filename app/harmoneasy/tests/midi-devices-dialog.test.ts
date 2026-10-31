// @vitest-environment happy-dom
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { createMidiDevicesDialog } from "../source/services/midi-devices-dialog"
import * as registry from "audiobus/midi/hardware/device-profiles"
import {
	EVENT_CANCEL,
	EVENT_CLOSE,
	EVENT_CLOSED,
	EVENT_DEVICE_LIST_CHANGED,
	EVENT_MIDI_CHANNELS_CHANGED,
	EVENT_READY,
	EVENT_VISIBILITY_CHANGE
} from "audiobus/event-constants"

const mock = vi.hoisted(() => ({
	service: Object.assign(new EventTarget(), {
		inputs: [] as any[],
		outputs: [] as any[],
		isReady: true,
		observedChannels: vi.fn((_id: string) => [3])
	})
}))
vi.mock("audiobus/midi/shared-webmidi", () => ({ sharedWebMidi: mock.service }))
const markup = readFileSync(resolve("index.html"), "utf8")
let dispose: () => void
let hidden = false
const dialog = () => document.querySelector<HTMLDialogElement>("#midi-devices-dialog")!
const button = () => document.querySelector<HTMLButtonElement>("#btn-midi-devices")!
const rows = () => document.querySelector<HTMLTableSectionElement>("#midi-devices-list")!
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
		page.querySelector("#midi-dialog")!.cloneNode(true),
		page.querySelector("#midi-devices-dialog")!.cloneNode(true)
	)
	mock.service.inputs = [port("Keys <b>")]
	mock.service.outputs = [port("Synth", "output")]
	mock.service.isReady = true
	dispose = createMidiDevicesDialog()
})
afterEach(() => {
	dispose()
	vi.restoreAllMocks()
	document.body.replaceChildren()
})

it("opens from the global MIDI menu and updates connected inputs, outputs, channel and port statuses while visible", () => {
	expect(document.querySelector("#action-bar #btn-midi")).not.toBeNull()
	expect(document.querySelector("#midi-dialog #btn-midi-devices")).not.toBeNull()
	button().click()
	expect(dialog().open).toBe(true)
	expect(rows().children).toHaveLength(2)
	expect(rows().textContent).toContain("Keys <b>")
	expect(rows().querySelector("b")).toBeNull()
	expect(rows().children[0].textContent).toContain("InputConnected · Open3")
	expect(rows().children[1].textContent).toContain("OutputConnected · Open—")
	mock.service.inputs[0].connection = "closed"
	mock.service.inputs[0].emit(EVENT_CLOSED)
	expect(rows().textContent).toContain("Connected · Closed")
	mock.service.observedChannels.mockReturnValue([3, 7])
	mock.service.dispatchEvent(new Event(EVENT_MIDI_CHANNELS_CHANGED))
	expect(rows().textContent).toContain("3, 7")
	mock.service.inputs.push(port("Pads"))
	mock.service.dispatchEvent(new Event(EVENT_DEVICE_LIST_CHANGED))
	expect(rows().children).toHaveLength(3)
	mock.service.inputs = []
	mock.service.dispatchEvent(new Event(EVENT_DEVICE_LIST_CHANGED))
	expect(rows().children).toHaveLength(1)
	expect(rows().textContent).toContain("Synth")
})

it("does no device work while closed, detaches listeners on dismissal and takes a fresh snapshot on reopening", () => {
	expect(mock.service.inputs[0].addListener).not.toHaveBeenCalled()
	expect(registry.loadMidiProfilesForPorts).not.toHaveBeenCalled()
	mock.service.dispatchEvent(new Event(EVENT_DEVICE_LIST_CHANGED))
	expect(rows().children).toHaveLength(0)
	button().click()
	dialog().close()
	dialog().dispatchEvent(new Event(EVENT_CLOSE))
	const snapshot = rows().innerHTML
	const oldPort = mock.service.inputs[0]
	expect([...oldPort.events.values()].every((listeners) => listeners.size === 0)).toBe(true)
	mock.service.observedChannels.mockClear()
	vi.mocked(registry.loadMidiProfilesForPorts).mockClear()
	mock.service.inputs = [port("New controller")]
	mock.service.dispatchEvent(new Event(EVENT_DEVICE_LIST_CHANGED))
	mock.service.dispatchEvent(new Event(EVENT_MIDI_CHANNELS_CHANGED))
	expect(rows().innerHTML).toBe(snapshot)
	expect(mock.service.observedChannels).not.toHaveBeenCalled()
	expect(registry.loadMidiProfilesForPorts).not.toHaveBeenCalled()
	button().click()
	expect(rows().textContent).toContain("New controller")
	expect(rows().textContent).not.toContain("Keys <b>")
})

it("previews registry artwork and product links for matching IDs and exact port names without opening a live instrument GUI", () => {
	mock.service.inputs = [
		port("digit-cmpsr"),
		{ ...port("host-assigned-id"), name: "minilogue" },
		port("unknown")
	]
	mock.service.outputs = [{ ...port("reface-output", "output"), name: "reface CS" }]
	button().click()
	expect(registry.loadMidiProfilesForPorts).toHaveBeenCalledTimes(1)
	const previews = rows().querySelectorAll<HTMLElement>("[data-midi-profile]")
	expect([...previews].map((preview) => preview.dataset.midiProfile)).toEqual([
		"digit-cmpsr",
		"korg-minilogue",
		"yamaha-reface-cs"
	])
	expect(previews[0].querySelector("img")!.src).toContain("/digit-cmpsr/panel.svg")
	expect(previews[1].querySelector("img")!.alt).toContain("illustration")
	expect([...previews[1].querySelectorAll("a")].map((link) => link.textContent)).toEqual([
		"Manufacturer",
		"Product",
		"MIDI documentation"
	])
	expect(previews[1].querySelectorAll("a")[1].href).toBe(
		registry.MIDI_DEVICE_PROFILES["korg-minilogue"].productUrl
	)
	expect(rows().children[2].querySelector("figure")).toBeNull()
	expect(rows().querySelector("input, select, button")).toBeNull()
	expect(previews[2].textContent).toContain("Yamaha reface CS")
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
		button().click()
		expect(rows().querySelector("figure")).toBeNull()
		registry.MIDI_DEVICE_PROFILES[id] = {
			...registry.MIDI_DEVICE_PROFILES["arcana-strum"],
			id,
			ids: [id],
			name: "Newly loaded preview"
		}
		notify()
		expect(rows().querySelector("figure")!.textContent).toContain("Newly loaded preview")
		dialog().close()
		dialog().dispatchEvent(new Event(EVENT_CLOSE))
		expect(unsubscribe).toHaveBeenCalledOnce()
		registry.MIDI_DEVICE_PROFILES[id].name = "Updated while closed"
		const snapshot = rows().innerHTML
		notify()
		expect(rows().innerHTML).toBe(snapshot)
		button().click()
		expect(rows().textContent).toContain("Updated while closed")
	} finally {
		delete registry.MIDI_DEVICE_PROFILES[id]
	}
})

it("suspends updates in a hidden browser tab and resumes when visible; Escape also stops monitoring", () => {
	button().click()
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
	dialog().dispatchEvent(new Event(EVENT_CANCEL))
	expect(
		[...mock.service.inputs[0].events.values()].every((listeners) => listeners.size === 0)
	).toBe(true)
	dialog().close()
})

it("shows readiness and empty states without requesting access and releases listeners when disposed", () => {
	mock.service.inputs = []
	mock.service.outputs = []
	mock.service.isReady = false
	button().click()
	expect(document.querySelector("#midi-devices-status")!.textContent).toContain("not ready")
	mock.service.isReady = true
	mock.service.dispatchEvent(new Event(EVENT_READY))
	expect(document.querySelector("#midi-devices-status")!.textContent).toBe(
		"No MIDI devices connected."
	)
	expect(dialog().querySelector<HTMLElement>(".midi-devices-table")!.hidden).toBe(true)
	dispose()
	mock.service.inputs = [port("After cleanup")]
	mock.service.dispatchEvent(new Event(EVENT_DEVICE_LIST_CHANGED))
	expect(rows().children).toHaveLength(0)
	expect(button().disabled).toBe(true)
})