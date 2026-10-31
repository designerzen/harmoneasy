import { createRequire } from "node:module"
import { chromium } from "playwright"
import { mkdtemp, writeFile, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url)),
	output = await mkdtemp(join(tmpdir(), "harmoneasy-surface-profile-"))
const { build } = await import(
	pathToFileURL(
		createRequire(new URL("../../../app/harmoneasy/package.json", import.meta.url)).resolve(
			"vite"
		)
	).href
)
await build({
	root,
	configFile: false,
	logLevel: "error",
	build: {
		outDir: output,
		emptyOutDir: false,
		minify: false,
		lib: {
			entry: resolve(root, "tests/performance-entry.ts"),
			name: "ProfileSurface",
			formats: ["iife"],
			fileName: () => "profile.js"
		}
	}
})
const html = join(output, "index.html")
await writeFile(
	html,
	'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="control-surface.css"><script defer src="profile.js"></script>'
)
const software = process.env.SURFACE_SOFTWARE_GPU === "1"
const browser = await chromium.launch({
	headless: true,
	executablePath: process.env.SURFACE_BROWSER_EXECUTABLE,
	args: [
		"--enable-unsafe-webgpu",
		"--ignore-gpu-blocklist",
		"--autoplay-policy=no-user-gesture-required",
		...(software ? ["--enable-unsafe-swiftshader", "--use-webgpu-adapter=swiftshader"] : [])
	]
})
try {
	const page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
	page.on("pageerror", (error) => console.error(error.message))
	await page.route("https://surface.test/**", async (route) => {
		const path = new URL(route.request().url()).pathname
		const name = path === "/" ? "index.html" : path.slice(1)
		await route.fulfill({
			body: await readFile(join(output, name)),
			contentType: name.endsWith(".js")
				? "application/javascript"
				: name.endsWith(".css")
					? "text/css"
					: "text/html"
		})
	})
	await page.goto("https://surface.test/")
	const adapter = await page.evaluate(async () => {
		const a = await navigator.gpu?.requestAdapter()
		if (!a) {
			return null
		}
		const { vendor, architecture, device, description, isFallbackAdapter } = a.info
		return {
			info: { vendor, architecture, device, description, isFallbackAdapter },
			features: [...a.features]
		}
	})
	console.log(JSON.stringify({ adapter, software, output }))
	const widgets = process.env.SURFACE_PROFILE_WIDGETS?.split(",") ?? [
		"dial",
		"slider",
		"toggle",
		"radio",
		"select",
		"xy",
		"range",
		"button",
		"pad",
		"number",
		"text",
		"meter",
		"display",
		"color"
	]
	const results = []
	for (const widget of widgets) {
		const result = await page.evaluate(
			async ({ widget, count, animateAll }) =>
				window.profileSurface(widget, count, animateAll),
			{
				widget,
				count: Number(process.env.SURFACE_PROFILE_COUNT ?? 1),
				animateAll: process.env.SURFACE_PROFILE_ANIMATE_ALL === "1"
			}
		)
		results.push(result)
		console.log(JSON.stringify(result))
	}
	const file = join(output, "profile.json")
	await writeFile(file, JSON.stringify({ adapter, software, results }, null, 2))
	console.log(JSON.stringify({ report: file }))
} finally {
	await browser.close()
}