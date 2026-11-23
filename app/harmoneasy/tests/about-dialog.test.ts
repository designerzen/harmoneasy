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
	const buildVersion = __APP_VERSION__
	expect(buildVersion).toMatch(/^\d+\.\d+\.\d+\+\d+$/)
	expect(document.querySelector("#about-version")!.textContent).toBe(`Version ${buildVersion}`)
	expect(document.querySelector("[data-app-version]")).toBeNull()
	for (const logo of document.querySelectorAll<HTMLElement>("[data-about]")) {
		expect(logo.title).toBe(`Harmoneasy v${buildVersion}`)
		expect(logo.textContent).not.toContain(buildVersion)
	}
	const brandLinks = [
		document.querySelector<HTMLAnchorElement>("#start-dialog a.brand-attribution"),
		document.querySelector<HTMLAnchorElement>("#about-dialog > footer a.brand-attribution")
	]
	for (const link of brandLinks) {
		expect(link).not.toBeNull()
		expect(link!.href).toBe("https://awesmth.com/")
		expect(link!.target).toBe("_blank")
		expect(link!.rel).toBe("noopener noreferrer")
		expect(link!.querySelector("img")?.getAttribute("src")).toContain(
			"awesomething-logo-blue.svg"
		)
	}
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
