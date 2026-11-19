// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import {
	deviceAvailability,
	describeMissing,
	requiring
} from "../../../packages/audiobus/io/device-requirements"
import { INPUT_FACTORIES } from "../../../packages/audiobus/io/input-factory"
import { OUTPUT_FACTORIES } from "../../../packages/audiobus/io/output-factory"
import { createTransformerPicker } from "../source/components/graph/Transformers"

afterEach(() => {
	vi.unstubAllGlobals()
	vi.unstubAllEnvs()
	document.body.replaceChildren()
})

it("explains which browser features a device is missing", () => {
	vi.stubGlobal("WebSocket", undefined)
	expect(deviceAvailability(requiring("page", "webSocket"))).toEqual({
		available: false,
		missing: ["WebSockets"],
		hidden: false
	})
	expect(deviceAvailability(requiring("page"))).toEqual({
		available: true,
		missing: [],
		hidden: false
	})
	expect(deviceAvailability({ isAvailable: () => false }).missing).toEqual([
		"features this browser does not have"
	])
	expect(describeMissing(["Web MIDI", "WebSockets"])).toBe("Needs Web MIDI and WebSockets")
})

it("hides development-only devices instead of disabling them", () => {
	vi.stubEnv("DEV", false)
	expect(deviceAvailability(requiring("development")).hidden).toBe(true)
})

it("declares requirements on factories that need browser features", () => {
	const requires = (factories: { id: string; requires?: readonly string[] }[], id: string) =>
		factories.find((factory) => factory.id === id)?.requires
	expect(requires(INPUT_FACTORIES, "webmidi")).toEqual(["webMidi"])
	expect(requires(INPUT_FACTORIES, "ble-midi")).toEqual(["bluetooth"])
	expect(requires(OUTPUT_FACTORIES, "butterchurn")).toEqual(["webgl2", "webAudio"])
	// Native MIDI inputs used to claim they worked everywhere; they need the host's addon.
	expect(INPUT_FACTORIES.find((factory) => factory.id === "native-midi")?.isAvailable()).toBe(
		false
	)
})

it("lists transformers this browser cannot run after the usable ones", () => {
	const picker = createTransformerPicker({ chain: {} } as any, { dialog: true })
	document.body.append(picker.element)
	const unavailable = picker.element.querySelector(".unavailable-choices")!
	expect(picker.element.querySelector("section:last-of-type")).toBe(unavailable)
	const browserAI = [...unavailable.querySelectorAll("button")].find((button) =>
		button.textContent?.includes("Browser AI Harmony")
	)!
	expect(browserAI.disabled).toBe(true)
	expect(browserAI.textContent).toContain("Needs built-in browser AI")
	picker.destroy()
})
