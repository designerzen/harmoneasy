// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { Storage } from "happy-dom"
import {
	EVENT_CHANGE,
	EVENT_CLICK,
	EVENT_INPUT
} from "../../../packages/audiobus/events/event-constants"
import { createThemeControls, THEME_PRESETS, THEME_STORAGE_KEY } from "../source/services/theme"

let dispose: (() => void) | undefined
beforeEach(() => {
	vi.stubGlobal("localStorage", new Storage())
})
afterEach(() => {
	dispose?.()
	vi.restoreAllMocks()
	localStorage.clear()
	vi.unstubAllGlobals()
	document.body.replaceChildren()
	document.documentElement.removeAttribute("style")
	delete document.documentElement.dataset.themeMode
})
function setup() {
	const html = readFileSync("index.html", "utf8")
	document.body.innerHTML = html.slice(
		html.indexOf('<fieldset id="theme-settings">'),
		html.indexOf("</fieldset>", html.indexOf('<fieldset id="theme-settings">')) + 11
	)
	dispose = createThemeControls(document)
	return {
		preset: document.querySelector<HTMLSelectElement>("#theme-preset")!,
		mode: document.querySelector<HTMLSelectElement>("#theme-mode")!,
		hue: document.querySelector<HTMLInputElement>("#theme-hue")!
	}
}
describe("Browser-local appearance", () => {
	it("drives colour intensity from the preset while storing only hue and mode", () => {
		const { preset, hue } = setup()
		preset.value = "260"
		preset.dispatchEvent(new Event(EVENT_CHANGE))
		expect(document.documentElement.style.getPropertyValue("--theme-chroma")).toBe("0.25")
		expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('{"hue":260,"mode":"system"}')
		hue.value = "217"
		hue.dispatchEvent(new Event(EVENT_INPUT))
		expect(document.documentElement.style.getPropertyValue("--theme-chroma")).toBe("1")
	})
	it("keeps every application colour in the token file", () => {
		const literalColour = /:[^;{]*(#[0-9a-f]{3,8}\b(?![\w-])|rgba?\(|hsla?\()/i
		// Gradients may keep literal stops, such as fixed meter colours and hardware shading.
		const withoutGradients = (source: string) =>
			source.replace(/[\w-]*gradient\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/gi, "")
		expect(
			withoutGradients("a { background: repeating-linear-gradient(#000, rgb(0 0 0) 50%); }")
		).not.toMatch(literalColour)
		expect(withoutGradients("a { background: linear-gradient(#000, #fff) #123; }")).toMatch(
			literalColour
		)
		const styles = readdirSync("source/assets/style").filter((file) => file.endsWith(".scss"))
		for (const file of styles) {
			const source = readFileSync(`source/assets/style/${file}`, "utf8")
			expect(withoutGradients(source), file).not.toMatch(literalColour)
		}
	})
	it("starts with system brightness and renders all hue presets without writing storage", () => {
		const { preset, mode } = setup()
		expect(mode.value).toBe("system")
		expect(preset.options.length).toBe(THEME_PRESETS.length + 1)
		expect(document.documentElement.style.getPropertyValue("--theme-hue")).toBe("290")
		expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
	})
	it("applies custom hue immediately, stores only hue and mode, and restores them on reload", () => {
		const originalUrl = location.href
		const { hue, mode } = setup()
		hue.value = "217"
		hue.dispatchEvent(new Event(EVENT_INPUT))
		mode.value = "dark"
		mode.dispatchEvent(new Event(EVENT_CHANGE))
		expect(document.documentElement.dataset.themeMode).toBe("dark")
		expect(document.querySelector<HTMLOutputElement>("#theme-hue-value")!.value).toBe("217°")
		expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('{"hue":217,"mode":"dark"}')
		expect(location.href).toBe(originalUrl)
		dispose?.()
		const restored = setup()
		expect(restored.hue.value).toBe("217")
		expect(restored.mode.value).toBe("dark")
		expect(restored.preset.value).toBe("custom")
	})
	it("supports preset changes, system mode, and reset without touching other settings", () => {
		localStorage.setItem("unrelated-setting", "keep")
		const { preset, mode } = setup()
		preset.value = "145"
		preset.dispatchEvent(new Event(EVENT_CHANGE))
		expect(document.documentElement.style.getPropertyValue("--theme-hue")).toBe("145")
		mode.value = "light"
		mode.dispatchEvent(new Event(EVENT_CHANGE))
		mode.value = "system"
		mode.dispatchEvent(new Event(EVENT_CHANGE))
		expect(document.documentElement.dataset.themeMode).toBe("system")
		document.getElementById("theme-reset")!.dispatchEvent(new Event(EVENT_CLICK))
		expect(preset.value).toBe("290")
		expect(localStorage.getItem("unrelated-setting")).toBe("keep")
		expect(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY)!)).toEqual({
			hue: 290,
			mode: "system"
		})
	})
	it.each([
		"{broken",
		"null",
		'{"hue":-1,"mode":"invalid"}',
		'{"hue":"42","mode":null}',
		'{"hue":1e999,"mode":"invalid"}'
	])("recovers safely from invalid preferences: %s", (value) => {
		localStorage.setItem(THEME_STORAGE_KEY, value)
		const { hue, mode } = setup()
		expect(hue.value).toBe("290")
		expect(mode.value).toBe("system")
	})
	it("continues applying themes when local storage is blocked", () => {
		vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
			throw new Error("blocked")
		})
		const { preset } = setup()
		preset.value = "75"
		expect(() => preset.dispatchEvent(new Event(EVENT_CHANGE))).not.toThrow()
		expect(document.documentElement.style.getPropertyValue("--theme-hue")).toBe("75")
		expect(document.getElementById("theme-status")!.textContent).toContain("unavailable")
	})
	it("meets WCAG 2.2 AA/AAA contrast ratios across light, dark, colorblind-safe, and high-contrast tokens", () => {
		const tokens = readFileSync("source/assets/style/tokens.css", "utf8")
		const oklchToLum = (L: number, C: number, hDeg: number) => {
			const h = (hDeg * Math.PI) / 180
			const a = C * Math.cos(h)
			const b = C * Math.sin(h)
			const l_ = L + 0.3963377774 * a + 0.2158037573 * b
			const m_ = L - 0.1055613458 * a - 0.0638541728 * b
			const s_ = L - 0.0894841775 * a - 1.291485548 * b
			const l = l_ ** 3
			const m = m_ ** 3
			const s = s_ ** 3
			const r = Math.min(1, Math.max(0, +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s))
			const g = Math.min(1, Math.max(0, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s))
			const bl = Math.min(1, Math.max(0, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s))
			return 0.2126 * r + 0.7152 * g + 0.0722 * bl
		}
		const contrast = (c1: [number, number, number], c2: [number, number, number]) => {
			const l1 = oklchToLum(...c1)
			const l2 = oklchToLum(...c2)
			return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
		}
		const parsePair = (block: string, prop: string) => {
			const match = block.match(
				new RegExp(
					`${prop}:\\s*light-dark\\(\\s*oklch\\(([\\d.]+)%\\s+([\\d.]+)\\s+([\\d.]+)\\)\\s*,\\s*oklch\\(([\\d.]+)%\\s+([\\d.]+)\\s+([\\d.]+)\\)\\s*\\)`
				)
			)
			expect(match, `missing light-dark OKLCH token ${prop}`).not.toBeNull()
			return {
				light: [Number(match![1]) / 100, Number(match![2]), Number(match![3])] as [
					number,
					number,
					number
				],
				dark: [Number(match![4]) / 100, Number(match![5]), Number(match![6])] as [
					number,
					number,
					number
				]
			}
		}

		const rootBlock = tokens.slice(tokens.indexOf(":root {"), tokens.indexOf("@media (prefers-color-scheme: dark)"))
		const cbBlock = tokens.slice(
			tokens.indexOf(':root[data-palette="colorblind-safe"]'),
			tokens.indexOf(':root[data-contrast="high"]')
		)
		const highBlock = tokens.slice(
			tokens.indexOf(':root[data-contrast="high"]'),
			tokens.indexOf(':root[data-target-size="large"]')
		)

		const defaultFg = parsePair(rootBlock, "--stage-pad-fg")
		const highFg = parsePair(highBlock, "--stage-pad-fg")

		for (let i = 1; i <= 8; i++) {
			const pad = parsePair(rootBlock, `--stage-pad-${i}`)
			expect(contrast(defaultFg.light, pad.light), `default light pad ${i}`).toBeGreaterThanOrEqual(7)
			expect(contrast(defaultFg.dark, pad.dark), `default dark pad ${i}`).toBeGreaterThanOrEqual(7)

			const cbPad = parsePair(cbBlock, `--stage-pad-${i}`)
			expect(contrast(defaultFg.light, cbPad.light), `cb light pad ${i}`).toBeGreaterThanOrEqual(6)
			expect(contrast(defaultFg.dark, cbPad.dark), `cb dark pad ${i}`).toBeGreaterThanOrEqual(7)

			const highPad = parsePair(highBlock, `--stage-pad-${i}`)
			expect(contrast(highFg.light, highPad.light), `high light pad ${i}`).toBeGreaterThanOrEqual(10)
			expect(contrast(highFg.dark, highPad.dark), `high dark pad ${i}`).toBeGreaterThanOrEqual(10)
		}

		// Accent & text contrast must stay >= 4.5:1 across all 360 user theme hues
		for (let h = 0; h < 360; h += 10) {
			expect(contrast([0.45, 0.13, h], [0.96, 0.014, h])).toBeGreaterThanOrEqual(4.5)
			expect(contrast([0.99, 0, h], [0.45, 0.13, h])).toBeGreaterThanOrEqual(4.5)
			expect(contrast([0.8, 0.13, h], [0.25, 0.014, h])).toBeGreaterThanOrEqual(4.5)
			expect(contrast([0.16, 0.014, h], [0.8, 0.13, h])).toBeGreaterThanOrEqual(4.5)
		}

		expect(tokens).toContain("@media (prefers-reduced-motion: reduce)")
		expect(tokens).toContain("@media (forced-colors: active)")
	})
})