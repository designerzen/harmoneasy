// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import { File as NodeFile } from "node:buffer"
import { installImportMenu } from "../source/services/import-menu"
import { installMediaDrop } from "../source/services/media-drop"

const controllers: AbortController[] = []
afterEach(() => {
	controllers.splice(0).forEach((c) => c.abort())
	document.body.replaceChildren()
	vi.restoreAllMocks()
})
const file = (text: string, name: string) => new NodeFile([text], name) as unknown as File
function setup() {
	const controller = new AbortController(),
		receive = vi.fn(),
		dropped = vi.fn()
	controllers.push(controller)
	installMediaDrop(document, dropped, controller.signal)
	const trigger = document.createElement("button")
	trigger.textContent = "Import File"
	document.body.append(trigger)
	const dialog = installImportMenu(document, trigger, receive, controller.signal)
	dialog.showModal = () => {
		dialog.open = true
	}
	dialog.close = () => {
		dialog.open = false
		dialog.dispatchEvent(new Event("close"))
	}
	const input = dialog.querySelector<HTMLInputElement>('input[type="file"]')!
	const load = [...dialog.querySelectorAll("button")].find(
		(b) => b.textContent === "Import files"
	)!
	const choose = (files: File[]) => {
		Object.defineProperty(input, "files", { configurable: true, value: files })
		input.dispatchEvent(new Event("change"))
	}
	trigger.click()
	return { controller, receive, dropped, dialog, input, load, choose }
}
it("opens an accessible Import File menu and offers the centrally registered file types", () => {
	const { dialog, input, controller } = setup()
	expect(dialog.open).toBe(true)
	expect(dialog.getAttribute("aria-labelledby")).toBe("import-file-title")
	for (const extension of [".gp5", ".gp", ".capx", ".atex", ".json", ".wav", ".mxl", ".mid"]) {
		expect(input.accept).toContain(extension)
	}
	expect(dialog.textContent).toContain("Supported file types")
	controller.abort()
	expect(document.getElementById("import-file-dialog")).toBeNull()
})
it("shows detected destinations, keeps unsupported files visible, and imports only ready files", async () => {
	const { dialog, receive, load, choose } = setup()
	const midi = file("MThd0000", "renamed.bin"),
		audio = file("RIFF0000WAVEdata", "loop.dat"),
		pdf = file("%PDF0000", "score.pdf")
	choose([midi, audio, pdf])
	await vi.waitFor(() =>
		expect(dialog.querySelector('[role="status"]')?.textContent).toBe(
			"2 of 3 files ready to import."
		)
	)
	expect(dialog.textContent).toContain("renamed.bin: MIDI → Playable notes")
	expect(dialog.textContent).toContain("loop.dat: Audio → Loop Player")
	expect(dialog.textContent).toContain("score.pdf: Unsupported file type")
	expect(receive).not.toHaveBeenCalled()
	load.click()
	expect(receive.mock.calls).toEqual([[midi], [audio]])
	expect(dialog.open).toBe(false)
})
it("keeps drops inside the menu in the preview rather than importing twice", async () => {
	const { dialog, receive, dropped, load } = setup()
	const midi = file("MThd0000", "tune.mid")
	const event = new Event("drop", { bubbles: true, cancelable: true })
	Object.defineProperty(event, "dataTransfer", {
		value: { files: [midi], types: ["Files"], getData: () => "" }
	})
	dialog.dispatchEvent(event)
	await vi.waitFor(() => expect(load.disabled).toBe(false))
	expect(dropped).not.toHaveBeenCalled()
	expect(receive).not.toHaveBeenCalled()
	load.click()
	expect(receive).toHaveBeenCalledExactlyOnceWith(midi)
})
it("ignores a stale detection result after a newer file selection", async () => {
	const { dialog, choose, load, receive } = setup()
	let resolve!: (buffer: ArrayBuffer) => void
	const pending = new Promise<ArrayBuffer>((done) => {
		resolve = done
	})
	const slow = file("MThd0000", "slow.mid")
	Object.defineProperty(slow, "slice", { value: () => ({ arrayBuffer: () => pending }) })
	choose([slow])
	const fast = file("MThd0000", "fast.mid")
	choose([fast])
	await vi.waitFor(() => expect(load.disabled).toBe(false))
	resolve(new TextEncoder().encode("MThd0000").buffer)
	await Promise.resolve()
	await Promise.resolve()
	expect(dialog.textContent).toContain("fast.mid: MIDI")
	expect(dialog.textContent).not.toContain("slow.mid: MIDI")
	load.click()
	expect(receive).toHaveBeenCalledExactlyOnceWith(fast)
})
it("closing the menu invalidates an in-flight file detection", async () => {
	const { dialog, choose, load, receive } = setup()
	let resolve!: (buffer: ArrayBuffer) => void
	const pending = new Promise<ArrayBuffer>((done) => {
			resolve = done
		}),
		slow = file("MThd0000", "slow.mid")
	Object.defineProperty(slow, "slice", { value: () => ({ arrayBuffer: () => pending }) })
	choose([slow])
	dialog.close()
	resolve(new TextEncoder().encode("MThd0000").buffer)
	await Promise.resolve()
	await Promise.resolve()
	expect(load.disabled).toBe(true)
	expect(dialog.querySelector('[role="status"]')?.textContent).toBe("No files selected.")
	expect(receive).not.toHaveBeenCalled()
})