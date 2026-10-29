// @vitest-environment happy-dom
import { runUI } from "./native-ui"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { createChainSidebar } from "../source/components/graph/ChainSidebar"
import { createTransformerPicker } from "../source/components/graph/Transformers"
import { createDeviceDialog } from "../source/components/graph/DeviceDialog"
import { createSharedDevices } from "../source/components/graph/SharedDevices"
import { defineDevice } from "audiobus/io/device-definition"
import "./midi-profile-runtime-setup"
import { EVENT_DEVICE_LIST_CHANGED } from "audiobus/event-constants"

const mocks = vi.hoisted(() => ({
	input: vi.fn(),
	output: vi.fn(),
	instrument: vi.fn(),
	addDevice: vi.fn(),
	appendTransformer: vi.fn(),
	inputs: vi.fn(),
	outputs: vi.fn(),
	instruments: vi.fn(),
	devices: [] as any[],
	attachDevice: vi.fn(),
	midi: Object.assign(new EventTarget(), { inputs: [] as any[], outputs: [] as any[] })
}))
vi.mock("audiobus/midi/shared-webmidi", () => ({ sharedWebMidi: mocks.midi }))
const context = {
	chainId: "lead",
	chain: {
		inputManager: { getAvailableFactories: mocks.inputs },
		outputManager: { getAvailableFactories: mocks.outputs },
		transformerManager: { activeTransformers: [] },
		appendTransformer: mocks.appendTransformer
	},
	manager: Object.assign(new EventTarget(), {
		devices: mocks.devices,
		deviceOptions: { clock: "test" },
		outputMixer: { context: "audio" },
		addDevice: mocks.addDevice,
		attachDevice: mocks.attachDevice
	})
} as any
vi.mock("audiobus/io/input-factory", () => ({ createInputById: mocks.input }))
vi.mock("audiobus/io/output-factory", () => ({ createOutputById: mocks.output }))
vi.mock("audiobus/instruments/instrument-factory-ui.ts", () => ({
	getAvailableInstrumentFactories: mocks.instruments,
	createInstrumentById: mocks.instrument
}))
vi.mock("audiobus/io/transformer-factory", async (importOriginal) => ({
	...(await importOriginal<typeof import("audiobus/io/transformer-factory")>()),
	TRANSFORMERS: ["Transposer", "Harmoniser"],
	tranformerFactory: (type: string) => ({ type })
}))

let view: { element: HTMLElement; destroy(): void }
let container: HTMLElement
const mount = (next: { element: HTMLElement; destroy(): void } | HTMLElement) => {
	view?.destroy()
	view =
		next instanceof HTMLElement
			? {
					element: next,
					destroy() {
						next.remove()
					}
				}
			: next
	container.append(view.element)
}
const tab = (label: string) =>
	[...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
		(button) => button.textContent === label
	)!
const panel = () => document.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!
const choose = async (label: string) => {
	await runUI(async () => {
		tab(label).click()
	})
}
const add = async (name: string) => {
	const button = [...panel().querySelectorAll("li > button")].find(
		(button) => button.textContent === name
	) as HTMLButtonElement
	await runUI(async () => {
		button.click()
	})
}
beforeEach(async () => {
	vi.clearAllMocks()
	mocks.devices.length = 0
	mocks.midi.inputs = []
	mocks.midi.outputs = [{ id: "output-fixture", name: "MIDI output" }]
	mocks.inputs.mockResolvedValue([
		{
			id: "keyboard",
			name: "Keyboard",
			description: "Computer keys",
			type: "controller",
			subtype: "keyboard"
		},
		{
			id: "gamepad",
			name: "Gamepad",
			description: "Controller",
			type: "controller",
			subtype: "gamepad"
		}
	])
	mocks.outputs.mockResolvedValue([
		{
			id: "webmidi",
			name: "MIDI output",
			description: "External device",
			type: "midi",
			subtype: "device"
		}
	])
	mocks.instruments.mockReset().mockReturnValue([
		{
			id: "piano",
			name: "Piano",
			description: "Acoustic instrument",
			type: "engine",
			subtype: "instrument",
			category: "sampling"
		}
	])
	mocks.input.mockResolvedValue({ name: "Created input" })
	mocks.output.mockResolvedValue({ name: "Created output" })
	mocks.instrument.mockResolvedValue({ name: "Created instrument" })
	container = document.createElement("div")
	document.body.appendChild(container)
	await runUI(async () => {
		mount(createChainSidebar(context))
	})
})
afterEach(async () => {
	await runUI(async () => view.destroy())
	document.body.replaceChildren()
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

const selectFilter = async (host: ParentNode, value: string) => {
	const select = host.querySelector("select")!
	await runUI(async () => {
		select.value = value
		select.dispatchEvent(new Event("change", { bubbles: true }))
	})
}

const outputCatalogue = () => {
	mocks.outputs.mockResolvedValue([
		{
			id: "butterchurn",
			name: "Butterchurn",
			description: "Reactive visuals",
			type: "visual",
			subtype: "visualiser"
		},
		{
			id: "supersonic",
			name: "Supersonic",
			description: "Synthesis engine",
			type: "engine",
			subtype: "instrument"
		}
	])
	mocks.instruments.mockReturnValue([
		{
			id: "piano",
			name: "Piano",
			description: "Sampled piano",
			type: "engine",
			subtype: "instrument",
			category: "sampling"
		},
		{
			id: "scsynth-instrument",
			name: "SuperCollider Synth",
			description: "A synth",
			type: "engine",
			subtype: "instrument",
			category: "supercollider"
		}
	])
}

it("groups output engines with instruments and combines type, subtype, category and text filters", async () => {
	outputCatalogue()
	await choose("Outputs")
	const host = panel()
	expect(
		[...host.querySelectorAll(".choice-group h6")].map((heading) => heading.textContent)
	).toEqual(["Engine / Instruments", "Visual / Visualisers"])
	expect(
		host.querySelector('[aria-label="Engine / Instruments"]')!.querySelectorAll("li")
	).toHaveLength(3)
	expect([...host.querySelectorAll("optgroup")].map((group) => group.label)).toEqual([
		"Types",
		"Subtypes",
		"Categories"
	])
	await selectFilter(host, "subtype:instrument")
	expect(host.querySelectorAll(".choice-group li")).toHaveLength(3)
	expect(host.textContent).not.toContain("Butterchurn")
	await selectFilter(host, "category:supercollider")
	expect(
		[...host.querySelectorAll(".choice-group button")].map((button) => button.textContent)
	).toEqual(["SuperCollider Synth", "Supersonic"])
	const search = host.querySelector("input")!
	await runUI(async () => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
			search,
			"supersonic"
		)
		search.dispatchEvent(new Event("input", { bubbles: true }))
	})
	expect(host.querySelectorAll(".choice-group li")).toHaveLength(1)
	await add("Supersonic")
	expect(mocks.output).toHaveBeenCalledWith("supersonic", expect.anything())
	await selectFilter(host, "type:visual")
	expect(host.querySelectorAll(".choice-group")).toHaveLength(0)
	expect(host.querySelector('[role="status"]')?.textContent).toContain("No outputs match")
})

it.each(["input", "output"] as const)(
	"uses the grouped picker and dropdown in the %s dialog",
	async (direction) => {
		outputCatalogue()
		const show = vi
			.spyOn(HTMLDialogElement.prototype, "showModal")
			.mockImplementation(function () {
				this.setAttribute("open", "")
			})
		const close = vi
			.spyOn(HTMLDialogElement.prototype, "close")
			.mockImplementation(function () {
				this.removeAttribute("open")
			})
		await runUI(async () => mount(createDeviceDialog(context, { direction, onClose: vi.fn() })))
		const dialog = document.querySelector("dialog")!
		expect(show).toHaveBeenCalledOnce()
		expect(dialog.getAttribute("aria-label")).toBe(
			`Add New ${direction === "input" ? "Input" : "Output"}`
		)
		await selectFilter(
			dialog,
			direction === "input" ? "subtype:keyboard" : "category:supercollider"
		)
		expect(dialog.querySelectorAll(".choice-group")).toHaveLength(1)
		const cards = dialog.querySelectorAll<HTMLButtonElement>(".device-choice-card")
		expect(cards).toHaveLength(direction === "input" ? 1 : 2)
		expect(cards[0].querySelector(".device-choice-detail")).not.toBeNull()
		expect(cards[0].querySelector(".item-classification")?.textContent).toContain(
			direction === "input" ? "Keyboard" : "Instruments"
		)
		await runUI(async () => cards[0].click())
		expect(direction === "input" ? mocks.input : mocks.instrument).toHaveBeenCalled()
		expect(close).toHaveBeenCalledOnce()
	}
)

it.each(["input", "output"] as const)(
	"lists connected MIDI %ss directly and creates the chosen device already routed and connected",
	async (direction) => {
		mocks.inputs.mockResolvedValue([
			{
				id: "webmidi",
				name: "WebMIDI Device",
				description: "Generic MIDI",
				type: "midi",
				subtype: "device"
			},
			{
				id: "digit-cmpsr",
				name: "DIGIT CMPSR",
				description: "Offline registry device",
				type: "midi",
				subtype: "device"
			}
		])
		mocks.midi.inputs = [{ id: "input-id", name: "MiniLab 3", manufacturer: "Arturia" }]
		mocks.midi.outputs = [{ id: "output-id", name: "reface CS", manufacturer: "Yamaha" }]
		const connect = vi.fn(async () => {})
		const created = { name: "Selected hardware", connect }
		const factory = direction === "input" ? mocks.input : mocks.output
		factory.mockResolvedValue(created)
		await runUI(async () => mount(createDeviceDialog(context, { direction, onClose: vi.fn() })))
		const dialog = document.querySelector("dialog")!
		const expectedName = direction === "input" ? "MiniLab 3" : "reface CS"
		const card = [...dialog.querySelectorAll<HTMLButtonElement>(".grid-item")].find(
			(button) => button.querySelector(".item-name")?.textContent === expectedName
		)!
		expect(card).toBeDefined()
		expect(card.textContent).toContain(direction === "input" ? "input-id" : "output-id")
		expect(card.querySelector<HTMLElement>(".item-icon")!.style.maskImage).toContain(
			direction === "input" ? "arturia-minilab-3/icon.svg" : "yamaha-reface-cs/icon.svg"
		)
		expect(dialog.textContent).not.toContain("WebMIDI Device")
		expect(dialog.textContent).not.toContain("Offline registry device")
		expect(dialog.querySelectorAll(".item-name").length).toBeGreaterThanOrEqual(2)
		await runUI(async () => card.click())
		expect(factory).toHaveBeenCalledWith(
			direction === "input" ? "arturia-minilab-3" : "webmidi",
			expect.objectContaining({
				selectedDevice: direction === "input" ? "input-id" : "output-id",
				devices: [direction === "input" ? "input-id" : "output-id"],
				...(direction === "input"
					? { listenToAllDevices: false, clock: "test" }
					: { sendToAllDevices: false, audioContext: "audio" })
			})
		)
		expect(connect).toHaveBeenCalledOnce()
		expect(mocks.addDevice).toHaveBeenCalledWith(expect.anything(), created, direction)
		expect(connect.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.addDevice.mock.invocationCallOrder[0]
		)
	}
)

it.each(["input", "output"] as const)(
	"updates MIDI %s choices on hot-plug and keeps All devices as an explicit choice",
	async (direction) => {
		const factoryInfo = {
			id: "webmidi",
			name: "WebMIDI Device",
			description: "MIDI",
			type: "midi",
			subtype: "device"
		}
		mocks.inputs.mockResolvedValue([factoryInfo])
		mocks.outputs.mockResolvedValue([factoryInfo])
		mocks.midi.inputs = []
		mocks.midi.outputs = []
		await runUI(async () => mount(createDeviceDialog(context, { direction, onClose: vi.fn() })))
		const dialog = document.querySelector("dialog")!
		expect(dialog.textContent).toContain(`No MIDI ${direction} devices connected.`)
		expect(
			[...dialog.querySelectorAll(".item-name")].some(
				(name) => name.textContent === "WebMIDI Device"
			)
		).toBe(false)
		await runUI(async () => {
			mocks.midi[direction === "input" ? "inputs" : "outputs"] = [
				{ id: "a", name: "Controller" },
				{ id: "b", name: "Controller" }
			]
			mocks.midi.dispatchEvent(new Event(EVENT_DEVICE_LIST_CHANGED))
		})
		const cards = [...dialog.querySelectorAll<HTMLButtonElement>(".grid-item")].filter(
			(button) => button.querySelector(".item-name")?.textContent === "Controller"
		)
		expect(cards).toHaveLength(2)
		expect(cards[0].textContent).toContain("MIDI ID: a")
		expect(cards[1].textContent).toContain("MIDI ID: b")
		const all = [...dialog.querySelectorAll<HTMLButtonElement>(".grid-item")].find(
			(button) => button.querySelector(".item-name")?.textContent === `All MIDI ${direction}s`
		)!
		await runUI(async () => all.click())
		expect(direction === "input" ? mocks.input : mocks.output).toHaveBeenCalledWith(
			"webmidi",
			expect.objectContaining({
				selectedDevice: "",
				devices: [],
				...(direction === "input"
					? { listenToAllDevices: true }
					: { sendToAllDevices: true })
			})
		)
		await runUI(async () => {
			mocks.midi[direction === "input" ? "inputs" : "outputs"] = []
			mocks.midi.dispatchEvent(new Event(EVENT_DEVICE_LIST_CHANGED))
		})
		expect(
			[...dialog.querySelectorAll(".item-name")].some(
				(name) => name.textContent === "Controller"
			)
		).toBe(false)
		// A successful selection closes and disposes the native picker. Reopening reads the latest ports.
		await runUI(async () => mount(createDeviceDialog(context, { direction, onClose: vi.fn() })))
		expect(document.querySelector("dialog")!.textContent).toContain(
			`No MIDI ${direction} devices connected.`
		)
	}
)

it("cleans up a MIDI device disconnected during creation and keeps the dialog available for another choice", async () => {
	const destroy = vi.fn(async () => {})
	mocks.output.mockResolvedValue({
		name: "MIDI output",
		destroy,
		connect: vi.fn(async () => {
			mocks.midi.outputs = []
			mocks.midi.dispatchEvent(new Event(EVENT_DEVICE_LIST_CHANGED))
		})
	})
	await runUI(async () =>
		mount(createDeviceDialog(context, { direction: "output", onClose: vi.fn() }))
	)
	const dialog = document.querySelector("dialog")!
	const card = [...dialog.querySelectorAll<HTMLButtonElement>(".grid-item")].find(
		(button) => button.querySelector(".item-name")?.textContent === "MIDI output"
	)!
	await runUI(async () => card.click())
	expect(dialog.querySelector('[role="alert"]')!.textContent).toContain(
		"disconnected while being added"
	)
	expect(mocks.addDevice).not.toHaveBeenCalled()
	expect(destroy).toHaveBeenCalledOnce()
	expect(dialog.open).toBe(true)
})

it("filters transformer groups in both the sidebar and dialog", async () => {
	await choose("Transformers")
	await selectFilter(panel(), "subtype:harmony")
	expect(panel().querySelectorAll(".choice-group")).toHaveLength(1)
	expect(panel().querySelector(".choice-group button")?.textContent).toBe("Harmoniser")
	await runUI(async () => mount(createTransformerPicker(context, { dialog: true })))
	await selectFilter(document, "subtype:pitch")
	expect(document.querySelectorAll(".choice-group")).toHaveLength(1)
	const button = document.querySelector<HTMLButtonElement>(".grid-item")!
	expect(button.textContent).toBe("Transposer")
	await runUI(async () => button.click())
	expect(mocks.appendTransformer).toHaveBeenCalledWith({ type: "Transposer" })
})

it("applies the same classification filter to shared devices and excludes devices already in the chain", async () => {
	mocks.devices.push(
		{
			id: "synth",
			direction: "output",
			chains: new Set(),
			device: defineDevice(
				{ name: "Shared synth", description: "Synth" },
				{ factory: "output", type: "supersonic" }
			)
		},
		{
			id: "visual",
			direction: "output",
			chains: new Set(),
			device: defineDevice(
				{ name: "Shared visual", description: "Visual" },
				{ factory: "output", type: "butterchurn" }
			)
		},
		{
			id: "attached",
			direction: "output",
			chains: new Set(["lead"]),
			device: defineDevice(
				{ name: "Attached synth", description: "Synth" },
				{ factory: "output", type: "supersonic" }
			)
		}
	)
	await runUI(async () =>
		mount(
			createSharedDevices(context, {
				direction: "output",
				selection: "category:supercollider"
			})
		)
	)
	const buttons = document.querySelectorAll<HTMLButtonElement>(".shared-device-selector button")
	expect(buttons).toHaveLength(1)
	expect(buttons[0].textContent).toBe("Shared synth")
	await runUI(async () => buttons[0].click())
	expect(mocks.attachDevice).toHaveBeenCalledWith("lead", "synth")
})

it("switches panels with keyboard navigation and returns focus when closed", async () => {
	await choose("Inputs")
	await runUI(async () => {
		tab("Inputs").dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
		)
	})
	expect(tab("Transformers").getAttribute("aria-selected")).toBe("true")
	expect(document.activeElement).toBe(tab("Transformers"))
	expect(panel().getAttribute("aria-labelledby")).toBe(tab("Transformers").id)
	await runUI(async () => {
		panel().querySelector<HTMLButtonElement>('[aria-label="Close sidebar"]')!.click()
	})
	expect(document.querySelector('[role="tabpanel"]:not([hidden])')).toBeNull()
	expect(document.activeElement).toBe(tab("Transformers"))
})

it("filters inputs and adds a device to the current chain using its device options", async () => {
	await choose("Inputs")
	const search = panel().querySelector("input")!
	await runUI(async () => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
			search,
			"computer"
		)
		search.dispatchEvent(new Event("input", { bubbles: true }))
	})
	expect(panel().querySelectorAll("li > button")).toHaveLength(1)
	await add("Keyboard")
	expect(mocks.input).toHaveBeenCalledWith("keyboard", { clock: "test" })
	expect(mocks.addDevice).toHaveBeenCalledWith(
		expect.anything(),
		{ name: "Created input" },
		"input"
	)
})

it("adds transformers, outputs and instruments through their respective factories", async () => {
	await choose("Transformers")
	await add("Harmoniser")
	expect(mocks.appendTransformer).toHaveBeenCalledWith({ type: "Harmoniser" })
	await choose("Outputs")
	await add("MIDI output")
	expect(mocks.output).toHaveBeenCalledWith(
		"webmidi",
		expect.objectContaining({
			mixer: { context: "audio" },
			audioContext: "audio",
			selectedDevice: "output-fixture",
			sendToAllDevices: false
		})
	)
	await add("Piano")
	expect(mocks.instrument).toHaveBeenCalledWith(
		"audio",
		"piano",
		expect.objectContaining({ mixer: { context: "audio" } })
	)
	expect(mocks.addDevice).toHaveBeenLastCalledWith(
		expect.anything(),
		{ name: "Created instrument" },
		"output"
	)
})

it("keeps outputs usable when the instrument catalog fails", async () => {
	mocks.instruments.mockImplementation(() => {
		throw new Error("Instrument catalog unavailable")
	})
	await choose("Outputs")
	expect(panel().querySelector('[role="alert"]')?.textContent).toBe(
		"Instruments could not be loaded."
	)
	expect(panel().textContent).not.toContain("No outputs available")
	await add("MIDI output")
	expect(mocks.output).toHaveBeenCalledWith("webmidi", expect.anything())
})

it("keeps instruments usable when the output catalog fails", async () => {
	mocks.outputs.mockRejectedValueOnce(new TypeError("error loading dynamically imported module"))
	await choose("Outputs")
	expect(panel().querySelector('[role="alert"]')?.textContent).toBe(
		"Outputs could not be loaded."
	)
	await add("Piano")
	expect(mocks.instrument).toHaveBeenCalledWith("audio", "piano", expect.anything())
})

it("reports catalog failures without claiming no outputs are available", async () => {
	mocks.outputs.mockRejectedValueOnce(new Error("Output catalog unavailable"))
	mocks.instruments.mockImplementation(() => {
		throw new Error("Instrument catalog unavailable")
	})
	await choose("Outputs")
	expect(panel().querySelector('[role="alert"]')?.textContent).toBe(
		"Outputs could not be loaded. Instruments could not be loaded."
	)
	expect(panel().textContent).not.toContain("No outputs available")
})

it("shows an icon for every sidebar choice, including instruments", async () => {
	for (const name of ["Inputs", "Transformers", "Outputs"]) {
		await choose(name)
		const buttons = panel().querySelectorAll("li > button")
		expect(buttons.length).toBeGreaterThan(0)
		for (const button of buttons) {
			const icon = button.querySelector<HTMLElement>(".element-icon")!
			expect(icon).not.toBeNull()
			expect(icon.style.maskImage).toMatch(/url\(.+\/icons\/.+\.svg/)
			expect(icon.getAttribute("aria-hidden")).toBe("true")
		}
	}
})

it("shows the same transformer icons in the selection overlay and sidebar", async () => {
	await choose("Transformers")
	const sources = [...panel().querySelectorAll<HTMLElement>("li > button .element-icon")].map(
		(icon) => icon.style.maskImage
	)
	await runUI(async () => {
		mount(createTransformerPicker(context, { dialog: true }))
	})
	expect(
		[...document.querySelectorAll<HTMLElement>(".grid-item .element-icon")].map(
			(icon) => icon.style.maskImage
		)
	).toEqual(sources)
})

it("disposes a device that finishes loading after its picker is closed", async () => {
	let finish!: (device: any) => void
	mocks.input.mockReturnValue(
		new Promise((resolve) => {
			finish = resolve
		})
	)
	await choose("Inputs")
	await add("Keyboard")
	view.destroy()
	const destroy = vi.fn()
	await runUI(async () => {
		finish({ name: "Late input", destroy })
	})
	expect(destroy).toHaveBeenCalledOnce()
	expect(mocks.addDevice).not.toHaveBeenCalled()
})