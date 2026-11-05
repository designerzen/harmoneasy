import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { build, preview } from "vite"
import { opendawFilesPlugin } from "audiobus/instruments/openDAW/opendaw-files.js"
import { supersonicFilesPlugin } from "audiobus/io/outputs/supersonic-files.js"
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(
	new URL("../../../packages/control-surface/package.json", import.meta.url)
)
const { chromium } = require("playwright")
let server, browser, directory
try {
	await mkdir(path.resolve(__dirname, "../node_modules/.cache"), { recursive: true })
	directory = await mkdtemp(
		path.resolve(__dirname, "../node_modules/.cache/harmoneasy-audio-smoke-")
	)
	const config = {
		configFile: false,
		plugins: [opendawFilesPlugin(), supersonicFilesPlugin()],
		root: path.resolve(__dirname, ".."),
		base: "/",
		logLevel: "error",
		build: {
			outDir: directory,
			emptyOutDir: false,
			copyPublicDir: false,
			minify: false,
			lib: {
				entry: path.resolve(__dirname, "audio-smoke-entry.ts"),
				formats: ["es"],
				fileName: () => "audio.js"
			}
		}
	}
	await build(config)
	await writeFile(path.join(directory, "index.html"), "<!doctype html><title>Audio test</title>")
	server = await preview({
		...config,
		preview: {
			port: 0,
			open: false,
			headers: {
				"Cross-Origin-Opener-Policy": "same-origin",
				"Cross-Origin-Embedder-Policy": "require-corp"
			}
		}
	})

	browser = await chromium.launch({
		headless: true,
		executablePath: process.env.SURFACE_BROWSER_EXECUTABLE,
		args: ["--autoplay-policy=no-user-gesture-required"]
	})
	const page = await browser.newPage()
	page.on("console", (message) => {
		if (message.text().startsWith("Measuring")) {
			console.log(message.text())
		}
	})
	await page.goto(`${server.resolvedUrls.local[0]}index.html`)
	const results = await page.evaluate(async (only) => {
		const smoke = await import("/audio.js")
		return {
			outputs: await smoke.measureOutputs(true, only),
			polyphony: await smoke.measurePolyphony()
		}
	}, process.env.AUDIO_ENGINE ?? "")
	console.log(JSON.stringify(results, null, 2))
	for (const output of results.outputs) {
		// Brief clicks/hits include silence in this 0.6-second window. Their
		// peak and energy matter, rather than a sustained synth's average.
		const transient = ["Metronome", "Drum kick", "Drum snare"].includes(output.name)
		assert.ok(
			output.rms > (transient ? 0.003 : 0.01),
			`${output.name} is too quiet: ${output.rms}`
		)
		assert.ok(output.peak > 0.03, `${output.name} has no audible attack`)
		assert.ok(output.peak < 1, `${output.name} clips: ${output.peak}`)
	}
	for (const output of results.polyphony) {
		assert.ok(output.peak < 0.95, `PolySynth clips with ${output.voices} voices`)
		assert.ok(output.rms > 0.05, `PolySynth is too quiet with ${output.voices} voices`)
	}
	const levels = results.outputs
		.filter((output) => !["Metronome", "Drum kick", "Drum snare"].includes(output.name))
		.map((output) => output.rms)
	assert.ok(
		Math.max(...levels) / Math.min(...levels) < 10 ** (4 / 20),
		"Built-in output levels differ by more than 4 dB"
	)
} finally {
	await browser?.close()
	if (server) {
		await new Promise((resolve) => server.httpServer.close(resolve))
	}
	if (directory) {
		await rm(directory, { recursive: true, force: true })
	}
}