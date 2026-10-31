// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { presetDirectoryEntries, presetDirectoryHtml } from "../scripts/preset-directory.js"
import { mountPresetDirectory } from "../scripts/preset-directory-client.js"

const page = (name: string, input: string, output: string) => ({
	name,
	description: `${name} playable setup`,
	clock: { bpm: 120 },
	workspace: {
		devices: [
			{ direction: "input", definition: { type: input } },
			{ direction: "output", definition: { type: output } }
		],
		chains: [{ transformers: JSON.stringify([JSON.stringify({ type: "Harmoniser" })]) }]
	}
})
const cosmo = page("Cosmo Strings", "cosmo-dots", "yoshimi")
const piano = page("Keyboard Piano", "keyboard", "polyphonic")
const pages = new Map([
	["hardware/cosmo/dots", cosmo],
	["preset/hardware/cosmo/dots", cosmo],
	["presets/activities/piano", piano]
])
const entries = presetDirectoryEntries(pages)
afterEach(() => document.body.replaceChildren())
function mount(query = "") {
	window.history.replaceState(null, "", `/harmoneasy/presets/${query}`)
	document.body.innerHTML = presetDirectoryHtml(entries, "/harmoneasy/", "")
	const root = document.getElementById("preset-directory")!
	mountPresetDirectory(root)
	const select = (name: string, value: string) => {
		const input = root.querySelector<HTMLInputElement>(`[name="${name}"]`)!
		input.value = value
		input.dispatchEvent(new Event("input", { bubbles: true }))
	}
	return {
		root,
		select,
		visible: () =>
			[...root.querySelectorAll<HTMLElement>(".preset")].filter((card) => !card.hidden)
	}
}
describe("standalone preset directory", () => {
	it("lists each preset once, preserves aliases and includes new folder presets", () => {
		const result = presetDirectoryEntries(
			pages,
			new Map([
				["preset/hardware/cosmo/dots", { ...cosmo, name: "Updated Cosmo Strings" }],
				["preset/community/test", page("New folder preset", "webmidi", "303")]
			])
		)
		expect(result).toHaveLength(3)
		expect(result.find((entry) => entry.name === "Updated Cosmo Strings")).toMatchObject({
			route: "hardware/cosmo/dots",
			category: "Hardware",
			aliases: ["hardware/cosmo/dots", "preset/hardware/cosmo/dots"]
		})
		expect(result.find((entry) => entry.name === "New folder preset")?.category).toBe(
			"Community"
		)
	})
	it("renders usable links without the app bundle or JavaScript and escapes preset text", () => {
		const html = presetDirectoryHtml(entries, "/harmoneasy/", "")
		document.body.innerHTML = html
		expect(document.querySelector('a[href="/harmoneasy/hardware/cosmo/dots/"]')).not.toBeNull()
		expect(
			document.querySelector('a[href="/harmoneasy/hardware/cosmo/dots/preset.json"]')
		).not.toBeNull()
		expect(html).not.toContain("assets/app.js")
		const unsafe = [
			{
				...entries[0],
				name: '<img src=x onerror="alert(1)">',
				description: "<script>bad()</script>"
			}
		]
		document.body.innerHTML = presetDirectoryHtml(unsafe, "/", "")
		expect(document.querySelector(".preset img")).toBeNull()
		expect(document.querySelector(".preset h2")!.textContent).toBe(unsafe[0].name)
	})
	it("combines case-insensitive search with category, input and output filters", () => {
		const { root, select, visible } = mount()
		select("q", "COSMO harmoniser")
		expect(visible()).toHaveLength(1)
		select("category", "Hardware")
		select("input", "cosmo-dots")
		select("output", "yoshimi")
		expect(visible()).toHaveLength(1)
		expect(root.querySelector("#result-count")!.textContent).toBe("1 preset of 2")
		select("output", "polyphonic")
		expect(visible()).toHaveLength(0)
		expect(root.querySelector<HTMLElement>("#no-results")!.hidden).toBe(false)
	})
	it("restores shareable filters and clears them while keeping unrelated query parameters", () => {
		const { root, visible } = mount(
			"?q=cosmo&category=Hardware&input=cosmo-dots&output=yoshimi&ref=test"
		)
		expect(visible()).toHaveLength(1)
		root.querySelector<HTMLButtonElement>("#clear-filters")!.click()
		expect(visible()).toHaveLength(2)
		expect(window.location.search).toBe("?ref=test")
		expect(document.activeElement).toBe(root.querySelector('[name="q"]'))
	})
	it("ignores unknown select values in shared URLs", () => {
		const { visible } = mount("?input=unknown")
		expect(visible()).toHaveLength(2)
		expect(window.location.search).toBe("")
	})
})