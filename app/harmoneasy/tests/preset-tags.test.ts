// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import { presetTags } from "../source/components/graph/preset-tags"
import { completePresets } from "../source/components/graph/preset-catalogue"
import { createPresetBrowser } from "../source/components/graph/PresetBrowser"
import { publishedPreset } from "../source/services/preset-files"
import { parsePresetPage } from "../source/services/preset-page"
import { readFile } from "node:fs/promises"

afterEach(() => {
	document.body.replaceChildren()
	vi.unstubAllGlobals()
})

it("combines controller and style tags, preserves toggle state and clears them with search", () => {
	vi.stubGlobal("localStorage", { getItem: () => null })
	const browser = createPresetBrowser({ onApply: vi.fn(), startup: true })
	document.body.append(browser.element)
	try {
		const tag = (id: string) =>
			browser.element.querySelector<HTMLButtonElement>(`[data-tag="${id}"]`)!
		const panel = browser.element.querySelector<HTMLDetailsElement>(".preset-tags")!
		expect(panel.open).toBe(false)
		panel.open = true
		tag("inputs:leap-motion").click()
		tag("styles:pads").click()
		expect(tag("inputs:leap-motion").getAttribute("aria-pressed")).toBe("true")
		expect(tag("styles:pads").getAttribute("aria-pressed")).toBe("true")
		expect(tag("inputs:music-mouse").disabled).toBe(true)
		expect(browser.element.querySelector("nav")!.textContent).toContain("Leap Motion Aurora")
		expect(browser.element.querySelector(".preset-details h3")!.textContent).toBe(
			"Leap Motion Aurora"
		)
		expect(browser.element.querySelector("nav")!.textContent).not.toContain("Magic Mouse Prism")
		expect(panel.querySelector("summary")!.textContent).toContain("Pads")
		const search = browser.element.querySelector<HTMLInputElement>('[type="search"]')!
		search.value = "no-such-preset-xyz"
		search.dispatchEvent(new Event("input"))
		expect(browser.element.querySelector(".preset-no-results")).toBeTruthy()
		expect(browser.element.querySelector<HTMLElement>(".preset-apply-bar")!.hidden).toBe(true)
		expect(tag("inputs:leap-motion").disabled).toBe(false)
		browser.element.querySelector<HTMLButtonElement>('[aria-label="Clear filters"]')!.click()
		expect(browser.element.querySelectorAll("nav button")).toHaveLength(
			completePresets([]).length
		)
		expect(tag("styles:pads").getAttribute("aria-pressed")).toBe("false")
	} finally {
		browser.destroy()
	}
})

it("infers tags for saved setups and transformer-only presets", () => {
	const tags = presetTags({
		id: "saved",
		name: "Saved",
		description: "",
		activeChainId: "a",
		devices: [
			{
				id: "mouse",
				direction: "input",
				definition: { factory: "input", type: "music-mouse" }
			}
		],
		chains: [
			{
				id: "a",
				options: {},
				steps: [{ type: "Arpeggiator", config: {}, summary: "" }],
				inputs: ["mouse"],
				outputs: []
			}
		]
	})
	expect(tags.map((tag) => tag.id)).toEqual(
		expect.arrayContaining(["inputs:music-mouse", "styles:arpeggios"])
	)
	expect(
		presetTags({
			id: "local",
			name: "Local",
			category: "Saved",
			description: "",
			useCase: "",
			steps: [{ type: "Transposer", config: { distance: -12 }, summary: "" }]
		}).map((tag) => tag.id)
	).toContain("styles:bass")
})

it("supports authored JSON tags in tag filters and search and validates their shape", async () => {
	vi.stubGlobal("localStorage", { getItem: () => null })
	const preset = completePresets([]).find((preset) => preset.name === "Leap Motion Aurora")!
	const page = publishedPreset(preset.id)!.page
	const original = page.catalogue!.tags
	page.catalogue!.tags = ["Space jam"]
	const browser = createPresetBrowser({ onApply: vi.fn(), startup: true })
	document.body.append(browser.element)
	try {
		expect(browser.element.querySelector('[data-tag="tags:space jam"]')).toBeTruthy()
		const search = browser.element.querySelector<HTMLInputElement>('[type="search"]')!
		search.value = "Space jam"
		search.dispatchEvent(new Event("input"))
		expect(browser.element.querySelector("nav")!.textContent).toContain("Leap Motion Aurora")
		const json = JSON.parse(await readFile("presets/genres/electro.json", "utf8"))
		json.catalogue.tags = ["Live", "Ambient"]
		expect(parsePresetPage(JSON.stringify(json)).catalogue!.tags).toEqual(["Live", "Ambient"])
		for (const tags of [[""], [42], Array(33).fill("tag")]) {
			json.catalogue.tags = tags
			expect(() => parsePresetPage(JSON.stringify(json))).toThrow(
				"Invalid preset catalogue metadata"
			)
		}
	} finally {
		page.catalogue!.tags = original
		browser.destroy()
	}
})