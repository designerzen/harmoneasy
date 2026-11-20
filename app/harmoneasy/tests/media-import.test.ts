import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { createRequire } from "node:module"
const { zipSync, strToU8 } = createRequire(
	new URL("../../../packages/audiobus/package.json", import.meta.url)
)("fflate")
import { createMediaImporter } from "../source/services/media-import"

const factories = vi.hoisted(() => ({
	input: vi.fn(),
	output: vi.fn(),
	midi: vi.fn(),
	store: vi.fn()
}))
vi.mock("../../../packages/audiobus/io/input-factory", () => ({ createInputById: factories.input }))
vi.mock("../../../packages/audiobus/io/output-factory", () => ({
	createOutputById: factories.output
}))
vi.mock("../../../packages/audiobus/importers/import-midi-file", () => ({
	importMIDIFile: factories.midi
}))
vi.mock("../source/services/wam-archive", () => ({ storeWamArchive: factories.store }))
const chain = {}
let manager: any, score: ReturnType<typeof vi.fn>, output: any
beforeEach(() => {
	vi.resetAllMocks()
	output = { connect: vi.fn(), destroy: vi.fn(), loadSample: vi.fn() }
	factories.output.mockResolvedValue(output)
	factories.input.mockResolvedValue({ name: "tune" })
	factories.midi.mockResolvedValue({
		noteCount: 1,
		commands: [{ type: "noteOn", startAt: 0, number: 60 }]
	})
	manager = {
		activeChain: chain,
		deviceOptions: { mixer: {} },
		audioContext: { resume: vi.fn() },
		addDevice: vi.fn()
	}
	score = vi.fn()
})
afterEach(() => vi.unstubAllGlobals())

it("loads hosted community entry points and descriptors as WAM2 outputs", async () => {
	const load = createMediaImporter(manager, score)
	await load(
		"https://www.webaudiomodules.com/community/plugins/burns-audio/synth101/descriptor.json"
	)
	expect(factories.output).toHaveBeenCalledWith(
		"wam2",
		expect.objectContaining({
			pluginUrl:
				"https://www.webaudiomodules.com/community/plugins/burns-audio/synth101/index.js"
		})
	)
	expect(output.connect).toHaveBeenCalledOnce()
	expect(manager.addDevice).toHaveBeenCalledWith(chain, output, "output")
})
it("uses the existing adapter for a supported legacy WAM", async () => {
	await createMediaImporter(manager, score)("legacy:dx7")
	expect(factories.output).toHaveBeenCalledWith(
		"wam",
		expect.objectContaining({ pluginUrl: "legacy:dx7" })
	)
})
it("adds MIDI as a saved input instead of scheduling it directly on the chain", async () => {
	await createMediaImporter(manager, score)(new File(["MThd0000"], "song.mid"))
	expect(factories.input).toHaveBeenCalledWith(
		"midi-file",
		expect.objectContaining({
			fileName: "song.mid",
			commands: [{ type: "noteOn", startAt: 0, number: 60 }]
		})
	)
	expect(manager.addDevice).toHaveBeenCalledWith(chain, { name: "tune" }, "input")
	expect(score).not.toHaveBeenCalled()
})
it("cleans up a failed plugin and preserves existing score imports", async () => {
	output.connect.mockRejectedValue(new Error("Plugin failed"))
	const load = createMediaImporter(manager, score)
	await expect(load("https://example.com/index.js")).rejects.toThrow("Plugin failed")
	expect(output.destroy).toHaveBeenCalledOnce()
	expect(manager.addDevice).not.toHaveBeenCalled()
	const xml = new File(["<score/>"], "song.musicxml")
	await load(xml)
	expect(score).toHaveBeenCalledWith(xml)
})
it("rejects misleading MIDI files and page links with useful errors", async () => {
	const load = createMediaImporter(manager, score)
	await expect(load(new File(["not MIDI"], "song.mid"))).rejects.toThrow(
		"Standard MIDI File header"
	)
	await expect(load("https://example.com/community.html")).rejects.toThrow(
		"documentation or gallery page"
	)
})
it("routes compressed MusicXML and DAWproject archives to score import", async () => {
	const load = createMediaImporter(manager, score)
	for (const extension of ["mxl", "dawproject"]) {
		const contents =
			extension === "mxl"
				? {
						"META-INF/container.xml": strToU8("<container/>"),
						"score.musicxml": strToU8("<score-partwise/>")
					}
				: { "project.xml": strToU8("<Project/>") }
		const file = new File([zipSync(contents)], `song.${extension}`)
		await load(file)
		expect(score).toHaveBeenCalledWith(file)
	}
})
it("loads detected NoteSequence data as a saved playable note input", async () => {
	const file = new File(
		[JSON.stringify({ notes: [{ pitch: 60, startTime: 0, endTime: 0.5, velocity: 90 }] })],
		"unknown.dat"
	)
	await createMediaImporter(manager)(file)
	expect(factories.input).toHaveBeenCalledWith(
		"midi-file",
		expect.objectContaining({
			fileName: "unknown.dat",
			commands: expect.arrayContaining([
				expect.objectContaining({ type: "noteOn", number: 60, endAt: 0.5 })
			])
		})
	)
	expect(manager.addDevice).toHaveBeenCalledWith(chain, expect.anything(), "input")
})
it("loads detected audio into a Loop Player and cleans up decoding failures", async () => {
	const file = new File(["RIFF0000WAVEdata"], "unknown.dat")
	await createMediaImporter(manager)(file)
	expect(factories.output).toHaveBeenCalledWith("loop-player", manager.deviceOptions)
	expect(output.loadSample).toHaveBeenCalledWith(expect.any(ArrayBuffer), "unknown.dat")
	expect(manager.addDevice).toHaveBeenCalledWith(chain, output, "output")
	manager.addDevice.mockClear()
	output.loadSample.mockRejectedValue(new Error("Unsupported codec"))
	await expect(createMediaImporter(manager)(file)).rejects.toThrow("Unsupported codec")
	expect(output.destroy).toHaveBeenCalled()
	expect(manager.addDevice).not.toHaveBeenCalled()
})