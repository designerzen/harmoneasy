import { afterAll, beforeAll, expect, it } from "vitest"
import { build, createServer, type ViteDevServer } from "vite"
import { fileURLToPath } from "node:url"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { supersonicFilesPlugin } from "audiobus/io/outputs/supersonic-files.js"

const entry = fileURLToPath(
	new URL("../../../packages/audiobus/io/outputs/output-supersonic.ts", import.meta.url)
)
let server: ViteDevServer
let baseUrl: string
let outDir: string

beforeAll(async () => {
	outDir = await mkdtemp(join(tmpdir(), "harmoneasy-supersonic-"))
	server = await createServer({
		configFile: false,
		plugins: [supersonicFilesPlugin()],
		server: { host: "127.0.0.1", port: 0, watch: null },
		optimizeDeps: { noDiscovery: true, include: [] },
		logLevel: "silent"
	})
	await server.listen()
	const address = server.httpServer!.address()
	if (!address || typeof address === "string") {
		throw new Error("Missing dev server address")
	}
	baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
	await server?.close()
	if (outDir) {
		await rm(outDir, { recursive: true, force: true })
	}
})

it.each([
	["workers/scsynth_audio_worklet.js", "text/javascript"],
	["workers/osc_in_worker.js", "text/javascript"],
	["wasm/scsynth-nrt.wasm", "application/wasm"],
	["synthdefs/sonic-pi-beep.scsyndef", "application/octet-stream"]
])("serves %s as an engine asset", async (path, mime) => {
	const response = await fetch(`${baseUrl}/supersonic/${path}`)
	expect(response.status).toBe(200)
	expect(response.headers.get("content-type")).toBe(mime)
	const bytes = new Uint8Array(await response.arrayBuffer())
	expect(bytes.length).toBeGreaterThan(0)
	if (path.endsWith(".wasm")) {
		expect(Array.from(bytes.subarray(0, 4))).toEqual([0, 97, 115, 109])
	}
})

it("bundles the output without Node imports and includes runtime assets under the deployment base", async () => {
	const result = await build({
		configFile: false,
		base: "/harmoneasy/",
		plugins: [supersonicFilesPlugin()],
		logLevel: "silent",
		build: {
			outDir,
			minify: false,
			lib: { entry, formats: ["es"], fileName: "output-supersonic" }
		}
	})
	const outputs = Array.isArray(result) ? result : [result]
	const code = outputs
		.flatMap((output) => ("output" in output ? output.output : []))
		.filter((output) => output.type === "chunk")
		.map((output) => output.code)
		.join("\n")
	expect(code).not.toMatch(/from\s*["'](?:node:|url["']|path["'])/)
	expect(code).toContain("/harmoneasy/")
	expect(code).not.toContain("getSynthDefPath")
	expect([
		...(await readFile(join(outDir, "supersonic/wasm/scsynth-nrt.wasm"))).subarray(0, 4)
	]).toEqual([0, 97, 115, 109])
	expect(
		(await readFile(join(outDir, "supersonic/workers/scsynth_audio_worklet.js"))).length
	).toBeGreaterThan(0)
	expect(
		(await readFile(join(outDir, "supersonic/workers/osc_in_worker.js"))).length
	).toBeGreaterThan(0)
})