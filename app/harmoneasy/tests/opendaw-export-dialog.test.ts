// @vitest-environment happy-dom
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { createOpenDAWExportDialog } from "../source/services/opendaw-export-dialog"

const markup = readFileSync(resolve("index.html"), "utf8")
let lifetime: AbortController
const code = () => document.querySelector<HTMLTextAreaElement>("#opendaw-export-code")!
const copy = () => document.querySelector<HTMLButtonElement>("#opendaw-copy-code")!
const status = () => document.querySelector("#opendaw-export-status")!

beforeEach(() => {
	lifetime = new AbortController()
	const page = new DOMParser().parseFromString(markup, "text/html")
	document.body.replaceChildren(
		page.querySelector("#export-dialog")!.cloneNode(true),
		page.querySelector("#opendaw-export-dialog")!.cloneNode(true)
	)
})
afterEach(() => {
	lifetime.abort()
	vi.restoreAllMocks()
	document.body.replaceChildren()
})

it("presents code as text and copies the exact script without closing the dialog", async () => {
	const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue()
	const show = createOpenDAWExportDialog(document, lifetime.signal)
	const script = 'const title = "<img src=x onerror=alert(1)>"'
	show(script)
	expect(code().value).toBe(script)
	expect(document.querySelector("#opendaw-export-dialog img")).toBeNull()
	copy().click()
	await vi.waitFor(() => expect(copy().textContent).toBe("Copied"))
	expect(write).toHaveBeenCalledWith(script)
	expect(document.querySelector<HTMLDialogElement>("#opendaw-export-dialog")!.open).toBe(true)
	expect(status().textContent).toContain("Paste into OpenDAW")
	show("const next = 1")
	expect(copy().textContent).toBe("Copy code")
	expect(status().textContent).toBe("")
	copy().click()
	await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2))
})

it("selects the code and explains manual copying when clipboard access fails", async () => {
	vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("Permission denied"))
	createOpenDAWExportDialog(document, lifetime.signal)("const project = openDAW.newProject()")
	copy().click()
	await vi.waitFor(() => expect(status().textContent).toContain("Ctrl+C"))
	expect(document.activeElement).toBe(code())
	expect(code().selectionStart).toBe(0)
	expect(code().selectionEnd).toBe(code().value.length)
	expect(copy().disabled).toBe(false)
})