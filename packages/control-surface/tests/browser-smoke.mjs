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
	assert.equal(await page.locator(".cs-widget").count(), 14)
	await page.evaluate(async () => {
		const { surface } = window.surfaceSmoke
		const renderer = surface.renderer
		const visuals = surface.entries.map((entry) => entry.visual)
		renderer.prepare(visuals, true)
		const queue = renderer.device.queue
		const original = queue.writeBuffer.bind(queue)
		let uploads = 0
		queue.writeBuffer = (...args) => {
			uploads++
			return original(...args)
		}
		try {
			renderer.prepare(visuals, true)
			if (uploads !== 0) {
				throw new Error("Idle widgets must reuse their GPU geometry")
			}
			const dial = visuals[0],
				previous = dial.value
			dial.value = dial.descriptor.max
			renderer.prepare(visuals, true)
			const data = renderer.instances
			let found = false
			for (let offset = 0; offset < data.length; offset += 20) {
				if (data[offset + 4] === 1) {
					if (data[offset + 5] !== 1) {
						throw new Error("Dial must reach its target in the first frame")
					}
					found = true
					break
				}
			}
			if (!found || uploads !== 1) {
				throw new Error("Changed widget must upload its new geometry once")
			}
			dial.value = previous
		} finally {
			queue.writeBuffer = original
		}
		// An in-flight engine read must never overwrite a newer pointer write.
		const entry = surface.entries[0],
			originalRead = entry.binding.read
		let complete
		entry.binding.read = () =>
			new Promise((resolve) => {
				complete = resolve
			})
		entry.dirty = true
		surface.updateFeedback()
		surface.pointerDown(77, 90, 90)
		surface.pointerMove(77, 90, 55)
		const requested = entry.visual.value
		complete(60)
		await Promise.resolve()
		if (entry.visual.value !== requested) {
			throw new Error("Stale read overwrote live input")
		}
		surface.pointerUp(77)
		entry.binding.read = originalRead
	})
	await page.evaluate(async () => {
		const { surface } = window.surfaceSmoke,
			entry = surface.entries[0],
			renderer = surface.renderer
		const original = entry.binding.write
		let writes = 0
		entry.binding.write = (value) => {
			writes++
			const normalized = Math.log(value / 60) / Math.log(5000 / 60)
			const data = renderer.instances
			for (let offset = 0; offset < data.length; offset += 20) {
				if (data[offset + 4] === 1) {
					if (Math.abs(data[offset + 5] - normalized) > 0.0001) {
						throw new Error(
							"Engine work ran before the latest dial position was submitted"
						)
					}
					break
				}
			}
			return original(value)
		}
		surface.pointerDown(78, 90, 100)
		for (let i = 0; i < 100; i++) {
			surface.pointerMove(78, 90, 100 - i / 2)
		}
		if (writes !== 0) {
			throw new Error("Pointer bursts must not invoke the engine per event")
		}
		await new Promise(requestAnimationFrame)
		if (writes !== 1) {
			throw new Error("Pointer burst must commit its latest value once per frame")
		}
		surface.pointerUp(78)
		entry.binding.write = original
		const visuals = surface.entries.map((item) => item.visual),
			width = surface.stage.clientWidth,
			height = surface.height
		renderer.prepare(visuals, false)
		renderer.render(width, height, 0, false)
		const queue = renderer.device.queue,
			submit = queue.submit.bind(queue)
		let submissions = 0
		queue.submit = (...args) => {
			submissions++
			return submit(...args)
		}
		try {
			renderer.render(width, height, 1, false)
			if (submissions !== 0) {
				throw new Error("An idle surface must not continually submit GPU frames")
			}
		} finally {
			queue.submit = submit
		}
	})
	const canvas = page.locator("canvas"),
		rect = await canvas.boundingBox()
	// Start in the panel's title area, well outside the drawn dial.
	const beforePanelDrag = await page.evaluate(() => window.surfaceSmoke.values.cutoff)
	await page.mouse.move(rect.x + 3, rect.y + 14)
	await page.mouse.down()
	await page.mouse.move(rect.x + 3, rect.y + 49)
	await page.mouse.up()
	await page.waitForFunction((previous) => window.surfaceSmoke.values.cutoff < previous, beforePanelDrag)
	await page.getByRole("spinbutton", { name: "Tempo" }).fill("140")
	await page.getByRole("spinbutton", { name: "Tempo" }).press("Tab")
	await page.waitForFunction(() => window.surfaceSmoke.values.number === 140)
	await page.getByRole("combobox", { name: "Preset", exact: true }).selectOption("1")
	await page.waitForFunction(() => window.surfaceSmoke.values.preset === 1)
	const padWidget = page.locator(".cs-widget").last()
	await padWidget.scrollIntoViewIfNeeded()
	const padRect = await padWidget.boundingBox(),
		cdp = await page.context().newCDPSession(page)
	const point = { x: padRect.x + padRect.width / 2, y: padRect.y + 90, id: 1, force: 0.25 }
	await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] })
	await page.waitForFunction(() => window.surfaceSmoke.values.strike === 0.25)
	await cdp.send("Input.dispatchTouchEvent", {
		type: "touchMove",
		touchPoints: [{ ...point, x: point.x + 24, force: 0.75 }]
	})
	await page.waitForFunction(() => window.surfaceSmoke.values.strike === 0.75)
	await page.evaluate(() => {
		const { surface } = window.surfaceSmoke
		surface.renderer.prepare(
			surface.entries.map((entry) => entry.visual),
			true
		)
		const data = surface.renderer.instances
		for (let offset = 0; offset < data.length; offset += 20) {
			if (data[offset + 4] === 10) {
				if (data[offset + 5] !== 0.75 || data[offset + 7] !== 1) {
					throw new Error("Pad light must follow pressure in the first frame")
				}
				return
			}
		}
		throw new Error("Pad GPU geometry is missing")
	})
	await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
	await page.waitForFunction(() => window.surfaceSmoke.values.strike === 0)
	await cdp.detach()
	await page.locator(".cs-pad button").focus()
	assert.equal(await page.getByRole("button", { name: "Velocity pad", exact: true }).count(), 1)
	await page.keyboard.down("Space")
	await page.waitForFunction(() => window.surfaceSmoke.values.strike === 1)
	await page.keyboard.up("Space")
	await page.waitForFunction(() => window.surfaceSmoke.values.strike === 0)
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
			widgets: 14,
			pressurePad: true,
			shaderEffects: true,
			pointerAndKeyboard: true,
			screenshot: image
		})
	)
} finally {
	await browser.close()
}
