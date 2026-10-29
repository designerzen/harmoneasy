// Run with: pnpm exec electron tests/electron-room-smoke.cjs
const { app, BrowserWindow } = require("electron")
const { mkdtemp, writeFile } = require("node:fs/promises")
const { tmpdir } = require("node:os")
const path = require("node:path")
const assert = require("node:assert/strict")

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required")
const windows = []
const run = (window, source) => window.webContents.executeJavaScript(source)
const waitFor = async (test, description) => {
	const deadline = Date.now() + 15000
	while (Date.now() < deadline) {
		if (await test()) {
			return
		}
		await new Promise((resolve) => setTimeout(resolve, 50))
	}
	throw new Error(`Timed out: ${description}`)
}

app.whenReady()
	.then(async () => {
		const { build } = await import("vite")
		const directory = await mkdtemp(path.join(tmpdir(), "harmoneasy-room-smoke-"))
		await build({
			configFile: false,
			root: path.resolve(__dirname, ".."),
			logLevel: "error",
			build: {
				outDir: directory,
				emptyOutDir: false,
				minify: false,
				lib: {
					entry: path.resolve(__dirname, "room-smoke-entry.ts"),
					name: "RoomSmoke",
					formats: ["iife"],
					fileName: () => "room.js"
				}
			}
		})
		await writeFile(
			path.join(directory, "index.html"),
			'<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\' blob:; script-src \'self\' blob:"><title>Room P2P smoke test</title><script src="room.js"></script>'
		)
		for (const role of ["leader", "follower", "follower"]) {
			const window = new BrowserWindow({
				show: false,
				webPreferences: { backgroundThrottling: false }
			})
			windows.push(window)
			window.webContents.on("console-message", (event) => console.error(event.message))
			window.webContents.setAudioMuted(true)
			await window.loadFile(path.join(directory, "index.html"))
			await run(
				window,
				`(async () => { window.machine = await RoomSmoke.createMachine(${JSON.stringify(role)}); return true })()`
			)
		}
		const [host, alice, bob] = windows
		for (const guest of [alice, bob]) {
			const offer = await run(host, "machine.connection.createOfferBundle()")
			await run(guest, `machine.connection.applyOfferBundle(${JSON.stringify(offer)})`)
			const answer = await run(guest, "machine.connection.createAnswerBundle()")
			await run(host, `machine.connection.applyAnswerBundle(${JSON.stringify(answer)})`)
			await waitFor(
				() => run(guest, 'machine.getState().status.startsWith("Room ready")'),
				"workspace and clock readiness"
			)
		}
		await waitFor(
			async () =>
				(
					await Promise.all(
						[alice, bob].map((window) =>
							run(window, "machine.connection.connectedPeerIds.length")
						)
					)
				).every((count) => count === 2),
			"P2P mesh readiness"
		)
		const initial = await Promise.all(
			windows.map((window) => run(window, "machine.getState()"))
		)
		assert.equal(initial[0].workspace, initial[1].workspace)
		assert.equal(initial[0].workspace, initial[2].workspace)
		await run(host, "machine.connection.startSynchronized()")
		await run(alice, "machine.play()")
		await waitFor(
			async () =>
				(
					await Promise.all(windows.map((window) => run(window, "machine.notes.length")))
				).every((count) => count === 1),
			"shared transformed note"
		)
		const played = await Promise.all(windows.map((window) => run(window, "machine.notes[0]")))
		assert.ok(played.every((note) => note.number === 72))
		const spread =
			Math.max(...played.map((note) => note.at)) - Math.min(...played.map((note) => note.at))
		assert.ok(spread < 100, `Playback spread was ${spread} ms`)
		await run(
			host,
			"machine.timer.BPM = 140; machine.timer.swing = 0.2; machine.connection.broadcastTempoUpdate()"
		)
		await waitFor(
			async () =>
				(
					await Promise.all(
						windows.map((window) => run(window, "machine.getState().bpm"))
					)
				).every((bpm) => bpm === 140),
			"shared tempo"
		)
		const final = await Promise.all(windows.map((window) => run(window, "machine.getState()")))
		assert.ok(final.every((state) => state.errors.length === 0 && state.swing === 0.2))
		const roomId = await run(host, "machine.connection.roomId")
		await run(host, "machine.destroy()")
		await waitFor(
			() =>
				run(
					alice,
					'machine.connection.role === "leader" && machine.getState().status.includes("sharing")'
				),
			"first conductor handover"
		)
		await waitFor(
			() => run(bob, 'machine.getState().status.startsWith("Room ready")'),
			"workspace and clock after handover"
		)
		const promoted = await Promise.all(
			[alice, bob].map((window) =>
				run(window, "({ ...machine.getState(), roomId: machine.connection.roomId })")
			)
		)
		assert.ok(
			promoted.every(
				(state) =>
					state.roomId === roomId &&
					state.workspace === initial[0].workspace &&
					state.bpm === 140 &&
					state.swing === 0.2
			)
		)
		await run(bob, "machine.play()")
		await waitFor(
			async () =>
				(
					await Promise.all(
						[alice, bob].map((window) => run(window, "machine.notes.length"))
					)
				).every((count) => count === 2),
			"notes after conductor departure"
		)
		await run(alice, "machine.destroy()")
		await waitFor(
			() =>
				run(
					bob,
					'machine.connection.role === "leader" && machine.getState().status.includes("conductor")'
				),
			"second conductor handover"
		)
		await run(bob, "machine.timer.BPM = 90; machine.connection.broadcastTempoUpdate()")
		await waitFor(() => run(bob, "machine.timer.BPM === 90"), "remaining conductor controls")
		console.log(
			`Room smoke test passed: 3 real WebRTC peers, shared workspace, notes and tempo, and two conductor handovers; playback spread ${spread.toFixed(1)} ms.`
		)
		await Promise.all(windows.map((window) => run(window, "machine.destroy()")))
		windows.forEach((window) => window.destroy())
		app.quit()
	})
	.catch((error) => {
		console.error(error)
		windows.forEach((window) => window.destroy())
		app.exit(1)
	})