// @vitest-environment happy-dom
import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
	createMidiDeviceStore,
	MIDI_DEVICE_DIRECTORY,
	midiDeviceFolders
} from "audiobus/hardware/midi-devices/device-files.js"

const html = readFileSync("public/midi-devices.html", "utf8")
const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)![1]
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
const store = createMidiDeviceStore(() => [MIDI_DEVICE_DIRECTORY])
// The catalog shows the surface image a profile declares, falling back to panel.svg.
const diagramName = (devicePath: string, id: string): string =>
	JSON.parse(readFileSync(`${MIDI_DEVICE_DIRECTORY}/${devicePath}/${id}.json`, "utf8")).surface
		?.src ?? "panel.svg"

async function catalog(
	overrides: Record<string, unknown> = {},
	midiNavigator: object = {},
	secureContext = true
) {
	document.head.innerHTML = '<base href="https://example.test/harmoneasy/midi-devices.html">'
	document.body.innerHTML = /<body>([\s\S]*?)<script type="module">/.exec(html)![1]
	const fetcher = vi.fn(async (input: URL) => {
		const relative = new URL(String(input)).pathname.replace("/harmoneasy/midi-devices/", "")
		if (relative in overrides) {
			return overrides[relative] === null
				? new Response(null, { status: 404 })
				: new Response(JSON.stringify(overrides[relative]))
		}
		const file = await store.read(relative)
		return file
			? new Response(file.bytes.toString("utf8"))
			: new Response(null, { status: 404 })
	})
	await new AsyncFunction("document", "fetch", "navigator", "isSecureContext", script)(
		document,
		fetcher,
		midiNavigator,
		secureContext
	)
	return fetcher
}

afterEach(() => {
	document.head.replaceChildren()
	document.body.replaceChildren()
})

describe("standalone MIDI device catalog", () => {
	it("loads every registry device with its assets and details under a deployment subpath", async () => {
		await catalog()
		const ids = await store.list()
		expect(document.querySelectorAll("article")).toHaveLength(ids.length)
		expect(document.getElementById("status")?.textContent).toBe(
			`${ids.length} devices available.`
		)
		expect(document.getElementById("catalog")?.getAttribute("aria-busy")).toBe("false")
		const folders = new Map(midiDeviceFolders().map((entry) => [entry.id, entry.path]))
		for (const id of ids) {
			const devicePath = folders.get(id)!
			const card = document.getElementById(`device-${id}`)!
			expect(card.querySelector("h2")?.textContent).toBeTruthy()
			expect(card.querySelector(".icon")?.getAttribute("src")).toBe(
				`https://example.test/harmoneasy/midi-devices/${devicePath}/icon.svg`
			)
			expect(card.querySelector(".diagram")?.getAttribute("src")).toBe(
				`https://example.test/harmoneasy/midi-devices/${devicePath}/${diagramName(devicePath, id)}`
			)
			expect(card.querySelector("details")?.textContent).toContain(id)
			expect(card.querySelector(".asset-links a:last-child")?.getAttribute("href")).toBe(
				`https://example.test/harmoneasy/midi-devices/${devicePath}/${id}.json`
			)
		}
		const microfreak = document.getElementById("device-arturia-microfreak")!
		expect(microfreak.querySelector("details")?.textContent).toContain("Utility > MIDI")
		expect(
			[...microfreak.querySelectorAll("tbody tr")].some((row) =>
				row.textContent?.includes("Filter cutoffCC 23")
			)
		).toBe(true)
	})

	it("keeps available devices visible when another profile fails", async () => {
		const fetcher = await catalog({
			"index.json": [
				{ id: "arcana-strum", path: "arcana/strum" },
				"missing-device",
				"../escape",
				{ id: "arcana-strum", path: "arcana/strum" }
			],
			"missing-device/missing-device.json": null
		})
		expect(document.querySelectorAll("article")).toHaveLength(1)
		expect(document.getElementById("status")?.textContent).toBe(
			"1 device available. 1 profile could not be loaded."
		)
		expect(fetcher).toHaveBeenCalledTimes(3)
	})

	it("shows a recoverable error when the registry is unavailable", async () => {
		await catalog({ "index.json": null })
		expect(document.getElementById("status")?.textContent).toContain("Reload the page")
		expect(document.getElementById("catalog")?.getAttribute("aria-busy")).toBe("false")
	})

	it("renders profile text safely and rejects active documentation URLs", async () => {
		const name = '<img src="x" onerror="alert(1)">'
		await catalog({
			"index.json": ["custom-device"],
			"custom-device/custom-device.json": {
				schemaVersion: 1,
				name,
				documentation: [{ title: "Unsafe", url: "javascript:alert(1)" }]
			}
		})
		expect(document.querySelector("h2")?.textContent).toBe(name)
		expect(document.querySelector("img[onerror]")).toBeNull()
		expect(document.querySelector('a[href^="javascript:"]')).toBeNull()
	})

	it("highlights connected inputs and outputs after MIDI access, counting each profile once", async () => {
		const access = {
			inputs: new Map([
				["input", { id: "input", name: "  mIcRoFrEaK  ", state: "connected" }]
			]),
			outputs: new Map([
				["output", { id: "output", name: "MicroFreak", state: "connected" }],
				["s1", { id: "s1", name: "S-1", state: "connected" }]
			]),
			onstatechange: null
		}
		const requestMIDIAccess = vi.fn().mockResolvedValue(access)
		await catalog({}, { requestMIDIAccess })
		expect(requestMIDIAccess).not.toHaveBeenCalled()
		expect(document.querySelector("article")?.getAttribute("data-connected")).toBe("unknown")
		document.querySelector<HTMLButtonElement>("#detect-midi")!.click()
		await vi.waitFor(() => expect(document.querySelectorAll(".is-connected")).toHaveLength(2))
		expect(requestMIDIAccess).toHaveBeenCalledWith({ sysex: false })
		const card = document.getElementById("device-arturia-microfreak")!
		expect(card.querySelector(".connection-status")?.textContent).toBe("Connected")
		expect(card.querySelector(".connection-ports")?.textContent).toContain("Output: MicroFreak")
		expect(document.getElementById("midi-status")?.textContent).toContain(
			"2 catalog devices connected"
		)
	})

	it("updates on hot-plug and stays connected until the last matching port disconnects", async () => {
		const input = { id: "in", name: "MicroFreak", state: "connected" }
		const output = { id: "out", name: "MicroFreak", state: "connected" }
		const access = {
			inputs: new Map([["in", input]]),
			outputs: new Map([["out", output]]),
			onstatechange: null as (() => void) | null
		}
		await catalog({}, { requestMIDIAccess: vi.fn().mockResolvedValue(access) })
		document.querySelector<HTMLButtonElement>("#detect-midi")!.click()
		await vi.waitFor(() => expect(access.onstatechange).toBeTypeOf("function"))
		const card = document.getElementById("device-arturia-microfreak")!
		input.state = "disconnected"
		access.onstatechange!()
		expect(card.getAttribute("data-connected")).toBe("true")
		output.state = "disconnected"
		access.onstatechange!()
		expect(card.getAttribute("data-connected")).toBe("false")
		expect(card.classList.contains("is-connected")).toBe(false)
		expect(card.querySelector(".connection-status")?.textContent).toBe("Not detected")
		expect(card.querySelector<HTMLElement>(".connection-ports")?.hidden).toBe(true)
		access.inputs.set("new", { id: "new", name: "KeyStep", state: "connected" })
		access.onstatechange!()
		expect(
			document.getElementById("device-arturia-keystep")?.getAttribute("data-connected")
		).toBe("true")
	})

	it("uses exact IDs before port aliases and reports unrecognized interfaces", async () => {
		const access = {
			inputs: new Map([
				["priority", { id: "arturia-keystep", name: "MicroFreak", state: "connected" }],
				["virtual", { id: "virtual", name: "MicroFreak DAW", state: "connected" }],
				["din", { id: "din", name: "USB MIDI Interface", state: "connected" }]
			]),
			outputs: new Map()
		}
		await catalog({}, { requestMIDIAccess: vi.fn().mockResolvedValue(access) })
		document.querySelector<HTMLButtonElement>("#detect-midi")!.click()
		await vi.waitFor(() => expect(document.querySelectorAll(".is-connected")).toHaveLength(1))
		expect(
			document.getElementById("device-arturia-keystep")?.getAttribute("data-connected")
		).toBe("true")
		expect(
			document.getElementById("device-arturia-microfreak")?.getAttribute("data-connected")
		).toBe("false")
		expect(document.getElementById("midi-status")?.textContent).toContain("USB MIDI Interface")
	})

	it("keeps the catalog usable without Web MIDI or a secure context", async () => {
		await catalog()
		expect(document.querySelector<HTMLButtonElement>("#detect-midi")?.disabled).toBe(true)
		expect(document.getElementById("midi-status")?.textContent).toContain(
			"does not support Web MIDI"
		)
		await catalog({}, { requestMIDIAccess: vi.fn() }, false)
		expect(document.querySelector<HTMLButtonElement>("#detect-midi")?.disabled).toBe(true)
		expect(document.getElementById("midi-status")?.textContent).toContain("HTTPS or localhost")
		expect(document.querySelectorAll("article").length).toBeGreaterThan(0)
	})

	it("allows a denied MIDI request to be retried without changing unchecked card states", async () => {
		const requestMIDIAccess = vi
			.fn()
			.mockRejectedValueOnce(new Error("Denied"))
			.mockResolvedValue({ inputs: new Map(), outputs: new Map() })
		await catalog({}, { requestMIDIAccess })
		const button = document.querySelector<HTMLButtonElement>("#detect-midi")!
		button.click()
		expect(button.disabled).toBe(true)
		await vi.waitFor(() => expect(button.disabled).toBe(false))
		expect(document.getElementById("midi-status")?.textContent).toContain("not granted")
		expect(document.querySelector("article")?.getAttribute("data-connected")).toBe("unknown")
		button.click()
		await vi.waitFor(() => expect(button.textContent).toBe("Refresh connections"))
		expect(document.getElementById("midi-status")?.textContent).toContain(
			"0 catalog devices connected"
		)
		button.click()
		await vi.waitFor(() => expect(button.disabled).toBe(false))
		expect(requestMIDIAccess).toHaveBeenCalledTimes(2)
	})
})