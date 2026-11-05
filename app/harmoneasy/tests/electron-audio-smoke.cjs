// Run with: pnpm exec electron tests/electron-audio-smoke.cjs
const { app, BrowserWindow } = require("electron")
const path = require("node:path")
const { mkdir, mkdtemp, writeFile } = require("node:fs/promises")
const assert = require("node:assert/strict")

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required")
let window, server
app.whenReady()
	.then(async () => {
		const { build, preview } = await import("vite")
		await mkdir(path.resolve(__dirname, "../node_modules/.cache"), { recursive: true })
		const directory = await mkdtemp(
			path.resolve(__dirname, "../node_modules/.cache/harmoneasy-audio-smoke-")
		)
		const { opendawFilesPlugin } = await import("audiobus/instruments/openDAW/opendaw-files.js")
		const { supersonicFilesPlugin } = await import("audiobus/io/outputs/supersonic-files.js")
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
		await writeFile(
			path.join(directory, "index.html"),
			"<!doctype html><title>Audio test</title>"
		)
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
		window = new BrowserWindow({
			show: false,
			webPreferences: { backgroundThrottling: false, contextIsolation: false }
		})
		window.webContents.on("console-message", (event) => {
			if (event.message.startsWith("Measuring") || event.message.startsWith("[{")) {
				console.log(event.message)
			}
		})
		window.webContents.setAudioMuted(true)
		await window.loadURL(`${server.resolvedUrls.local[0]}index.html`)

		const results = await Promise.race([
			window.webContents.executeJavaScript(
				"(async () => { const AudioSmoke = await import('/audio.js'); return { outputs: await AudioSmoke.measureOutputs(false), polyphony: await AudioSmoke.measurePolyphony() } })()"
			),
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error("Audio smoke test timed out")), 180000)
			)
		])
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
		window.destroy()
		await new Promise((resolve) => server.httpServer.close(resolve))
		app.exit(0)
	})
	.catch(async (error) => {
		console.error(error)
		window?.destroy()
		if (server) {
			await new Promise((resolve) => server.httpServer.close(resolve))
		}
		app.exit(1)
	})