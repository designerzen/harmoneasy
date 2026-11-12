import { createRequire } from "node:module"
import { mkdtemp, writeFile, readFile, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve, relative } from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { build } from "vite"

const app = fileURLToPath(new URL("../", import.meta.url)),
	output = await mkdtemp(join(tmpdir(), "harmoneasy-surface-profile-"))
const { chromium } = createRequire(
	new URL("../../../packages/control-surface/package.json", import.meta.url)
)("playwright")
await build({
	root: app,
	plugins: process.env.SURFACE_PROFILE_REVISION
		? [
				{
					name: "profile-revision",
					enforce: "pre",
					transform(code, id) {
						const repository = resolve(app, "../..")
						const path = relative(repository, id.split("?")[0]).replaceAll("\\", "/")
						if (
							[
								"packages/control-surface/src/surface.ts",
								"packages/control-surface/src/renderer.ts",
								"packages/audiobus/io/component-ui.ts"
							].includes(path)
						) {
							return {
								code: execFileSync(
									"git",
									["show", `${process.env.SURFACE_PROFILE_REVISION}:${path}`],
									{ cwd: repository, encoding: "utf8" }
								),
								map: null
							}
						}
					}
				}
			]
		: [],
	configFile: false,
	logLevel: "error",
	build: {
		outDir: output,
		emptyOutDir: false,
		copyPublicDir: false,
		minify: false,
		lib: {
			entry: resolve(app, "tests/control-surface-profile-entry.ts"),
			name: "ProfileSurface",
			formats: ["iife"],
			fileName: () => "profile.js"
		}
	}
})
const css = (await readdir(output)).find((name) => name.endsWith(".css"))
const html = join(output, "index.html")
await writeFile(
	html,
	`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="${css}"><script defer src="profile.js"></script>`
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
		const result =
			widget === "polysynth"
				? await page.evaluate(
						async ({ zoom, iterations, mode }) =>
							window.profilePolySynth(zoom, iterations, mode),
						{
							zoom: Number(process.env.SURFACE_PROFILE_ZOOM ?? 1),
							iterations: Number(process.env.SURFACE_PROFILE_FRAMES ?? 300),
							mode: process.env.SURFACE_PROFILE_DIAL_MODE ?? "level"
						}
					)
				: await page.evaluate(
						async ({
							widget,
							count,
							animateAll,
							iterations,
							eventsPerFrame,
							bindingCostMs
						}) =>
							window.profileSurface(
								widget,
								count,
								animateAll,
								iterations,
								eventsPerFrame,
								bindingCostMs
							),
						{
							widget,
							count: Number(process.env.SURFACE_PROFILE_COUNT ?? 1),
							animateAll: process.env.SURFACE_PROFILE_ANIMATE_ALL === "1",
							iterations: Number(process.env.SURFACE_PROFILE_FRAMES ?? 180),
							eventsPerFrame: Number(
								process.env.SURFACE_PROFILE_EVENTS_PER_FRAME ?? 1
							),
							bindingCostMs: Number(process.env.SURFACE_PROFILE_BINDING_COST_MS ?? 0)
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