// @vitest-environment happy-dom
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
	createMidiDeviceStore,
	midiDeviceFilesPlugin
} from "audiobus/midi/hardware/device-files.js"
import { useTestMidiProfileFiles, bundledMidiDevices } from "./midi-profile-runtime-setup"
import {
	ensureMidiDeviceProfile,
	loadMidiProfilesForPorts,
	MIDI_DEVICE_PROFILES,
	refreshMidiDeviceProfiles,
	setMidiDeviceProfileSource
} from "../../../packages/audiobus/midi/hardware/device-profiles"
import { INPUT_FACTORIES, createInputById } from "../../../packages/audiobus/io/input-factory"
import { INPUT_DEFINITIONS } from "../../../packages/audiobus/io/input-definitions"
import { INPUT_GUIDANCE } from "../source/components/graph/device-card"

const temporary: string[] = []
afterEach(async () => {
	useTestMidiProfileFiles()
	for (const folder of temporary.splice(0)) {
		if (
			path.dirname(path.resolve(folder)) !== path.resolve(os.tmpdir()) ||
			!path.basename(folder).startsWith("harmoneasy-midi-")
		) {
			throw new Error("Unexpected temporary directory")
		}
		await rm(folder, { recursive: true, force: true })
	}
	vi.unstubAllGlobals()
})
const definition = (id: string) => ({
	id,
	schemaVersion: 1,
	name: "Runtime instrument",
	manufacturerUrl: "https://example.com/",
	productUrl: "https://example.com/instrument",
	icon: "icon.svg",
	gui: {
		type: "column",
		children: [
			{ type: "image", src: "panel.svg", alt: "Panel" },
			{ type: "controls" },
			{ type: "guide" }
		]
	},
	controls: [{ id: "expression", label: "Expression", cc: 102 }]
})
async function root() {
	const folder = await mkdtemp(path.join(os.tmpdir(), "harmoneasy-midi-"))
	temporary.push(folder)
	return folder
}
async function add(folder: string, id: string, filename = `${id}.json`) {
	const device = path.join(folder, id)
	await mkdir(device, { recursive: true })
	await writeFile(path.join(device, filename), JSON.stringify(definition(id)))
	for (const image of ["icon.svg", "panel.svg"]) {
		await writeFile(path.join(device, image), '<svg xmlns="http://www.w3.org/2000/svg"/>')
	}
}
describe("runtime device folders", () => {
	it("serves package hardware assets in development and copies raw device folders for deployed builds", async () => {
		const folder = await root()
		const plugin = midiDeviceFilesPlugin()
		plugin.configResolved({ base: "/test/", root: folder, build: { outDir: "site" } })
		const use = vi.fn()
		plugin.configureServer({ middlewares: { use } })
		const response = { setHeader: vi.fn(), end: vi.fn(), statusCode: 200 }
		const next = vi.fn()
		await use.mock.calls[0][0](
			{ url: "/test/midi-devices/digit-cmpsr/digit-cmpsr.json", method: "GET" },
			response,
			next
		)
		expect(next).not.toHaveBeenCalled()
		expect(JSON.parse(response.end.mock.calls[0][0].toString()).id).toBe("digit-cmpsr")
		await plugin.writeBundle()
		const built = createMidiDeviceStore(() => [path.join(folder, "site", "midi-devices")])
		expect(await built.list()).toEqual(
			await createMidiDeviceStore(() => [bundledMidiDevices]).list()
		)
		expect((await built.read("digit-cmpsr/panel.svg"))?.type).toBe("image/svg+xml")
		expect((await built.read("profile.schema.json"))?.type).toBe("application/json")
		expect(JSON.parse((await built.read("index.json"))!.bytes.toString())).toContain(
			"roland-tb-3"
		)
		plugin.configurePreviewServer({ middlewares: { use } })
		response.end.mockClear()
		await use.mock.calls[1][0](
			{ url: "/test/midi-devices/digit-cmpsr/digit-cmpsr.json", method: "GET" },
			response,
			next
		)
		expect(JSON.parse(response.end.mock.calls[0][0].toString()).id).toBe("digit-cmpsr")
	})
	it("discovers folders added after startup without importing or rebuilding application code", async () => {
		const folder = await root()
		useTestMidiProfileFiles([folder, bundledMidiDevices])
		await refreshMidiDeviceProfiles(true)
		expect(MIDI_DEVICE_PROFILES["runtime-controller"]).toBeUndefined()
		await add(folder, "runtime-controller")
		await refreshMidiDeviceProfiles(true)
		expect(MIDI_DEVICE_PROFILES["runtime-controller"].name).toBe("Runtime instrument")
		expect(INPUT_FACTORIES.some((factory) => factory.id === "runtime-controller")).toBe(true)
		expect(INPUT_DEFINITIONS["runtime-controller"].icon).toContain(
			"/runtime-controller/icon.svg"
		)
		expect(INPUT_GUIDANCE["runtime-controller"].requirements).toContain("Runtime instrument")
		Object.defineProperty(navigator, "requestMIDIAccess", {
			configurable: true,
			value: vi.fn()
		})
		const input = await createInputById("runtime-controller")
		const gui = await input.createGui!()
		expect(gui.querySelector("img")?.src).toContain("/runtime-controller/panel.svg")
		expect([...gui.querySelectorAll("a")].map((link) => link.href)).toEqual([
			"https://example.com/",
			"https://example.com/instrument"
		])
		await input.destroyGui!()
		delete (navigator as any).requestMIDIAccess
	})
	it("loads directly by connected device ID on a static host with no directory listing", async () => {
		const fetcher = vi.fn(async (url: string) =>
			url.endsWith("/static-runtime/static-runtime.json")
				? new Response(JSON.stringify(definition("static-runtime")))
				: new Response(null, { status: 404 })
		)
		setMidiDeviceProfileSource("https://static.example/midi-devices/", fetcher as typeof fetch)
		await loadMidiProfilesForPorts([{ id: "static-runtime" }])
		expect(MIDI_DEVICE_PROFILES["static-runtime"].icon).toBe(
			"https://static.example/midi-devices/static-runtime/icon.svg"
		)
		expect(fetcher).toHaveBeenCalledWith(
			"https://static.example/midi-devices/static-runtime/static-runtime.json",
			{ cache: "no-store" }
		)
	})
	it("discovers the complete registry from the static index even when MIDI port IDs are opaque", async () => {
		const id = "static-known-controller"
		const fetcher = vi.fn(async (url: string) => {
			if (url.endsWith("/index.json")) {
				return new Response(JSON.stringify([id]))
			}
			if (url.endsWith(`/${id}/${id}.json`)) {
				return new Response(
					JSON.stringify({ ...definition(id), portNames: ["Known Controller"] })
				)
			}
			return new Response(null, { status: 404 })
		})
		setMidiDeviceProfileSource("https://static.example/midi-devices/", fetcher as typeof fetch)
		await loadMidiProfilesForPorts([{ id: "opaque-os-port", name: "Known Controller" }])
		expect(MIDI_DEVICE_PROFILES[id].portNames).toEqual(["Known Controller"])
		expect(INPUT_FACTORIES.some((factory) => factory.id === id)).toBe(true)
	})
	it("requires each folder JSON to use its ID as the filename", async () => {
		const folder = await root()
		await add(folder, "wrong-name", "profile.json")
		const store = createMidiDeviceStore(() => [folder])
		expect(await store.list()).toEqual([])
		await add(folder, "correct-name")
		expect(await store.list()).toEqual(["correct-name"])
		expect(await store.read("../secret.json")).toBeNull()
		expect(await store.read("correct-name/../../secret.json")).toBeNull()
	})
	it("prefers user-supplied device folders and serves images as separate runtime files", async () => {
		const folder = await root()
		await add(folder, "arcana-strum")
		const store = createMidiDeviceStore(() => [folder, bundledMidiDevices])
		const file = await store.read("arcana-strum/arcana-strum.json")
		expect(JSON.parse(file!.bytes.toString()).name).toBe("Runtime instrument")
		expect((await store.read("arcana-strum/panel.svg"))?.type).toBe("image/svg+xml")
		expect(await ensureMidiDeviceProfile("../../secret")).toBeUndefined()
	})
})