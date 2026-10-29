// Run with: pnpm exec electron tests/electron-audio-smoke.cjs
const { app, BrowserWindow } = require("electron")
const { mkdtemp, writeFile } = require("node:fs/promises")
const { tmpdir } = require("node:os")
const path = require("node:path")
const assert = require("node:assert/strict")

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required")
let window
app.whenReady()
	.then(async () => {
		const { build } = await import("vite")
		const directory = await mkdtemp(path.join(tmpdir(), "harmoneasy-audio-smoke-"))
		await build({
			configFile: false,
			root: path.resolve(__dirname, ".."),
			logLevel: "error",
			build: {
				outDir: directory,
				emptyOutDir: false,
				minify: false,
				lib: {
					entry: path.resolve(__dirname, "audio-smoke-entry.ts"),
					name: "AudioSmoke",
					formats: ["iife"],
					fileName: () => "audio.js"
				}
			}
		})
		await writeFile(
			path.join(directory, "index.html"),
			'<!doctype html><title>Audio smoke test</title><script src="audio.js"></script>'
		)
		window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
		window.webContents.setAudioMuted(true)
		await window.loadFile(path.join(directory, "index.html"))
		const results = await Promise.race([
			window.webContents.executeJavaScript(
				"(async () => ({ outputs: await AudioSmoke.measureOutputs(), polyphony: await AudioSmoke.measurePolyphony() }))()"
			),
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error("Audio smoke test timed out")), 60000)
			)
		])
		console.log(JSON.stringify(results, null, 2))
		for (const output of results.outputs) {
			// Brief clicks/hits include silence in this half-second window. Their
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
			Math.max(...levels) / Math.min(...levels) < 4,
			"Built-in output levels differ by more than 12 dB"
		)
		window.destroy()
		app.exit(0)
	})
	.catch((error) => {
		console.error(error)
		window?.destroy()
		app.exit(1)
	})