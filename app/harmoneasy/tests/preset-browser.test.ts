// @vitest-environment happy-dom
import { runUI } from "./native-ui"
import { afterEach, expect, it, vi } from "vitest"
import { createPresetBrowser } from "../source/components/graph/PresetBrowser"
import {
	createChainPresetPicker,
	updateChainPresetOptions
} from "../source/components/graph/chain-preset-picker"
import { createIOChainManagerUI } from "../source/components/graph/IOChainManagerUI"
import type IOChainManager from "audiobus/io/IO-chain-manager"
import { DEFAULT_PRESET_LIBRARY } from "../../../packages/audiobus/io/transformer-presets"
import { completePresets, ACTIVITY_PRESETS } from "../source/components/graph/preset-catalogue"
import { writeLibrary } from "../source/components/graph/saved-presets"

let root: { element: HTMLElement; destroy(): void }
let host: HTMLElement
afterEach(() => {
	root?.destroy()
	document.body.replaceChildren()
	vi.unstubAllGlobals()
})

it("lets users inspect grouped presets before applying and keeps saved presets available", () => {
	const storage = new Map<string, string>()
	vi.stubGlobal("localStorage", {
		getItem: (key) => storage.get(key) ?? null,
		setItem: (key, value) => storage.set(key, value)
	})
	host = document.createElement("div")
	document.body.append(host)
	const onApply = vi.fn()
	const saved = {
		id: "mine",
		name: "My lead",
		category: "Saved presets",
		description: "A lead",
		useCase: "Play a lead",
		steps: []
	}
	writeLibrary({
		...structuredClone(DEFAULT_PRESET_LIBRARY),
		presets: [...DEFAULT_PRESET_LIBRARY.presets, saved]
	})
	root = createPresetBrowser({ onApply })
	host.append(root.element)
	const dialog = document.querySelector("dialog")!
	dialog.showModal = vi.fn(() => dialog.setAttribute("open", ""))
	dialog.close = vi.fn(() => dialog.removeAttribute("open"))
	const click = (label: string) =>
		runUI(() => {
			const button = [...document.querySelectorAll("button")].find(
				(item) =>
					item.textContent === label ||
					item.querySelector("span")?.firstChild?.textContent === label
			)!
			expect(button).toBeTruthy()
			button.click()
		})
	click("Apply a preset…")
	expect(dialog.hasAttribute("open")).toBe(true)
	expect(document.querySelectorAll("nav section")).toHaveLength(
		new Set(
			completePresets([...DEFAULT_PRESET_LIBRARY.presets, saved]).map((item) => item.category)
		).size
	)
	click("Triplet Cascade")
	expect(onApply).not.toHaveBeenCalled()
	expect(document.querySelector(".preset-details")?.textContent).toContain("Why use it")
	expect(document.querySelector(".preset-details")?.textContent).toContain("triplet spacing")
	click("Apply Triplet Cascade")
	expect(onApply.mock.calls[0][0].name).toBe("Triplet Cascade")
	expect(dialog.hasAttribute("open")).toBe(false)
	click("Apply a preset…")
	click("My lead")
	click("Apply My lead")
	expect(onApply).toHaveBeenLastCalledWith(saved)
})

it("uses the same sections for new-chain options", () => {
	const picker = createChainPresetPicker("test-picker")
	updateChainPresetOptions(picker, DEFAULT_PRESET_LIBRARY.presets)
	expect(picker.querySelectorAll("optgroup")).toHaveLength(6)
	expect(picker.querySelectorAll("option")).toHaveLength(
		DEFAULT_PRESET_LIBRARY.presets.length + 1
	)
	const preset = DEFAULT_PRESET_LIBRARY.presets[0]
	picker.value = preset.id
	updateChainPresetOptions(picker, DEFAULT_PRESET_LIBRARY.presets)
	expect(picker.value).toBe(preset.id)
	updateChainPresetOptions(picker, [])
	expect(picker.value).toBe("")
	expect(picker.querySelectorAll("button > selectedcontent")).toHaveLength(1)
})

it("illustrates every preset, filters by intent and keeps Apply outside the scrolling content", () => {
	vi.stubGlobal("localStorage", { getItem: () => null })
	host = document.createElement("div")
	document.body.append(host)
	const onApply = vi.fn()
	root = createPresetBrowser({ onApply })
	host.append(root.element)
	expect(document.querySelectorAll("nav button svg")).toHaveLength(
		DEFAULT_PRESET_LIBRARY.presets.length + ACTIVITY_PRESETS.length
	)
	const icons = [...document.querySelectorAll("nav .preset-artwork-icon")]
	expect(icons).toHaveLength(DEFAULT_PRESET_LIBRARY.presets.length + ACTIVITY_PRESETS.length)
	expect(icons.every((icon) => icon.getAttribute("href")?.includes("/icons/"))).toBe(true)
	const scores = [...document.querySelectorAll("nav svg")].map((svg) =>
		[...svg.querySelectorAll("rect:not(:first-child)")]
			.map(
				(rect) =>
					`${rect.getAttribute("x")}:${rect.getAttribute("y")}:${rect.getAttribute("fill")}`
			)
			.join("|")
	)
	expect(new Set(scores).size).toBeGreaterThanOrEqual(DEFAULT_PRESET_LIBRARY.presets.length)
	const scroll = document.querySelector(".preset-browser-scroll")!
	const apply = document.querySelector<HTMLButtonElement>(".preset-apply-button")!
	expect(scroll.contains(apply)).toBe(false)
	expect(document.querySelector<HTMLDetailsElement>(".preset-library-tools")!.open).toBe(false)
	const search = document.querySelector<HTMLInputElement>(".preset-search input")!
	runUI(() => {
		search.value = "triplet"
		search.dispatchEvent(new Event("input", { bubbles: true }))
	})
	expect(document.querySelectorAll("nav button").length).toBeGreaterThan(0)
	runUI(() =>
		[...document.querySelectorAll<HTMLButtonElement>("nav button")]
			.find(
				(button) =>
					button.querySelector("span")?.firstChild?.textContent === "Triplet Cascade"
			)!
			.click()
	)
	expect(
		document.querySelector('.preset-preview svg[role="img"]')?.getAttribute("aria-label")
	).toContain("Triplet Cascade")
	expect(apply.textContent).toBe("Apply Triplet Cascade")
	expect(onApply).not.toHaveBeenCalled()
	runUI(() => {
		search.value = "no such sound"
		search.dispatchEvent(new Event("input", { bubbles: true }))
	})
	expect(document.querySelector(".preset-no-results")?.textContent).toContain(
		"No matching presets"
	)
	expect(apply.textContent).toBe("Apply Triplet Cascade")
})

it("describes every new-chain option before selection and adds only when confirmed", async () => {
	vi.stubGlobal("localStorage", { getItem: () => null })
	host = document.createElement("div")
	document.body.append(host)
	const chain = {
		options: {},
		isActive: true,
		clearNoteCommands: vi.fn(),
		importConfiguration: vi.fn(),
		setGraphOptions: vi.fn(),
		setName: vi.fn()
	}
	const manager = {
		createDefaultChain: vi.fn().mockResolvedValue("new-chain"),
		getChain: vi.fn(() => chain),
		setActiveChain: vi.fn()
	}
	root = createIOChainManagerUI(manager as unknown as IOChainManager)
	host.append(root.element)
	const dialog = document.querySelector("dialog")!
	dialog.showModal = vi.fn(() => dialog.setAttribute("open", ""))
	dialog.close = vi.fn(() => dialog.removeAttribute("open"))
	expect(host.querySelector("select")).toBeNull()
	expect(dialog.querySelectorAll(".preset-filter select")).toHaveLength(2)
	runUI(() => document.querySelector<HTMLButtonElement>(".preset-browse")!.click())
	expect(dialog.hasAttribute("open")).toBe(true)
	expect(document.querySelectorAll("nav button")).toHaveLength(
		DEFAULT_PRESET_LIBRARY.presets.length + ACTIVITY_PRESETS.length
	)
	const preset = DEFAULT_PRESET_LIBRARY.presets.find((item) => item.name === "Ratchet Fill")!
	runUI(() =>
		[...document.querySelectorAll<HTMLButtonElement>("nav button")]
			.find(
				(button) => button.querySelector("span")?.firstChild?.textContent === preset.name
			)!
			.click()
	)
	expect(document.querySelector(".preset-details")?.textContent).toContain(preset.description)
	expect(manager.createDefaultChain).not.toHaveBeenCalled()
	await runUI(async () =>
		document.querySelector<HTMLButtonElement>(".preset-apply-button")!.click()
	)
	expect(dialog.hasAttribute("open")).toBe(false)
	expect(manager.createDefaultChain).toHaveBeenCalledOnce()
	expect(chain.setName).toHaveBeenCalledWith(preset.name)
	expect(manager.setActiveChain).toHaveBeenCalledWith("new-chain")
})

it("persists new presets and deletions, supports undo, and downloads the selected preset", () => {
	const storage = new Map<string, string>()
	vi.stubGlobal("localStorage", {
		getItem: (key) => storage.get(key) ?? null,
		setItem: (key, value) => storage.set(key, value)
	})
	host = document.createElement("div")
	document.body.append(host)
	writeLibrary({ ...structuredClone(DEFAULT_PRESET_LIBRARY), presets: [] })
	root = createPresetBrowser({ onApply: vi.fn() })
	host.append(root.element)
	const click = (label: string) =>
		runUI(() => {
			const button = [...document.querySelectorAll("button")].find(
				(item) =>
					item.textContent === label ||
					item.querySelector("span")?.firstChild?.textContent === label
			)!
			expect(button).toBeTruthy()
			button.click()
		})
	click("New preset")
	runUI(() => document.querySelector<HTMLFormElement>(".preset-editor")!.requestSubmit())
	expect(document.querySelector(".preset-details h3")?.textContent).toBe("New preset")
	expect(document.querySelector("nav")?.textContent).toContain("My presets")
	click("Delete preset")
	expect(document.querySelector(".preset-details h3")?.textContent).not.toBe("New preset")
	click("Undo delete")
	runUI(() =>
		[...document.querySelectorAll<HTMLButtonElement>("nav button")]
			.find(
				(button) => button.querySelector("span")?.firstChild?.textContent === "New preset"
			)!
			.click()
	)
	expect(document.querySelector(".preset-details h3")?.textContent).toBe("New preset")
	const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test")
	const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
	click("Save selected to file")
	expect(createObjectURL).toHaveBeenCalledOnce()
	expect(anchorClick).toHaveBeenCalledOnce()
	createObjectURL.mockRestore()
	anchorClick.mockRestore()
})

it.each([
	["Write drum and bass", "moog", "breaks", "amen"],
	["Write techno", "moog", "electronic", "disco"],
	["Techno Pulse", "moog", "electronic", "disco"],
	["Acid House", "tb303", "electronic", "disco"],
	["Dub Stabs", "webclap:com.plinken.organ", "reggae", "reggae"],
	["Disco Keys", "webclap:com.plinken.piano", "electronic", "disco"]
])("creates %s with the intended instrument and drums", async (name, instrument, genre, groove) => {
	vi.stubGlobal("localStorage", { getItem: () => null })
	host = document.createElement("div")
	document.body.append(host)
	const chain = {
		options: {},
		isActive: true,
		clearNoteCommands: vi.fn(),
		importConfiguration: vi.fn(),
		setGraphOptions: vi.fn(),
		setName: vi.fn()
	}
	const manager = {
		createChainWithSounds: vi.fn().mockResolvedValue("activity-chain"),
		createDefaultChain: vi.fn(),
		getChain: vi.fn(() => chain),
		setActiveChain: vi.fn()
	}
	root = createIOChainManagerUI(manager as unknown as IOChainManager)
	host.append(root.element)
	runUI(() =>
		[...document.querySelectorAll<HTMLButtonElement>("nav button")]
			.find((button) => button.querySelector("span")?.firstChild?.textContent === name)!
			.click()
	)
	await runUI(async () =>
		document.querySelector<HTMLButtonElement>(".preset-apply-button")!.click()
	)
	expect(manager.createChainWithSounds).toHaveBeenCalledWith([
		{ factory: "output", type: instrument },
		{
			factory: "output",
			type: "drum-accompaniment",
			options: expect.objectContaining({ genre, groove })
		}
	])
	expect(manager.createDefaultChain).not.toHaveBeenCalled()
	expect(chain.setName).toHaveBeenCalledWith(name)
	expect(manager.setActiveChain).toHaveBeenCalledWith("activity-chain")
})