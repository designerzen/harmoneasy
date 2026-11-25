import { readFileSync } from "node:fs"
import { Window } from "happy-dom"
import { describe, expect, it, vi } from "vitest"
import EVENTS from "../electron/update-events.cjs"

function dialog() {
	const window = new Window()
	window.document.write(readFileSync(new URL("../electron/update.html", import.meta.url), "utf8"))
	let render
	window.updates = {
		download: vi.fn(),
		install: vi.fn(),
		later: vi.fn(),
		EVENT_CLICK: EVENTS.EVENT_CLICK,
		onState: (callback) => {
			render = callback
		}
	}
	const source = readFileSync(new URL("../electron/update-renderer.js", import.meta.url), "utf8")
	new Function("window", "document", source)(window, window.document)
	const element = (id) => window.document.getElementById(id)
	return { window, render: (state) => render(state), element }
}

describe("update dialog", () => {
	it("shows the installed and available versions and sends download consent", () => {
		const h = dialog()
		h.render({ phase: "available", currentVersion: "1.0.0", version: "1.1.0" })
		expect(h.element("message").textContent).toContain("1.1.0")
		expect(h.element("message").textContent).toContain("1.0.0")
		h.element("primary").click()
		expect(h.window.updates.download).toHaveBeenCalledOnce()
	})
	it("shows accessible progress with animation and prevents duplicate download actions", () => {
		const h = dialog()
		h.render({
			phase: "downloading",
			percent: 50,
			transferred: 1048576,
			total: 2097152,
			bytesPerSecond: 1048576
		})
		expect(h.element("progress").hidden).toBe(false)
		expect(h.element("progress").value).toBe(50)
		expect(h.element("detail").textContent).toContain("1.0 / 2.0 MB")
		expect(h.window.document.body.dataset.busy).toBe("true")
		expect(h.element("later").hidden).toBe(true)
		h.element("primary").click()
		expect(h.window.updates.download).not.toHaveBeenCalled()
	})
	it("offers restart after verification, with a save-work reminder and a defer option", () => {
		const h = dialog()
		h.render({ phase: "downloaded" })
		expect(h.element("message").textContent).toContain("Save your work")
		expect(h.element("primary").disabled).toBe(false)
		h.element("primary").click()
		h.element("later").click()
		expect(h.window.updates.install).toHaveBeenCalledOnce()
		expect(h.window.updates.later).toHaveBeenCalledOnce()
	})
	it("offers retry after failure and animates installer handoff without claiming a percentage", () => {
		const h = dialog()
		h.render({ phase: "error" })
		expect(h.element("primary").textContent).toBe("Retry download")
		h.element("primary").click()
		expect(h.window.updates.download).toHaveBeenCalledOnce()
		h.render({ phase: "installing" })
		expect(h.window.document.body.dataset.busy).toBe("true")
		expect(h.element("progress").hidden).toBe(true)
		expect(h.element("primary").disabled).toBe(true)
	})
})