import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdtemp, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "vite"

// Musical keys must keep working while control-surface widgets have focus.
const app = fileURLToPath(new URL("../", import.meta.url))
const { chromium } = createRequire(
	new URL("../../../packages/control-surface/package.json", import.meta.url)
)("playwright")
const output = await mkdtemp(join(tmpdir(), "harmoneasy-surface-keyboard-"))
await build({
	root: app,
	configFile: false,
	logLevel: "error",
	build: {
		outDir: output,
		emptyOutDir: false,
		copyPublicDir: false,
		minify: false,
		lib: {
			entry: resolve(app, "tests/surface-keyboard-entry.ts"),
			name: "SurfaceKeyboard",
			formats: ["iife"],
			fileName: () => "surface.js"
		}
	}
})
const css = (await readdir(output)).find((name) => name.endsWith(".css"))
const html = join(output, "index.html")
await writeFile(
	html,
	`<!doctype html><html lang="en"><meta charset="utf-8"><title>Surface keyboard test</title><link rel="stylesheet" href="${css}"><script defer src="surface.js"></script></html>`
)
const browser = await chromium.launch({
	headless: true,
	executablePath: process.env.SURFACE_BROWSER_EXECUTABLE,
	args: [
		"--enable-unsafe-webgpu",
		"--enable-unsafe-swiftshader",
		"--use-webgpu-adapter=swiftshader",
		"--ignore-gpu-blocklist"
	]
})
try {
	const page = await browser.newPage({ viewport: { width: 960, height: 10000 } }),
		errors = []
	page.on("pageerror", (error) => errors.push(error.message))
	await page.goto(pathToFileURL(html).href)
	await page.waitForFunction(
		() =>
			document.querySelector(".cs-gpu-ready") ||
			document.querySelector(".cs-status")?.textContent,
		{ timeout: 20000 }
	)
	// Exercise the real application musical-key handler with browser focus/default actions.
	await page.evaluate(() => {
		window.surfaceSmoke.commands = []
		window.surfaceSmoke.stopKeyboard = window.surfaceSmoke.addKeyboardDownEvents(
			(command, key) => window.surfaceSmoke.commands.push([command, key])
		)
	})
	let notePairs = 0
	for (const widget of await page.locator(".cs-widget").all()) {
		const control = widget.locator("input, select, button").first()
		if (!(await control.count())) {
			continue
		}
		await control.focus()
		const editing = await control.evaluate((el) =>
			el.matches("input[type=text], input[type=number]")
		)
		const before = await page.evaluate(() => window.surfaceSmoke.commands.length)
		await page.keyboard.down("q")
		await page.keyboard.up("q")
		assert.equal(
			await page.evaluate(() => window.surfaceSmoke.commands.length),
			before + (editing ? 0 : 2)
		)
		if (!editing) {
			notePairs++
		}
		await page.keyboard.press("Escape")
		assert.equal(
			await page.locator(".cs-viewport").evaluate((el) => el === document.activeElement),
			true
		)
		await page.keyboard.down("q")
		await page.keyboard.press("Escape")
		await page.keyboard.up("q")
		notePairs++
	}
	const musicalCommands = await page.evaluate(() => {
		window.surfaceSmoke.stopKeyboard()
		return window.surfaceSmoke.commands
	})
	assert.equal(
		musicalCommands.length,
		notePairs * 2,
		"Escape must not issue a transport command or lose held notes"
	)
	for (let i = 0; i < musicalCommands.length; i += 2) {
		assert.deepEqual(musicalCommands[i], ["noteOn", "q"])
		assert.deepEqual(musicalCommands[i + 1], ["noteOff", "q"])
	}
	assert.deepEqual(errors, [])
	console.log(JSON.stringify({ passed: true, notePairs }))
} finally {
	await browser.close()
}
