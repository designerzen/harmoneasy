// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { runUI } from "./native-ui"
import {
	completePresets,
	presetContext,
	presetSetup,
	ACTIVITY_PRESETS
} from "../source/components/graph/preset-catalogue"
import startPage from "../index.html?raw"
import { DEFAULT_PRESET_LIBRARY } from "../../../packages/audiobus/io/transformer-presets"
import { parsePresetLibrary } from "../../../packages/audiobus/io/preset-library"
import { DRUM_GENRES } from "../../../packages/audiobus/io/outputs/drum-accompaniment-settings"
import { DRUM_GROOVES } from "../../../packages/audiobus/timing/drum-patterns"
import {
	createContextSetup,
	createEmptySetup,
	createStartContexts,
	START_CONTEXTS,
	START_SUGGESTIONS
} from "../source/services/start-contexts"

const views: ReturnType<typeof createStartContexts>[] = []
const mountStartContexts: typeof createStartContexts = (...args) => {
	const view = createStartContexts(...args)
	views.push(view)
	return view
}
beforeEach(() => {
	const storage = new Map<string, string>()
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value)
	})
})
afterEach(() => {
	views.splice(0).forEach((view) => view.destroy())
	document.body.replaceChildren()
	vi.unstubAllGlobals()
})

it("shares every activity and factory preset with the browser, including older saved libraries", () => {
	const presets = completePresets([])
	expect(presets).toHaveLength(DEFAULT_PRESET_LIBRARY.presets.length + START_CONTEXTS.length)
	for (const context of START_CONTEXTS) {
		const preset = presets.find((item) => item.id === `activity:${context.id}`)!
		expect(preset.description).toBe(context.description)
		expect(preset.useCase).toBe(context.next)
		expect(presetSetup(preset)).toEqual(createContextSetup(context))
	}
	expect(
		ACTIVITY_PRESETS.find((item) => item.id === "activity:drum-and-bass")!.useCase
	).toContain("170 BPM")
})

it("uses the same preset browser on the splash and retains the selected sound setup", async () => {
	document.body.innerHTML = startPage.match(/<dialog id="start-dialog"[\s\S]*?<\/dialog>/)![0]
	const root = document.querySelector<HTMLElement>("#start-dialog")!
	let picker: ReturnType<typeof createStartContexts>
	const onStart = vi.fn()
	await runUI(async () => {
		picker = mountStartContexts(root, onStart)
	})
	const browser = root.querySelector<HTMLElement>(".preset-browser-inline")!
	expect(browser).toBeTruthy()
	expect(document.querySelector("dialog.preset-browser")).toBeNull()
	expect(root.querySelector(".preset-browse")).toBeNull()
	const card = [...browser.querySelectorAll<HTMLButtonElement>("nav button")].find((button) =>
		button.textContent?.includes("Write drum and bass")
	)!
	await runUI(async () => {
		card.click()
	})
	expect(browser.querySelector(".preset-preview")!.textContent).toContain("170 BPM")
	expect(browser.querySelector(".preset-preview")!.textContent).toContain(
		"Moog + Drum Accompaniment"
	)
	expect(browser.querySelector<HTMLButtonElement>(".preset-apply-button")!.disabled).toBe(false)
	await runUI(async () => {
		browser.querySelector<HTMLButtonElement>(".preset-apply-button")!.click()
	})
	expect(picker!.getSetup()?.id).toBe("drum-and-bass")
	expect(onStart).toHaveBeenCalledExactlyOnceWith(picker!.getSetup())
	expect(root.querySelector(".start-preset-actions")).toBeNull()
})

it("covers the percussion genres with valid grooves and connected sound outputs", () => {
	const covered = new Set<string>()
	for (const context of START_CONTEXTS.filter(
		(context) => context.category === "Genres" && context.id !== "ambient"
	)) {
		const setup = createContextSetup(context)
		const drums = setup.devices.find(
			(device) => device.definition.type === "drum-accompaniment"
		)!
		expect(drums, context.name).toBeDefined()
		const { genre, groove } = drums.definition.options!
		expect(
			DRUM_GENRES[genre as keyof typeof DRUM_GENRES].grooves as readonly string[]
		).toContain(groove)
		expect(DRUM_GROOVES[groove]).toBeDefined()
		expect(setup.chains[0].outputs).toContain(drums.id)
		if (genre !== "percussion") {
			expect(
				setup.devices.some((device) => device.id === "synth" && device.id !== drums.id)
			).toBe(true)
		}
		covered.add(genre)
	}
	expect([...covered].sort()).toEqual(
		Object.keys(DRUM_GENRES)
			.filter((genre) => genre !== "transitions")
			.sort()
	)
})

it("starts saved setups directly and disables the primary action while starting", async () => {
	const setup = createContextSetup(
		START_CONTEXTS.find((context) => context.id === "drum-and-bass")!
	)
	localStorage.setItem(
		"harmoneasy.preset-library.v1",
		JSON.stringify({ ...DEFAULT_PRESET_LIBRARY, setups: [setup] })
	)
	document.body.innerHTML = startPage.match(/<dialog id="start-dialog"[\s\S]*?<\/dialog>/)![0]
	const dialog = document.querySelector<HTMLElement>("#start-dialog")!
	let finish!: () => void
	const onStart = vi.fn(
		() =>
			new Promise<void>((resolve) => {
				finish = resolve
			})
	)
	await runUI(async () => {
		mountStartContexts(dialog, onStart)
	})
	const saved = [
		...dialog.querySelectorAll<HTMLButtonElement>("nav section:last-child button")
	].find((button) => button.textContent === setup.name)!
	await runUI(async () => {
		saved.click()
	})
	const start = dialog.querySelector<HTMLButtonElement>(".preset-apply-button")!
	await runUI(async () => {
		start.click()
	})
	expect(onStart).toHaveBeenCalledExactlyOnceWith(setup)
	expect(start.disabled).toBe(true)
	expect(start.textContent).toBe("Starting…")
	await runUI(async () => {
		start.click()
	})
	expect(onStart).toHaveBeenCalledOnce()
	await runUI(async () => {
		finish()
	})
})

it("keeps all genres available with an older library and combines type, genre and search filters", async () => {
	localStorage.setItem(
		"harmoneasy.preset-library.v1",
		JSON.stringify({ ...DEFAULT_PRESET_LIBRARY, presets: [] })
	)
	document.body.innerHTML = startPage.match(/<dialog id="start-dialog"[\s\S]*?<\/dialog>/)![0]
	const dialog = document.querySelector<HTMLElement>("#start-dialog")!
	await runUI(async () => {
		mountStartContexts(dialog)
	})
	const [type, genre] = [...dialog.querySelectorAll<HTMLSelectElement>(".preset-filter select")]
	const change = async (select: HTMLSelectElement, value: string) =>
		runUI(async () => {
			select.value = value
			select.dispatchEvent(new Event("change", { bubbles: true }))
		})
	const names = () =>
		[...dialog.querySelectorAll<HTMLButtonElement>("nav button")].map(
			(button) => button.querySelector("span")!.firstChild!.textContent
		)
	expect(names()).toHaveLength(completePresets([]).length)
	await change(type, "Genres")
	for (const context of START_CONTEXTS.filter((context) => context.category === "Genres")) {
		expect([...genre.options].some((option) => option.value === context.id)).toBe(true)
		await change(genre, context.id)
		expect(names()).toEqual(
			completePresets([])
				.filter((preset) => presetContext(preset)?.id === context.id)
				.map((preset) => preset.name)
		)
		expect(names().length).toBeGreaterThan(0)
	}
	await change(genre, "drum-and-bass")
	const search = dialog.querySelector<HTMLInputElement>(".preset-search input")!
	await runUI(async () => {
		search.value = "170"
		search.dispatchEvent(new Event("input", { bubbles: true }))
	})
	expect(names()).toEqual(["Write drum and bass"])
	await change(type, "Accessibility")
	expect(dialog.querySelector(".preset-no-results")).toBeTruthy()
	await change(type, "")
	await change(genre, "")
	await runUI(async () => {
		search.value = ""
		search.dispatchEvent(new Event("input", { bubbles: true }))
	})
	expect(names()).toHaveLength(completePresets([]).length)
})

it("starts each genre with its sound output and independent settings", () => {
	for (const [id, type] of [
		["acid-house", "tb303"],
		["techno", "moog"],
		["dub", "webclap:com.plinken.organ"],
		["disco", "webclap:com.plinken.piano"]
	]) {
		const setup = createContextSetup(START_CONTEXTS.find((context) => context.id === id)!)
		expect(setup.devices.find((device) => device.id === "synth")!.definition).toEqual({
			factory: "output",
			type
		})
		expect(setup.chains[0].outputs).toContain("synth")
		const drums = setup.devices.find(
			(device) => device.definition.type === "drum-accompaniment"
		)!
		expect(drums.definition).toEqual({
			factory: "output",
			type: "drum-accompaniment",
			options:
				id === "dub"
					? { genre: "reggae", groove: "reggae" }
					: { genre: "electronic", groove: "disco" }
		})
		expect(setup.chains[0].outputs).toContain(drums.id)
	}
	const ambient = START_CONTEXTS.find((context) => context.id === "ambient")!
	const pad = createContextSetup(ambient).devices.find(
		(device) => device.id === "synth"
	)!.definition
	expect(pad.factory).toBe("polyphonic")
	expect(
		createContextSetup(ambient).devices.some(
			(device) => device.definition.type === "drum-accompaniment"
		)
	).toBe(false)
	expect(pad.options).toMatchObject({
		shape: "triangle",
		attack: 0.8,
		release: 3,
		filterCutOff: 1200
	})
	pad.options!.release = 0
	expect(
		createContextSetup(ambient).devices.find((device) => device.id === "synth")!.definition
			.options!.release
	).toBe(3)
	expect(createEmptySetup().devices.find((device) => device.id === "synth")!.definition).toEqual({
		factory: "polyphonic"
	})
})

it("shows the browser immediately with one primary start action and secondary session actions", async () => {
	document.body.innerHTML = startPage.match(/<dialog id="start-dialog"[\s\S]*?<\/dialog>/)![0]
	const dialog = document.querySelector<HTMLDialogElement>("#start-dialog")!
	await runUI(async () => {
		mountStartContexts(dialog)
	})
	expect(dialog.querySelector("#start-contexts")).toBeNull()
	expect(dialog.querySelector(".preset-browse")).toBeNull()
	expect(dialog.querySelector(".start-preset-actions")).toBeNull()
	expect(dialog.querySelectorAll(".preset-apply-button")).toHaveLength(1)
	expect(dialog.querySelector(".preset-apply-button")!.textContent).toBe("Start Preset")
	expect(dialog.textContent).not.toContain("Choose this preset, then")
	expect(dialog.querySelector(".preset-search input")).toBeTruthy()
	expect(dialog.querySelectorAll(".preset-filter select")).toHaveLength(2)
	const empty = dialog.querySelector<HTMLButtonElement>(".btn-start-empty")!
	const session = dialog.querySelector<HTMLButtonElement>(".btn-continue-session")!
	expect(empty.textContent?.trim()).toBe("Start Empty")
	expect(empty.value).toBe("empty")
	expect(session.textContent?.trim()).toBe("Continue Session")
	expect(session.value).toBe("session")
	expect(empty.form?.id).toBe("start-form")
	expect(session.form).toBe(empty.form)
	expect(dialog.querySelector("form form")).toBeNull()
	expect(createEmptySetup().chains[0].steps).toEqual([])
})

it("provides restorable contexts with valid routing and independent transformer settings", () => {
	expect(START_CONTEXTS.length).toBeGreaterThanOrEqual(40)
	expect(new Set(START_CONTEXTS.map((context) => context.id)).size).toBe(START_CONTEXTS.length)
	for (const context of START_CONTEXTS) {
		const setup = createContextSetup(context)
		expect(() =>
			parsePresetLibrary(JSON.stringify({ ...DEFAULT_PRESET_LIBRARY, setups: [setup] }))
		).not.toThrow()
		expect(setup.chains[0].inputs).toEqual(["computer-keyboard", "keyboard"])
		expect(setup.chains[0].outputs).toContain("synth")
	}
	const live = START_CONTEXTS.find((context) => context.id === "live")!
	const first = createContextSetup(live)
	first.chains[0].steps[0].config.root = 9
	expect(createContextSetup(live).chains[0].steps[0].config.root).toBe(0)
	expect(
		createContextSetup(START_CONTEXTS.find((context) => context.id === "convert")!).chains[0]
			.steps
	).toEqual([])
})

it("keeps every goal suggestion mapped to available activity presets", () => {
	for (const suggestion of START_SUGGESTIONS) {
		expect(
			suggestion.contexts.every((id) =>
				ACTIVITY_PRESETS.some((preset) => preset.id === `activity:${id}`)
			)
		).toBe(true)
	}
})

it("searches the shared browser by activity descriptions and next actions", async () => {
	document.body.innerHTML = startPage.match(/<dialog id="start-dialog"[\s\S]*?<\/dialog>/)![0]
	const root = document.querySelector<HTMLElement>("#start-dialog")!
	let picker: ReturnType<typeof createStartContexts>
	await runUI(async () => {
		picker = mountStartContexts(root)
	})
	expect(picker!.getSetup()).toBeUndefined()
	const search = document.querySelector<HTMLInputElement>(".preset-search input")!
	await runUI(async () => {
		search.value = "classroom"
		search.dispatchEvent(new Event("input", { bubbles: true }))
	})
	const cards = [...document.querySelectorAll<HTMLButtonElement>(".preset-browser nav button")]
	expect(cards.length).toBeGreaterThan(0)
	expect(cards.every((card) => card.textContent!.toLowerCase().includes("classroom"))).toBe(true)
	const classroom = cards.find((card) => card.textContent!.includes("Synchronise a classroom"))!
	await runUI(async () => {
		classroom.click()
	})
	expect(document.querySelector(".preset-preview")!.textContent).toContain("use Sync")
	await runUI(async () => {
		document.querySelector<HTMLButtonElement>(".preset-apply-button")!.click()
	})
	expect(picker!.getSetup()?.id).toBe("classroom")
})

it("starts factory genre presets with the same sound outputs as their activity presets", () => {
	for (const preset of DEFAULT_PRESET_LIBRARY.presets.filter(
		(item) => item.category === "Genres"
	)) {
		const context = START_CONTEXTS.find(
			(item) => item.category === "Genres" && item.presets.includes(preset.id)
		)!
		expect(context, preset.name).toBeDefined()
		const setup = presetSetup(preset)
		const expected = createContextSetup(context)
		expect(setup.devices).toEqual(expected.devices)
		expect(setup.chains[0].outputs).toEqual(expected.chains[0].outputs)
		expect(setup.chains[0].steps).toEqual(preset.steps)
		expect(setup.chains[0].options.name).toBe(preset.name)
	}
})

it("keeps accessibility presets focused and free of instrument outputs", () => {
	const presets = completePresets([]).filter((preset) => preset.category === "Accessibility")
	expect(presets.map((preset) => preset.name)).toEqual([
		"Describe and read out",
		"Show notation",
		"Vibrate on notes",
		"Describe chords in text",
		"See and feel notes"
	])
	for (const preset of presets) {
		const setup = presetSetup(preset)
		const outputs = setup.devices.filter(
			(device) => device.direction === "output" && device.definition.factory !== "external"
		)
		expect(outputs.length).toBeGreaterThan(0)
		expect(outputs.length).toBeLessThanOrEqual(2)
		expect(outputs.every((device) => device.definition.factory === "output")).toBe(true)
		expect(
			outputs.some((device) =>
				["polyphonic", "instrument"].includes(device.definition.factory)
			)
		).toBe(false)
		expect(setup.chains[0].outputs).toEqual([...outputs.map((device) => device.id), "ui"])
	}
	expect(
		presetSetup(presets[0])
			.devices.filter((device) => device.direction === "output")
			.map((device) => device.definition.type)
	).toEqual(["describe", "speech-synthesis", "ui"])
})