import { createRequire } from "node:module"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import assert from "node:assert/strict"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const requireApp = createRequire(new URL("../package.json", import.meta.url))
const requireSurface = createRequire(
	new URL("../../../packages/control-surface/package.json", import.meta.url)
)
const { chromium } = requireSurface("playwright")
const { build } = await import(pathToFileURL(requireApp.resolve("vite")).href)
const output = await mkdtemp(join(tmpdir(), "harmoneasy-song-tree-"))
const entry = join(output, "entry.ts")
await writeFile(
	entry,
	`
import OutputSongTree from ${JSON.stringify(resolve(root, "packages/audiobus/io/outputs/output-song-tree.ts").replaceAll("\\", "/"))};
import { createTreeRenderer } from ${JSON.stringify(resolve(root, "packages/audiobus/io/outputs/tree-renderer.ts").replaceAll("\\", "/"))};
let time = 0;
window.songTree = new OutputSongTree({ now: () => time });
window.treeReady = (async () => {
 document.body.append(await window.songTree.createGui());
 window.advanceTree = (value) => { time = value; window.songTree.draw(time); };
 window.testBackend = async (skip) => {
  const { canvas, renderer } = await createTreeRenderer(() => document.createElement('canvas'), skip);
  canvas.width = 480; canvas.height = 420; document.body.append(canvas);
  const data = new Float32Array(24);
  data.set([100,100,300,200,8,0.2,0.9,0.4,0,0,0,0]);
  data.set([250,180,275,155,10,0.9,0.3,0.4,1,0,0,0],12);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  renderer.draw(data,1,480,420);
  renderer.draw(data.subarray(12),1,480,420,true);
  const copy = document.createElement('canvas'); copy.width=480; copy.height=420;
  const ctx = copy.getContext('2d'); ctx.drawImage(canvas,0,0);
  const pixel = Array.from(ctx.getImageData(200,150,1,1).data);
  const backend = renderer.backend; renderer.destroy(); canvas.remove();
  return { backend, pixel };
 };
})();
`
)
await build({
	root,
	configFile: false,
	logLevel: "error",
	build: {
		outDir: output,
		emptyOutDir: false,
		minify: false,
		lib: { entry, name: "SongTreeSmoke", formats: ["iife"], fileName: () => "tree.js" }
	}
})
const html = join(output, "index.html")
await writeFile(
	html,
	'<!doctype html><html><meta charset="utf-8"><title>Song Tree test</title><body style="margin:0"><script src="tree.js"></script></body></html>'
)
const browser = await chromium.launch({
	headless: true,
	executablePath: process.env.SONG_TREE_BROWSER_EXECUTABLE,
	args: [
		"--enable-unsafe-webgpu",
		"--enable-unsafe-swiftshader",
		"--use-webgpu-adapter=swiftshader",
		"--ignore-gpu-blocklist"
	]
})
try {
	const page = await browser.newPage({ viewport: { width: 800, height: 700 } })
	const errors = []
	page.on("pageerror", (error) => errors.push(error.message))
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text())
		}
	})
	await page.goto(pathToFileURL(html).href)
	await page.evaluate(() => window.treeReady)
	for (const skip of [0, 1, 2]) {
		const result = await page.evaluate((skip) => window.testBackend(skip), skip)
		assert.equal(result.backend, ["WebGPU", "WebGL2", "Canvas"][skip])
		assert.ok(
			result.pixel[1] > 150,
			`${result.backend} must paint the green branch: ${result.pixel}`
		)
	}
	await page.evaluate(() => {
		window.songTree.onClockTick({ step: 0, bpm: 120, triggerAt: 0, stepDuration: 0.125 })
		window.advanceTree(0.49)
	})
	await page.evaluate(() => {
		for (const note of [64, 67, 72]) {
			window.songTree.noteOn(note, 100)
		}
		window.advanceTree(2)
		window.songTree.allNotesOff()
		for (const note of [65, 69, 72]) {
			window.songTree.noteOn(note, 75)
		}
		window.advanceTree(4)
		window.songTree.allNotesOff()
	})
	await page.screenshot({ path: join(output, "song-tree.png") })
	await page.getByRole("button", { name: "Zoom out", exact: true }).click()
	assert.ok(await page.evaluate(() => window.songTree.scale < 1))
	await page.getByRole("button", { name: "Zoom in", exact: true }).click()
	await page.evaluate(() => {
		for (let i = 1; i <= 1500; i++) {
			window.advanceTree(4 + i * 0.1)
			window.songTree.noteOn(48 + (i % 24), 40 + (i % 80))
			window.songTree.allNotesOff()
		}
	})
	await page.getByRole("button", { name: "Fit whole song", exact: true }).click()
	assert.ok(
		await page.evaluate(
			() => window.songTree.scale < 0.1 && window.songTree.model.branches.length === 1506
		)
	)
	await page.screenshot({ path: join(output, "whole-song.png") })
	await page.getByRole("button", { name: "Follow growth", exact: true }).click()
	assert.equal(await page.evaluate(() => window.songTree.scale), 1)
	await page.evaluate(async () => {
		const tree = window.songTree
		await tree.destroyGui()
		if (tree.frame !== 0 || tree.renderer) {
			throw new Error("Renderer resources survived teardown")
		}
		await tree.createGui()
		await tree.disconnect()
		if (tree.frame !== 0 || tree.model.held.size) {
			throw new Error("Disconnected tree still runs")
		}
		tree.destroy()
	})
	assert.deepEqual(errors, [])
	console.log(
		`Song Tree: WebGPU, WebGL2, Canvas, progression and cleanup passed. Screenshot: ${join(output, "song-tree.png")}`
	)
} finally {
	await browser.close()
}