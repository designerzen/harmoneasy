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
const output = await mkdtemp(join(tmpdir(), "harmoneasy-control-surface-"))
await build({
	root,
	configFile: false,
	logLevel: "error",
	build: {
		outDir: output,
		emptyOutDir: false,
		minify: false,
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
	'<!doctype html><meta charset="utf-8"><title>Surface test</title><link rel="stylesheet" href="control-surface.css"><script defer src="surface.js"></script>'
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
	const page = await browser.newPage({ viewport: { width: 960, height: 1100 } }),
		errors = []
	page.on("pageerror", (error) => errors.push(error.message))
	await page.goto(pathToFileURL(html).href)
	await page.waitForFunction(
		() =>
			document.querySelector(".cs-gpu-ready") ||
			document.querySelector(".cs-status")?.textContent,
		{ timeout: 20000 }
	)
	assert.equal(
		await page.locator(".cs-status").textContent(),
		"",
		"GPU initialization must compile shaders and create a working render pipeline"
	)
	assert.equal(await page.locator(".cs-widget").count(), 13)
	const canvas = page.locator("canvas"),
		rect = await canvas.boundingBox()
	// Dial and slider use real pointer input; native controls remain available to keyboard input.
	await page.mouse.move(rect.x + 90, rect.y + 90)
	await page.mouse.down()
	await page.mouse.move(rect.x + 90, rect.y + 55)
	await page.mouse.up()
	await page.waitForFunction(() => window.surfaceSmoke.values.cutoff > 650)
	await page.getByRole("spinbutton", { name: "Tempo" }).fill("140")
	await page.getByRole("spinbutton", { name: "Tempo" }).press("Tab")
	await page.waitForFunction(() => window.surfaceSmoke.values.number === 140)
	await page.getByRole("combobox", { name: "Preset", exact: true }).selectOption("1")
	await page.waitForFunction(() => window.surfaceSmoke.values.preset === 1)
	await page.evaluate(async () => {
		await window.surfaceSmoke.surface.setEffect(
			"fn surfaceEffect(color:vec4f,uv:vec2f,time:f32)->vec4f{return vec4f(color.rgb*(0.95+0.05*sin(time+uv.y*10.0)),color.a);}"
		)
	})
	await page.evaluate(async () => {
		await window.surfaceSmoke.surface.setPostEffect(
			"fn postEffect(uv:vec2f,time:f32)->vec4f{let c=textureSampleLevel(surfaceTexture,surfaceSampler,uv,0.0);return vec4f(c.rgb*(0.98+sin(time)*0.02),c.a);}"
		)
	})
	await page.waitForTimeout(100)
	assert.deepEqual(errors, [])
	assert.equal(await page.locator(".cs-status").textContent(), "")
	const image = join(output, "surface.png")
	await page.screenshot({ path: image, fullPage: true })
	await page.setViewportSize({ width: 390, height: 1100 })
	await page.waitForTimeout(100)
	assert.equal(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
		true,
		"Surface must fit narrow screens"
	)
	await page.evaluate(() => window.surfaceSmoke.surface.destroy())
	assert.equal(await page.locator(".control-surface").count(), 0)
	console.log(
		JSON.stringify({
			passed: true,
			widgets: 13,
			shaderEffects: true,
			pointerAndKeyboard: true,
			screenshot: image
		})
	)
} finally {
	await browser.close()
}