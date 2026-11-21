// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { createMediaImporter } from "../source/services/media-import"
import { detectImportFile } from "../../../packages/audiobus/importers/file-import"

const factories = vi.hoisted(() => ({ output: vi.fn() }))
vi.mock("../../../packages/audiobus/io/output-factory", () => ({
	createOutputById: factories.output
}))

// Only the RIFF header matters for detection; the Rompler parses the rest itself
const soundfont = (name: string, size = 64) => {
	const bytes = new Uint8Array(size)
	bytes.set(new TextEncoder().encode("RIFF"), 0)
	bytes.set(new TextEncoder().encode("sfbk"), 8)
	return new File([bytes], name)
}
const rompler = (soundfont = "") => ({
	options: { soundfont },
	setSoundFont: vi.fn(async () => {}),
	allNotesOff: vi.fn()
})

let manager: any, added: any
beforeEach(() => {
	vi.resetAllMocks()
	added = rompler()
	added.connect = vi.fn(async () => {})
	added.destroy = vi.fn()
	factories.output.mockResolvedValue(added)
	manager = {
		chains: [],
		activeChain: undefined,
		deviceOptions: { mixer: {} },
		audioContext: { resume: vi.fn() },
		addDevice: vi.fn()
	}
})
afterEach(() => document.querySelectorAll("dialog").forEach((dialog) => dialog.remove()))

const dialogReady = async () => {
	for (let i = 0; i < 20 && !document.querySelector("#soundfont-dialog"); i++) {
		await new Promise((resolve) => setTimeout(resolve, 0))
	}
	return document.querySelector<HTMLDialogElement>("#soundfont-dialog")!
}
const button = (dialog: HTMLElement, text: string) =>
	[...dialog.querySelectorAll("button")].find((item) => item.textContent === text)!

it("detects soundfonts by content, beyond the usual media size limit", async () => {
	const large = soundfont("Big.bin")
	Object.defineProperty(large, "size", { value: 300 * 1024 * 1024 })
	expect((await detectImportFile(large)).format.kind).toBe("soundfont")
	const pack = new File(
		[
			'if (typeof(MIDI) === "undefined") var MIDI = {};\nMIDI.Soundfont.piano = {"A0": "data:audio/mp3;base64,AAA="}'
		],
		"piano.js"
	)
	expect((await detectImportFile(pack)).format.id).toBe("soundfont")
	const json = new File(['{"A0": "data:audio/ogg;base64,AAA="}'], "piano.json")
	expect((await detectImportFile(json)).format.id).toBe("soundfont")
})

it("asks which Romplers play a dropped soundfont and switches the chosen ones", async () => {
	const first = rompler(),
		second = rompler("https://fonts.test/Old.sf2")
	const lead = { options: { name: "Lead" }, outputs: [first] },
		pads = { options: {}, outputs: [{ name: "Other output" }, second] }
	manager.chains = [lead, pads]
	manager.activeChain = lead
	const loading = createMediaImporter(manager)(soundfont("Choir.sf2"))
	const dialog = await dialogReady()
	const rows = [...dialog.querySelectorAll(".soundfont-target")]
	expect(rows.map((row) => row.querySelector("span")!.textContent)).toEqual([
		"Lead · Rompler",
		"Chain 2 · Rompler",
		"Add a Rompler to Lead"
	])
	expect(rows[1].textContent).toContain("Now playing Old.sf2")
	const boxes = rows.map((row) => row.querySelector("input")!)
	expect(boxes.map(({ checked }) => checked)).toEqual([true, true, false])
	boxes[1].click()
	button(dialog, "Load soundfont").click()
	await loading
	expect(first.setSoundFont).toHaveBeenCalledWith("local:Choir.sf2:64")
	expect(second.setSoundFont).not.toHaveBeenCalled()
	expect(manager.addDevice).not.toHaveBeenCalled()
})

it("offers a new Rompler when none exist, and adds it playing the soundfont", async () => {
	const lead = { options: { name: "Lead" }, outputs: [] }
	manager.chains = [lead]
	manager.activeChain = lead
	const loading = createMediaImporter(manager)(soundfont("Keys.sf3"))
	const dialog = await dialogReady()
	const [row] = dialog.querySelectorAll(".soundfont-target")
	expect(dialog.querySelector("legend")!.textContent).toBe("No Romplers yet")
	expect(row.querySelector("input")!.checked).toBe(true)
	button(dialog, "Load soundfont").click()
	await loading
	expect(factories.output).toHaveBeenCalledWith(
		"rompler",
		expect.objectContaining({ soundfont: "local:Keys.sf3:64" })
	)
	expect(manager.addDevice).toHaveBeenCalledWith(lead, added, "output")
	expect(added.connect).toHaveBeenCalledOnce()
})

it("changes nothing when the dialog is cancelled", async () => {
	const existing = rompler()
	manager.chains = [{ options: {}, outputs: [existing] }]
	manager.activeChain = manager.chains[0]
	const loading = createMediaImporter(manager)(soundfont("Keys.sf2"))
	const dialog = await dialogReady()
	dialog.close()
	await loading
	expect(existing.setSoundFont).not.toHaveBeenCalled()
	expect(manager.addDevice).not.toHaveBeenCalled()
})