import { createHash } from "node:crypto"
import { open, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

export const PAGES_ASSET_LIMIT = 25 * 1024 * 1024
const PART_SIZE = 20 * 1024 * 1024

// Pages stores each part as a static asset; the Worker restores the archive URL.
export async function prepareCloudflareAssets(directory, limit = PAGES_ASSET_LIMIT) {
	const archives = {}
	for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
		if (!entry.isFile()) {
			continue
		}
		const path = join(entry.parentPath, entry.name)
		const { size } = await stat(path)
		if (size <= limit) {
			continue
		}
		if (!entry.name.endsWith(".wclap.tar.gz")) {
			throw new Error(`Cloudflare Pages asset exceeds ${limit} bytes: ${path}`)
		}
		const relative = path.slice(directory.length + 1).replaceAll("\\", "/")
		const parts = []
		const hash = createHash("sha256")
		const file = await open(path, "r")
		try {
			let position = 0
			while (position < size) {
				const buffer = Buffer.alloc(Math.min(PART_SIZE, limit, size - position))
				const { bytesRead } = await file.read(buffer, 0, buffer.length, position)
				if (!bytesRead) {
					throw new Error(`Unexpected end of archive: ${path}`)
				}
				const data = buffer.subarray(0, bytesRead)
				hash.update(data)
				const suffix = `.part-${parts.length}`
				await writeFile(path + suffix, data)
				parts.push("/" + relative + suffix)
				position += bytesRead
			}
		} finally {
			await file.close()
		}
		archives["/" + relative] = { parts, size, etag: `"${hash.digest("hex")}"` }
		await unlink(path)
	}
	const worker = await readFile(new URL("./cloudflare-assets-worker.js", import.meta.url), "utf8")
	await writeFile(
		join(directory, "_worker.js"),
		`${worker}\nexport default createAssetWorker(${JSON.stringify(archives)});\n`
	)
	await writeFile(
		join(directory, "_routes.json"),
		JSON.stringify({
			version: 1,
			include: Object.keys(archives),
			exclude: []
		})
	)
	return archives
}

export function cloudflareAssetsPlugin() {
	let directory
	return {
		name: "cloudflare-assets",
		apply: "build",
		configResolved(config) {
			directory = resolve(config.root, config.build.outDir)
		},
		closeBundle: {
			order: "post",
			async handler() {
				if (process.env.CF_PAGES === "1") {
					await prepareCloudflareAssets(directory)
				}
			}
		}
	}
}