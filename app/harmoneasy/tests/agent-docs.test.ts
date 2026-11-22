import { beforeAll, describe, expect, it } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { agentDocsPlugin } from "../scripts/agent-docs.js"
import { loadPresetPage } from "../source/services/preset-page"
import { readPresetFiles } from "../scripts/preset-files.js"
import { INPUT_DEFINITIONS } from "audiobus/io/input-definitions"
import { OUTPUT_DEFINITIONS } from "audiobus/io/output-definitions"
import { TRANSFORMER_DEFINITIONS } from "audiobus/io/transformer-definitions"
import { INSTRUMENTS } from "audiobus/instruments/instrument-types"
import { EFFECT_REGISTRY } from "audiobus/effects/effect-registry"
import { createServer } from "vite"

const base = "/nested/harmoneasy/"
const origin = "https://example.test"
const assets = new Map<string, string>()
let catalog: any

beforeAll(async () => {
	const plugin = agentDocsPlugin()
	plugin.configResolved({ base } as any)
	await plugin.generateBundle.call({
		emitFile(asset: { fileName: string; source: string }) {
			assets.set(asset.fileName, asset.source)
		}
	} as any)
	catalog = JSON.parse(assets.get("docs/ai/catalog.json")!)
}, 30000)

describe("published AI agent documentation", () => {
	it("serves the package directory and every README through the development routes", async () => {
		const server = await createServer({
			configFile: false,
			base,
			server: { port: 0, host: "127.0.0.1", watch: null },
			optimizeDeps: { noDiscovery: true, include: [] },
			plugins: [agentDocsPlugin()]
		})
		try {
			await server.listen()
			const address = server.httpServer!.address() as { port: number }
			const host = `http://127.0.0.1:${address.port}`
			for (const route of [
				"docs/ai/packages",
				"docs/ai/packages/",
				"docs/ai/packages/index.html"
			]) {
				const response = await fetch(`${host}${base}${route}`)
				expect(response.status, route).toBe(200)
				expect(response.headers.get("content-type")).toContain("text/html")
			}
			const response = await fetch(`${host}${base}docs/ai/packages/index.json`)
			const directory = await response.json()
			for (const pkg of directory.packages) {
				const readme = await fetch(host + pkg.readme)
				expect(readme.status, pkg.name).toBe(200)
				expect(readme.headers.get("content-type")).toContain("text/plain")
			}
		} finally {
			await server.close()
		}
	}, 30000)

	it("covers every component registry, host engine and shipped hardware profile", () => {
		for (const [kind, ids] of [
			["input", Object.keys(INPUT_DEFINITIONS)],
			["output", Object.keys(OUTPUT_DEFINITIONS)],
			["transformer", Object.keys(TRANSFORMER_DEFINITIONS)],
			["instrument", [...INSTRUMENTS.keys()]],
			["effect", EFFECT_REGISTRY.map((effect) => effect.id)]
		] as const) {
			const actual = catalog.entries
				.filter((entry: any) => entry.kind === kind)
				.map((entry: any) => entry.id)
			expect(actual).toEqual(expect.arrayContaining(ids))
			expect(new Set(actual).size).toBe(actual.length)
		}
		const profiles = JSON.parse(
			readFileSync("../../packages/midi-devices/devices/index.json", "utf8")
		)
		for (const profile of profiles) {
			expect(
				catalog.entries.find(
					(entry: any) => entry.kind === "input" && entry.id === profile.id
				)?.profile
			).toBeTruthy()
		}
		for (const id of ["pink-trombone", "voice-workshop"]) {
			expect(
				catalog.entries.find((entry: any) => entry.kind === "output" && entry.id === id)
					?.registered
			).toBe(true)
		}
	})

	it("publishes fetchable configuration references with the correct deployment prefix", () => {
		for (const entry of catalog.entries) {
			expect(JSON.parse(assets.get(entry.reference.slice(base.length))!)).toEqual(entry)
			expect(entry.url).toBe(`${base}docs/ai/#${entry.kind}-${encodeURIComponent(entry.id)}`)
			for (const url of [
				entry.configurationSource,
				entry.packageDocumentation,
				...Object.values(entry.relatedSources),
				entry.profile
			].filter(Boolean) as string[]) {
				expect(url.startsWith(base)).toBe(true)
				expect(assets.get(url.slice(base.length))?.length).toBeGreaterThan(0)
			}
		}
		expect(
			catalog.entries.find(
				(entry: any) => entry.kind === "instrument" && entry.id === "tone-synth"
			).configurationSource
		).toContain("/tone/tone-synth.ts.txt")
		const transposer = catalog.entries.find(
			(entry: any) => entry.kind === "transformer" && entry.id === "Transposer"
		)
		expect(transposer.controls).toContainEqual(
			expect.objectContaining({
				name: "distance",
				values: expect.arrayContaining([{ name: "Up Octave", value: 12 }])
			})
		)
		const delay = catalog.entries.find(
			(entry: any) => entry.kind === "effect" && entry.id === "delay"
		)
		expect(delay.outputId).toBe("effect:delay")
		expect(delay.parameters).toContainEqual(
			expect.objectContaining({ id: "time", unit: "s", min: 0.01, max: 2 })
		)
	})

	it("links every workspace package and packaged submodule to current manifests and documents", () => {
		const directory = JSON.parse(assets.get("docs/ai/packages/index.json")!)
		const folders = readdirSync("../../packages", { withFileTypes: true })
			.filter((item) => item.isDirectory())
			.map((item) => `packages/${item.name}`)
		expect(directory.packages.map((pkg: any) => pkg.folder).sort()).toEqual(folders.sort())
		const submodules = [
			...readFileSync("../../.gitmodules", "utf8").matchAll(/^\s*path\s*=\s*(.+)$/gm)
		]
			.map((match) => match[1].trim())
			.sort()
		expect(
			directory.packages
				.filter((pkg: any) => pkg.submodule)
				.map((pkg: any) => pkg.folder)
				.sort()
		).toEqual(submodules)
		for (const pkg of directory.packages) {
			const manifest = JSON.parse(readFileSync(`../../${pkg.folder}/package.json`, "utf8"))
			expect(pkg.name).toBe(manifest.name)
			expect(pkg.version).toBe(manifest.version)
			expect(pkg.exports).toEqual(manifest.exports ?? { ".": manifest.main })
			expect(pkg.scripts).toEqual(manifest.scripts ?? {})
			expect(pkg.commit).toMatch(/^[a-f0-9]{40}$/)
			expect(pkg.repository).toMatch(/^https:\/\/github\.com\//)
			expect(assets.get(pkg.readme.slice(base.length))).toBeTruthy()
			for (const doc of pkg.documents) {
				const content = assets.get(doc.url.slice(base.length))!
				expect(content).toBeTruthy()
				for (const link of content.matchAll(/\]\(([^)]+)\)/g)) {
					if (link[1].startsWith(`${base}docs/ai/`)) {
						expect(
							assets.has(link[1].slice(base.length)),
							`${doc.path}: ${link[1]}`
						).toBe(true)
					}
				}
			}
		}
		expect(catalog.packageDirectory).toBe(`${base}docs/ai/packages/index.json`)
		expect(assets.get("llms.txt")).toContain(`${base}docs/ai/packages/`)
		expect(assets.get("llms-full.txt")).toContain("# Package: control-surface")
		expect(assets.get("docs/ai/index.html")).toContain(`href="${base}docs/ai/packages/"`)
		for (const entry of catalog.entries) {
			expect(entry.package).toBeTruthy()
			expect(directory.packages.some((pkg: any) => pkg.name === entry.package)).toBe(true)
		}
	})

	it("exposes readable, static discovery endpoints and visible app links", () => {
		const html = assets.get("docs/ai/index.html")!
		expect(html).not.toContain("{{")
		expect(html).toContain(`href="${base}docs/ai/catalog.json"`)
		expect(html).toContain('id="transformer-Ensemble"')
		expect(html).not.toContain("<script")
		expect(assets.get("llms.txt")).toContain(`${base}docs/ai/`)
		expect(assets.get("llms-full.txt")).toContain("# Complete component catalog")
		expect(assets.get("llms-full.txt")).not.toContain("<style>")
		const app = readFileSync("index.html", "utf8")
		expect(app.match(/Documentation for AI agents/g)?.length).toBeGreaterThanOrEqual(3)
		expect(app).toContain('rel="help" href="%BASE_URL%docs/ai/"')
	})

	it("loads every documented JavaScript recipe through the actual preset URL API", async () => {
		const pages = readPresetFiles("presets")
		const html = assets.get("docs/ai/index.html")!
		const examples = [...html.matchAll(/<pre><code>([\s\S]*?)<\/code><\/pre>/g)]
		expect(examples).toHaveLength(3)
		for (const [index, example] of examples.entries()) {
			const script = example[1]
				.replaceAll("&gt;", ">")
				.replaceAll("&lt;", "<")
				.replaceAll("&amp;", "&")
			const context: any = {
				URL,
				URLSearchParams,
				documentationPageUrl: `${origin}${base}docs/ai/`,
				appRoot: new URL(base, origin),
				console: { log() {} }
			}
			runInNewContext(`${script}\nglobalThis.result = url.href;`, context)
			const page = await loadPresetPage(context.result, base, async (url: string) => {
				const route = new URL(url).pathname.slice(base.length).replace(/\/preset.json$/, "")
				const preset = pages.get(route)
				return preset ? Response.json(preset) : new Response(null, { status: 404 })
			})
			expect(page, `recipe ${index + 1}`).toBeTruthy()
			if (index === 1) {
				expect(page!.workspace.chains).toHaveLength(2)
			}
			if (index === 2) {
				expect(new URL(context.result).searchParams.get("room")).toBe("group-rehearsal")
				expect(page!.workspace.chains[0].id).toBe("ensemble-any-song-gamepads")
			}
		}
	})
})