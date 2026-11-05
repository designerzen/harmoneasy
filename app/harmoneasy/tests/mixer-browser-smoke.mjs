import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "vite"

const app = fileURLToPath(new URL("../", import.meta.url))
const require = createRequire(
	new URL("../../../packages/control-surface/package.json", import.meta.url)
)
const { chromium } = require("playwright")
const cache = resolve(app, "node_modules/.cache")
await mkdir(cache, { recursive: true })
const output = await mkdtemp(join(cache, "mixer-smoke-"))
let browser
try {
	const entry = join(output, "entry.ts")
	await writeFile(
		entry,
		`
import { createMixer } from ${JSON.stringify(resolve(app, "source/services/mixer.ts"))}
import ${JSON.stringify(resolve(app, "source/assets/style/mixer.scss"))}
const context = new AudioContext()
let created = 0, disconnected = 0
const createAnalyser = context.createAnalyser.bind(context)
context.createAnalyser = () => {
 const node = createAnalyser(); created++
 const disconnect = node.disconnect.bind(node)
 node.disconnect = () => { disconnected++; disconnect() }
 return node
}
const master = context.createGain(); master.gain.value = .5; master.connect(context.destination)
const piano = context.createGain(); piano.gain.value = .5; piano.connect(master)
const oscillator = context.createOscillator(); oscillator.connect(piano); oscillator.start()
const device = { name: "Piano", output: piano, hasAudioOutput: () => true }
const manager = Object.assign(new EventTarget(), { devices: [{device, direction: "output"}] })
document.querySelector("#volume").addEventListener("input", event => master.gain.value = Number(event.target.value) / 100)
const dispose = createMixer(manager, master)
window.mixerTest = { context, piano, dispose, stats: () => ({created, disconnected}) }
`
	)
	await build({
		configFile: false,
		root: app,
		logLevel: "error",
		build: {
			outDir: output,
			emptyOutDir: false,
			copyPublicDir: false,
			lib: { entry, formats: ["iife"], name: "MixerSmoke", fileName: () => "mixer.js" }
		}
	})
	const css = (await readdir(output)).find((name) => name.endsWith(".css"))
	const html = join(output, "index.html")
	await writeFile(
		html,
		`<!doctype html><html><meta charset="utf-8"><title>Mixer test</title><link rel="stylesheet" href="${css}"><button id="btn-mixer" disabled>Mixer</button><button id="keyboard">Play keyboard</button><input id="volume" type="range" min="0" max="100" step="any" value="50"><script src="mixer.js"></script></html>`
	)
	browser = await chromium.launch({
		headless: true,
		executablePath: process.env.SURFACE_BROWSER_EXECUTABLE,
		args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"]
	})
	const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
	const errors = []
	page.on("pageerror", (error) => errors.push(error.message))
	await page.goto(pathToFileURL(html).href)
	assert.deepEqual(await page.evaluate(() => window.mixerTest.stats()), {
		created: 0,
		disconnected: 0
	})
	await page.getByRole("button", { name: "Mixer", exact: true }).click()
	await page.waitForFunction(
		() => document.querySelector(".mixer-meter")?.getAttribute("aria-valuenow") !== "-60"
	)
	assert.equal(await page.locator(".mixer-channel").count(), 2)
	const fader = page.getByRole("slider", { name: "Piano volume", exact: true })
	const geometry = await fader.evaluate((input) => {
		const a = input.getBoundingClientRect(),
			b = input.nextElementSibling.getBoundingClientRect()
		return {
			fader: { right: a.right, height: a.height },
			meter: { left: b.left, height: b.height }
		}
	})
	assert.ok(geometry.meter.left > geometry.fader.right, "Meter must be to the right of its fader")
	assert.ok(
		geometry.fader.height > 180 && Math.abs(geometry.fader.height - geometry.meter.height) < 4
	)
	await fader.focus()
	await fader.press("ArrowDown")
	const before = Number(await fader.inputValue())
	await fader.focus()
	await fader.press("ArrowUp")
	assert.ok(Number(await fader.inputValue()) > before, "Up should raise the vertical fader")
	await page.getByRole("button", { name: "Play keyboard" }).click()
	assert.ok(
		await page
			.getByRole("button", { name: "Play keyboard" })
			.evaluate((node) => node === document.activeElement),
		"Mixer must allow interaction with the underlying app"
	)
	await page.keyboard.press("Escape")
	await page.waitForFunction(() => !document.querySelector("#mixer-dialog").open)
	const stopped = await page.evaluate(() => window.mixerTest.stats())
	assert.equal(stopped.created, stopped.disconnected)
	await page.getByRole("button", { name: "Mixer", exact: true }).click()
	await page.waitForFunction(
		() => window.mixerTest.stats().created > window.mixerTest.stats().disconnected
	)
	await page.getByRole("button", { name: "Close Mixer" }).click()
	assert.deepEqual(
		await page.evaluate(() => {
			const stats = window.mixerTest.stats()
			return {
				active: stats.created - stats.disconnected,
				outputConnected: window.mixerTest.piano.numberOfOutputs
			}
		}),
		{ active: 0, outputConnected: 1 }
	)
	const audible = await page.evaluate(async () => {
		const { context, piano } = window.mixerTest
		const probe = context.createAnalyser()
		piano.connect(probe)
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
		const samples = new Float32Array(probe.fftSize)
		probe.getFloatTimeDomainData(samples)
		piano.disconnect(probe)
		probe.disconnect()
		return samples.some((value) => Math.abs(value) > 0.01)
	})
	assert.ok(audible, "Closing the Mixer must leave audio playing")
	assert.deepEqual(errors, [])
	console.log(
		"Mixer browser checks passed: live audio, stereo meters, fader layout and keyboard, modeless access, Escape, reopen, and tap cleanup."
	)
} finally {
	await browser?.close()
	await rm(output, { recursive: true, force: true })
}