import { afterEach, describe, expect, it } from "vitest"
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomBytes } from "node:crypto"
import { gzipSync, gunzipSync } from "node:zlib"
import { prepareCloudflareAssets } from "../scripts/cloudflare-assets.js"
import { createAssetWorker } from "../scripts/cloudflare-assets-worker.js"

const directories: string[] = []
afterEach(async () => {
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe("Cloudflare archive delivery", () => {
	async function prepare() {
		const directory = await mkdtemp(join(tmpdir(), "harmoneasy-assets-test-"))
		directories.push(directory)
		await mkdir(join(directory, "webclap/plugins"), { recursive: true })
		const original = randomBytes(2048)
		const compressed = gzipSync(original)
		const path = "/webclap/plugins/synth.wclap.tar.gz"
		await writeFile(join(directory, path), compressed)
		await writeFile(join(directory, "index.html"), "app")
		const archives = await prepareCloudflareAssets(directory, 512)
		const env = {
			ASSETS: {
				async fetch(request: Request) {
					try {
						return new Response(
							await readFile(join(directory, new URL(request.url).pathname))
						)
					} catch {
						return new Response("Missing", { status: 404 })
					}
				}
			}
		}
		return {
			directory,
			original,
			compressed,
			path,
			archives,
			env,
			worker: createAssetWorker(archives)
		}
	}

	it("keeps every archive part below the limit and streams the original gzip bytes", async () => {
		const { directory, original, compressed, path, archives, env, worker } = await prepare()
		await expect(stat(join(directory, path))).rejects.toThrow()
		for (const part of archives[path].parts) {
			expect((await stat(join(directory, part))).size).toBeLessThanOrEqual(512)
		}
		const response = await worker.fetch(new Request(`https://example.test${path}?v=1`), env)
		expect(response.headers.get("Content-Type")).toBe("application/gzip")
		const bytes = Buffer.from(await response.arrayBuffer())
		expect(bytes).toEqual(compressed)
		expect(gunzipSync(bytes)).toEqual(original)
		const routes = JSON.parse(await readFile(join(directory, "_routes.json"), "utf8"))
		expect(routes.include).toEqual([path])
		expect(await readFile(join(directory, "_worker.js"), "utf8")).toContain(
			"export default createAssetWorker("
		)
		expect(await readdir(directory)).toContain("index.html")
	})

	it("supports HEAD, cache revalidation and static asset fallback", async () => {
		const { path, archives, env, worker } = await prepare()
		const head = await worker.fetch(
			new Request(`https://example.test${path}`, { method: "HEAD" }),
			env
		)
		expect(head.headers.get("Content-Length")).toBe(String(archives[path].size))
		expect(await head.text()).toBe("")
		const cached = await worker.fetch(
			new Request(`https://example.test${path}`, {
				headers: { "If-None-Match": archives[path].etag }
			}),
			env
		)
		expect(cached.status).toBe(304)
		const page = await worker.fetch(new Request("https://example.test/index.html"), env)
		expect(await page.text()).toBe("app")
	})

	it("fails explicitly if a part is missing instead of returning a truncated archive", async () => {
		const { directory, path, archives, env, worker } = await prepare()
		await rm(join(directory, archives[path].parts[0]))
		const response = await worker.fetch(new Request(`https://example.test${path}`), env)
		expect(response.status).toBe(502)
	})
})