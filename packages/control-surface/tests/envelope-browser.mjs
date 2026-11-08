import { createRequire } from "node:module"
import { chromium } from "playwright"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import assert from "node:assert/strict"

const root = fileURLToPath(new URL("../", import.meta.url))
const { build } = await import(
	pathToFileURL(
		createRequire(new URL("../../../app/harmoneasy/package.json", import.meta.url)).resolve(
			"vite"
		)
	).href
)
const output = await mkdtemp(join(tmpdir(), "harmoneasy-envelope-"))
await build({
	root,
	configFile: false,
	logLevel: "error",
	build: {
		outDir: output,
		emptyOutDir: false,
		lib: {
			entry: resolve(root, "tests/browser-entry.ts"),
			name: "SurfaceSmoke",
			formats: ["iife"],
			fileName: () => "surface.js"
		}
	}
})
const html = join(output, "index.html")
await writeFile(
	html,
	'<!doctype html><html lang="en"><meta charset="utf-8"><link rel="stylesheet" href="control-surface.css"><script defer src="surface.js"></script></html>'
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
	const page = await browser.newPage({ viewport: { width: 900, height: 600 } })
	const errors = []
	page.on("pageerror", (error) => errors.push(error.message))
	await page.goto(pathToFileURL(html).href)
	await page.waitForFunction(() => window.surfaceSmoke)
	await page.evaluate(() => {
		const { ControlSurface, surface } = window.surfaceSmoke
		surface.destroy()
		const values = [0.1, 0.4, 0.65, 0.6]
		window.envelopeValue = values
		window.envelopeSurface = new ControlSurface({
			state: {
				id: "envelope",
				name: "Envelope",
				connections: [],
				widgets: [{ key: "envelope", span: 2 }],
				theme: "neon"
			},
			bindings: [
				{
					key: "envelope",
					sourceId: "synth",
					sourceLabel: "Synth",
					descriptor: { id: "envelope", label: "Amplitude envelope", widget: "envelope" },
					read: () => window.envelopeValue,
					write: (value) => {
						window.envelopeValue = value
					}
				}
			],
			change() {},
			fitHeight: false
		})
		document.body.replaceChildren(window.envelopeSurface.element)
	})
	await page.waitForSelector(".cs-gpu-ready", { timeout: 20000 })
	const start = await page.evaluate(() => {
		const surface = window.envelopeSurface,
			v = surface.entries[0].visual
		const rect = surface.stage.getBoundingClientRect()
		const x = 22 + ((40 + 106 * Math.sqrt(0.1 / 4)) / 512) * (v.width - 44)
		return {
			x: rect.left + ((v.x + x) * rect.width) / surface.stageWidth,
			y: rect.top + ((v.y + 48) * rect.height) / surface.height
		}
	})
	await page.mouse.move(start.x, start.y)
	await page.mouse.down()
	await page.mouse.move(start.x + 35, start.y, { steps: 6 })
	await page.mouse.up()
	await page.waitForFunction(() => window.envelopeValue[0] > 0.1)
	const knob = await page.evaluate(() => {
		const surface = window.envelopeSurface,
			v = surface.entries[0].visual
		const rect = surface.stage.getBoundingClientRect()
		return {
			x:
				rect.left +
				((v.x + 12 + ((v.width - 24) / 4) * 1.5) * rect.width) / surface.stageWidth,
			y: rect.top + ((v.y + v.height - 74) * rect.height) / surface.height
		}
	})
	await page.mouse.move(knob.x, knob.y)
	await page.mouse.down()
	await page.mouse.move(knob.x, knob.y - 20, { steps: 4 })
	await page.mouse.up()
	await page.waitForFunction(() => window.envelopeValue[1] > 0.4)
	const sustain = page.getByRole("spinbutton", {
		name: "Amplitude envelope Sustain",
		exact: true
	})
	await sustain.fill("35")
	await page.waitForFunction(() => window.envelopeValue[2] === 0.35)
	if (process.env.SURFACE_TEST_SCREENSHOT) {
		await page.screenshot({ path: process.env.SURFACE_TEST_SCREENSHOT })
	}
	await page.evaluate(() => window.envelopeSurface.destroy())
	assert.deepEqual(errors, [], "The WebGPU envelope must render and edit without errors")
	assert.equal(await page.locator(".control-surface").count(), 0)
	console.log("WebGPU envelope rendering, pointer editing, numeric editing and disposal passed")
} finally {
	await browser.close()
}