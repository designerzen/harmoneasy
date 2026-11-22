import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdtemp, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "vite"

const app = fileURLToPath(new URL("../", import.meta.url))
const { chromium } = createRequire(
	new URL("../../../packages/control-surface/package.json", import.meta.url)
)("playwright")
const output = await mkdtemp(join(tmpdir(), "harmoneasy-harmoniser-layout-"))
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
			entry: resolve(app, "tests/harmoniser-layout-entry.ts"),
			name: "HarmoniserLayout",
			formats: ["iife"],
			fileName: () => "layout.js"
		}
	}
})
const css = (await readdir(output)).find((name) => name.endsWith(".css"))
const html = join(output, "index.html")
await writeFile(
	html,
	`<!doctype html><html lang="en"><meta charset="utf-8"><title>Harmoniser layout test</title><link rel="stylesheet" href="${css}"><script defer src="layout.js"></script></html>`
)
const browser = await chromium.launch({
	headless: true,
	executablePath: process.env.SURFACE_BROWSER_EXECUTABLE
})
try {
	const page = await browser.newPage({
		viewport: { width: 1280, height: 900 },
		colorScheme: "dark"
	})
	const errors = []
	page.on("pageerror", (error) => errors.push(error.message))
	await page.goto(pathToFileURL(html).href)
	await page.waitForFunction(() => window.harmoniserLayout)
	await page.evaluate(() => document.fonts.ready)
	const sizes = []
	for (const width of [1200, 576, 320]) {
		await page.evaluate((width) => {
			window.harmoniserLayout.node.style.width = `${width}px`
		}, width)
		await page.waitForFunction(() => {
			const tiles = [...document.querySelectorAll(".cs-choice-grid > label")]
			return tiles.length === 12 && tiles.every((tile) => !tile.hidden)
		})
		// Let ResizeObserver apply the width-dependent wrapping before measuring.
		await page.evaluate(
			() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
		)
		const geometry = await page.locator(".harmoniser-controls").evaluate((gui) => {
			const summary = gui.querySelector(".harmoniser-summary").getBoundingClientRect()
			const key = gui.querySelector('[data-control-id="root"]').getBoundingClientRect()
			const scale = gui.querySelector('[data-control-id="mode"]').getBoundingClientRect()
			const direction = gui
				.querySelector('[data-control-id="direction"]')
				.getBoundingClientRect()
			const tiles = [...gui.querySelectorAll(".cs-choice-grid > label")].map((tile) =>
				tile.getBoundingClientRect()
			)
			return {
				width: gui.clientWidth,
				height: gui.getBoundingClientRect().height,
				summaryWidth: summary.width,
				keyWidth: key.width,
				rows: new Set(tiles.map((tile) => Math.round(tile.top))).size,
				minTarget: Math.min(...tiles.map((tile) => tile.height)),
				maxTarget: Math.max(...tiles.map((tile) => tile.height)),
				pager: !gui.querySelector(".cs-choice-navigation").hidden,
				paired: Math.abs(scale.top - direction.top) < 1,
				overflow: gui.scrollWidth > gui.clientWidth,
				summaryGap: key.top - summary.bottom
			}
		})
		assert.equal(geometry.pager, false)
		assert.equal(geometry.overflow, false)
		assert.ok(Math.abs(geometry.summaryWidth - geometry.width) < 2)
		assert.ok(Math.abs(geometry.keyWidth - geometry.width) < 2)
		assert.ok(geometry.minTarget >= 43)
		assert.ok(
			geometry.maxTarget <= 46,
			`Choice tiles must stay compact rather than stretch vertically: ${JSON.stringify(geometry)}`
		)
		assert.ok(geometry.summaryGap <= 16, "Summary must not leave a large blank row")
		assert.equal(geometry.paired, width >= 576)
		sizes.push({ width, ...geometry })
	}
	const lastKey = page.getByRole("radio", { name: "B", exact: true })
	await lastKey.click()
	await page.waitForFunction(() => window.harmoniserLayout.effect.config.root === 11)
	await lastKey.press("Home")
	await page.waitForFunction(() => window.harmoniserLayout.effect.config.root === 0)
	assert.deepEqual(errors, [])
	await page.screenshot({ path: join(output, "harmoniser-narrow.png"), fullPage: true })
	await page.evaluate(() => {
		window.harmoniserLayout.node.style.width = "576px"
	})
	await page.evaluate(
		() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
	)
	await page.screenshot({ path: join(output, "harmoniser-wide.png"), fullPage: true })
	console.log(JSON.stringify({ passed: true, sizes, output }))
} finally {
	await browser.close()
}