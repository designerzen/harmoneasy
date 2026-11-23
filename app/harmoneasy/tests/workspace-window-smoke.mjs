import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { createServer } from "vite"

const require = createRequire(
	new URL("../../../packages/control-surface/package.json", import.meta.url)
)
const { chromium } = require("playwright")
let server, browser
try {
	server = await createServer({
		configFile: "vite.config.web.js",
		logLevel: "error",
		server: { port: 0, open: false },
		plugins: [
			{
				name: "workspace-window-smoke",
				configureServer(vite) {
					vite.middlewares.use((request, response, next) => {
						if (request.url !== "/workspace-window-smoke.html") {
							return next()
						}
						response.setHeader("Content-Type", "text/html")
						response.setHeader("Cross-Origin-Opener-Policy", "same-origin")
						response.setHeader("Cross-Origin-Embedder-Policy", "require-corp")
						response.end(
							'<!doctype html><title>Window smoke test</title><nav id="chain-navigation"></nav><div id="graph"></div><section id="recordings"><canvas id="smoke-timeline"></canvas></section><script type="module" src="/tests/workspace-window-smoke-entry.ts"></script>'
						)
					})
				}
			}
		]
	})
	await server.listen()
	browser = await chromium.launch({
		headless: true,
		executablePath: process.env.SURFACE_BROWSER_EXECUTABLE
	})
	const context = await browser.newContext()
	const errors = []
	context.on("page", (page) =>
		page.on("pageerror", (error) => {
			errors.push(error.message)
			if (error.message !== "ResizeObserver loop completed with undelivered notifications.") {
				console.error("Browser error:", error.message)
			}
		})
	)
	const page = await context.newPage()
	await page.goto(`${server.resolvedUrls.local[0]}workspace-window-smoke.html`)
	await page.locator("#chain-tab-one").waitFor()
	const [lead] = await Promise.all([
		page.waitForEvent("popup"),
		page.getByRole("button", { name: "Open Lead in window", exact: true }).click()
	])
	await lead.locator("#iochain-one .react-flow").waitFor()
	assert.equal(await lead.locator(".chain-panel").count(), 1)
	assert.equal(await page.locator("#iochain-one").isVisible(), false)
	assert.equal(await page.locator("#iochain-two").isVisible(), true)
	await lead.locator(".chain-name").fill("Lead on screen two")
	await lead.locator(".chain-name").press("Enter")
	await page.getByRole("tab", { name: "Lead on screen two", exact: true }).waitFor()
	assert.equal(await lead.title(), "Lead on screen two · Harmoneasy")
	await lead.locator(".chain-power").click()
	assert.equal(
		await page.evaluate(() => window.windowSmoke.manager.entries[0][1].isActive),
		false
	)
	await lead.locator('.chain-actions [aria-haspopup="menu"]').click()
	await lead.getByRole("menuitem", { name: "Save as a preset" }).click()
	await lead.locator("dialog.save-preset-dialog[open]").waitFor()
	assert.equal(await page.locator("dialog[open]").count(), 0)
	await lead.getByRole("button", { name: "Cancel", exact: true }).click()
	const transformerCount = await page.evaluate(
		() => window.windowSmoke.manager.entries[0][1].transformers.length
	)
	await lead.locator(".node-add-transformer button").click()
	await lead.locator(".add-transformer-dialog[open]").waitFor()
	await lead.locator(".add-transformer-dialog .transformer-choice").first().click()
	await lead.locator(".node-transformer").first().waitFor()
	assert.equal(
		await page.evaluate(() => window.windowSmoke.manager.entries[0][1].transformers.length),
		transformerCount + 1
	)
	const [drums] = await Promise.all([
		page.waitForEvent("popup"),
		page.getByRole("button", { name: "Open Drums in window", exact: true }).click()
	])
	await drums.locator("#iochain-two .react-flow").waitFor()
	assert.equal(await context.pages().length, 3)
	assert.equal(
		await page.evaluate(
			() => window.windowSmoke.manager.triggerHandler === window.windowSmoke.originalTrigger
		),
		true
	)
	await lead.getByRole("button", { name: "Return to workspace", exact: true }).click()
	await page.locator("#iochain-one").waitFor({ state: "visible" })
	assert.equal(
		await page.locator(".chain-name").first().getAttribute("placeholder"),
		"Lead on screen two"
	)
	await drums.close()
	await page.locator("#iochain-two").waitFor({ state: "visible" })
	assert.equal(
		await page.evaluate(
			() => window.windowSmoke.manager.triggerHandler === window.windowSmoke.originalTrigger
		),
		true
	)
	const [timeline] = await Promise.all([
		page.waitForEvent("popup"),
		page.getByRole("button", { name: "Open Note timeline in window", exact: true }).click()
	])
	await timeline.locator("#recordings #smoke-timeline").waitFor()
	await page.evaluate(() => {
		window.windowSmoke.timeline.noteOn(60, 100)
		window.windowSmoke.timeline.noteOff(60)
	})
	await timeline.close()
	await page.locator(".chains-workspace #recordings").waitFor({ state: "visible" })
	assert.deepEqual(
		errors.filter(
			(message) => message !== "ResizeObserver loop completed with undelivered notifications."
		),
		[]
	)
	const [last] = await Promise.all([
		page.waitForEvent("popup"),
		page.getByRole("button", { name: "Open Drums in window", exact: true }).click()
	])
	await last.locator("#iochain-two .react-flow").waitFor()
	const closed = last.waitForEvent("close")
	await page.evaluate(() => {
		window.windowSmoke.workspace.destroy()
		window.windowSmoke.timeline.destroy()
	})
	await closed
	console.log(
		"Multiwindow smoke passed: shared edits, local dialogs, simultaneous windows, return, close, and timeline."
	)
} finally {
	await browser?.close()
	await server?.close()
}