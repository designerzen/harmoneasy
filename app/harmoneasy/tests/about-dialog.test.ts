// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { createAboutDialog } from "../source/services/about-dialog"
import { version } from "../../../package.json"

afterEach(() => {
	document.body.replaceChildren()
	vi.restoreAllMocks()
})

it("opens About from either logo without starting a session and keeps credits inside the dialog", async () => {
	const page = new DOMParser().parseFromString(readFileSync("index.html", "utf8"), "text/html")
	page.querySelectorAll("script").forEach((script) => script.remove())
	document.body.innerHTML = page.body.innerHTML
	const dialog = document.querySelector<HTMLDialogElement>("#about-dialog")!
	const show = vi.spyOn(dialog, "showModal").mockImplementation(() => {
		dialog.open = true
	})
	createAboutDialog(document)
	expect(dialog.open).toBe(false)
	expect(document.querySelector("body > footer")).toBeNull()
	expect(document.querySelector("#about-version")!.textContent).toContain(version)
	const logos = document.querySelectorAll<HTMLButtonElement>("[data-about]")
	expect(logos).toHaveLength(2)
	logos[0].click()
	expect(show).toHaveBeenCalledOnce()
	expect(document.querySelector<HTMLDialogElement>("#start-dialog")!.open).toBe(true)
	await vi.waitFor(() =>
		expect(document.querySelectorAll("#about-credits li").length).toBeGreaterThan(20)
	)
	expect(document.querySelector("#about-credits")!.textContent).toContain("react")
	expect(document.querySelector("#about-credits")!.textContent).not.toContain("Loading")
	expect(document.querySelectorAll("#about-asset-credits a").length).toBeGreaterThan(0)
	dialog.open = false
	logos[1].click()
	expect(show).toHaveBeenCalledTimes(2)
})