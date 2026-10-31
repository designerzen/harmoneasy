import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { builtinPresetPages } from "../source/services/builtin-preset-pages.ts"
import { presetDirectoryEntries, presetDirectoryHtml } from "./preset-directory.js"

async function staticPresetPages(publicDir) {
	const pages = new Map()
	const visit = async (directory, route) => {
		let entries
		try {
			entries = await readdir(directory, { withFileTypes: true })
		} catch (error) {
			if (error.code === "ENOENT") {
				return
			}
			throw error
		}
		for (const item of entries) {
			if (item.isDirectory()) {
				if (!/^[a-z0-9][a-z0-9_-]*$/.test(item.name)) {
					throw new Error(`Invalid preset folder: ${item.name}`)
				}
				await visit(join(directory, item.name), `${route}/${item.name}`)
			} else if (item.name === "preset.json") {
				const page = JSON.parse(await readFile(join(directory, item.name), "utf8"))
				if (page.format !== "harmoneasy-preset" || page.version !== 1) {
					throw new Error(`Invalid preset: ${route}`)
				}
				pages.set(route, page)
			}
		}
	}
	await visit(join(publicDir, "preset"), "preset")
	return pages
}

/** Each preset.json under public/preset gets an actual static HTML entry point. */
export function presetPagesPlugin() {
	let publicDir
	let base
	const pages = builtinPresetPages()
	const directoryAssets = async (staticPages) => {
		const entries = presetDirectoryEntries(
			pages,
			staticPages ?? (await staticPresetPages(publicDir))
		)
		const client = await readFile(
			new URL("./preset-directory-client.js", import.meta.url),
			"utf8"
		)
		return {
			html: presetDirectoryHtml(entries, base, client),
			json: JSON.stringify(entries)
		}
	}
	return {
		name: "harmoneasy-preset-pages",
		enforce: "post",
		configResolved(config) {
			publicDir = config.publicDir
			base = config.base ?? "/"
		},
		configureServer(server) {
			server.middlewares.use((request, response, next) => {
				const pathname = new URL(request.url, "http://localhost").pathname
				const directoryPath = `${base}presets`
				if (
					[
						directoryPath,
						`${directoryPath}/`,
						`${directoryPath}/index.html`,
						`${directoryPath}/index.json`
					].includes(pathname)
				) {
					return directoryAssets()
						.then((assets) => {
							const json = pathname.endsWith("/index.json")
							response.setHeader(
								"Content-Type",
								json ? "application/json" : "text/html; charset=utf-8"
							)
							response.end(json ? assets.json : assets.html)
						})
						.catch(next)
				}
				const route = pathname.slice(base.length).replace(/\/preset\.json$/, "")
				if (
					!pathname.startsWith(base) ||
					!pathname.endsWith("/preset.json") ||
					!pages.has(route)
				) {
					return next()
				}
				response.setHeader("Content-Type", "application/json")
				response.end(JSON.stringify(pages.get(route)))
			})
		},
		async generateBundle(_options, bundle) {
			const entry = bundle["index.html"]
			if (!entry || entry.type !== "asset") {
				throw new Error("Missing Harmoneasy HTML entry point")
			}
			const staticPages = await staticPresetPages(publicDir)
			for (const route of staticPages.keys()) {
				this.emitFile({
					type: "asset",
					fileName: `${route}/index.html`,
					source: entry.source
				})
			}
			for (const [route, page] of pages) {
				if (staticPages.has(route)) {
					continue
				}
				this.emitFile({
					type: "asset",
					fileName: `${route}/preset.json`,
					source: JSON.stringify(page)
				})
				this.emitFile({
					type: "asset",
					fileName: `${route}/index.html`,
					source: entry.source
				})
			}
			const directory = await directoryAssets(staticPages)
			this.emitFile({ type: "asset", fileName: "presets/index.html", source: directory.html })
			this.emitFile({ type: "asset", fileName: "presets/index.json", source: directory.json })
		}
	}
}