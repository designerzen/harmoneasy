// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { createAboutDialog } from "../source/services/about-dialog"
import { createHelpMenu } from "../source/services/help-menu"
import { createPluginGuide } from "../source/services/plugin-guide"
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

it("opens About and the DAW plugin guide from the Help menu and from About", async () => {
	const page = new DOMParser().parseFromString(readFileSync("index.html", "utf8"), "text/html")
	page.querySelectorAll("script").forEach((script) => script.remove())
	document.body.innerHTML = page.body.innerHTML
	const dialogs = ["#about-dialog", "#plugin-dialog"].map(
		(selector) => document.querySelector<HTMLDialogElement>(selector)!
	)
	for (const dialog of dialogs) {
		vi.spyOn(dialog, "showModal").mockImplementation(() => {
			dialog.open = true
		})
		vi.spyOn(dialog, "close").mockImplementation(() => {
			dialog.open = false
		})
	}
	const [about, guide] = dialogs
	const aboutDialog = createAboutDialog(document)
	const pluginGuide = createPluginGuide(document)
	createHelpMenu(document, { openAbout: aboutDialog.open, openPluginGuide: pluginGuide.open })
	const help = document.querySelector<HTMLButtonElement>("#btn-help")!
	expect(help.previousElementSibling).toBeNull()
	expect(help.closest(".help-menu")!.previousElementSibling).toBe(
		document.querySelector("#action-bar > .backlink")
	)
	expect(help.textContent).toBe("Help")
	help.click()
	const items = [...document.querySelectorAll<HTMLButtonElement>(".help-menu [role=menuitem]")]
	expect(items.map((item) => item.textContent)).toContain("DAW plugin guide")
	items.find((item) => item.textContent === "DAW plugin guide")!.click()
	expect(guide.open).toBe(true)
	// Before a session starts there is no Harmony workspace to open.
	expect(document.querySelector<HTMLButtonElement>("#plugin-open-daw")!.disabled).toBe(true)
	expect(document.querySelector<HTMLElement>("#plugin-open-daw-hint")!.hidden).toBe(false)
	guide.open = false
	help.click()
	document.querySelectorAll<HTMLButtonElement>(".help-menu [role=menuitem]")[0].click()
	expect(about.open).toBe(true)
	await vi.waitFor(() =>
		expect(document.querySelector("#about-credits")!.textContent).not.toContain("Loading")
	)
	document.querySelector<HTMLButtonElement>("#about-dialog [data-plugin-guide]")!.click()
	expect(about.open).toBe(false)
	expect(guide.open).toBe(true)
	const open = vi.spyOn(window, "open").mockReturnValue(null)
	help.click()
	items.find((item) => item.textContent?.startsWith("Report an issue"))!.click()
	expect(open).toHaveBeenCalledWith(
		"https://github.com/designerzen/harmoneasy/issues",
		"_blank",
		"noopener,noreferrer"
	)
})