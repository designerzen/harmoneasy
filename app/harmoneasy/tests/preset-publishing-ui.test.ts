// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import { readFile } from "node:fs/promises"
import { createPresetBrowser } from "../source/components/graph/PresetBrowser"
import { downloadLibrary } from "../source/components/graph/saved-presets"

vi.mock("../source/components/graph/saved-presets", async (original) => ({
	...(await original<typeof import("../source/components/graph/saved-presets")>()),
	downloadLibrary: vi.fn()
}))

const page = JSON.parse(await readFile("presets/inputs/leap-motion/aurora.json", "utf8"))
afterEach(() => {
	document.body.replaceChildren()
	vi.unstubAllGlobals()
	vi.clearAllMocks()
})

it("exports the current workspace with a filename and exact pull-request destination", () => {
	vi.stubGlobal("localStorage", { getItem: () => null })
	const manager = {
		chains: [{ timer: { BPM: 98, bars: 8, divisions: 24 } }],
		exportWorkspaceData: () => structuredClone(page.workspace)
	}
	const browser = createPresetBrowser({ manager: manager as any, onApply: vi.fn() })
	try {
		const action = [
			...document.querySelectorAll<HTMLButtonElement>(".preset-library-actions button")
		].find((button) => button.textContent === "Export preset for publishing")!
		action.click()
		const form = [
			...document.querySelectorAll<HTMLFormElement>(".preset-library-dialog form")
		].find((form) => form.textContent?.includes("Repository path"))!
		expect(form.hidden).toBe(false)
		const [name, description, path] = form.querySelectorAll<HTMLInputElement>("input")
		name.value = "My aurora"
		description.value = "Move your hand to play."
		path.value = "community/my-aurora"
		path.dispatchEvent(new Event("input"))
		expect(form.textContent).toContain("app/harmoneasy/presets/community/my-aurora.json")
		form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
		expect(downloadLibrary).toHaveBeenCalledOnce()
		const [json, filename] = vi.mocked(downloadLibrary).mock.calls[0]
		expect(filename).toBe("my-aurora")
		expect(JSON.parse(json)).toMatchObject({
			format: "harmoneasy-preset",
			name: "My aurora",
			description: "Move your hand to play.",
			clock: { bpm: 98, bars: 8 },
			workspace: page.workspace
		})
		path.value = "../invalid"
		form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
		expect(downloadLibrary).toHaveBeenCalledOnce()
		expect(document.querySelector(".preset-library-body")?.textContent).toContain(
			"Invalid preset filename"
		)
	} finally {
		browser.destroy()
	}
})