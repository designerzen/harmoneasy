import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

/** Each preset.json under public/preset gets an actual static HTML entry point. */
export function presetPagesPlugin() {
	let publicDir
	return {
		name: "harmoneasy-preset-pages",
		enforce: "post",
		configResolved(config) {
			publicDir = config.publicDir
		},
		async generateBundle(_options, bundle) {
			const entry = bundle["index.html"]
			if (!entry || entry.type !== "asset") {
				throw new Error("Missing Harmoneasy HTML entry point")
			}
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
						const preset = JSON.parse(
							await readFile(join(directory, item.name), "utf8")
						)
						if (preset.format !== "harmoneasy-preset" || preset.version !== 1) {
							throw new Error(`Invalid preset: ${route}`)
						}
						this.emitFile({
							type: "asset",
							fileName: `${route}/index.html`,
							source: entry.source
						})
					}
				}
			}
			await visit(join(publicDir, "preset"), "preset")
		}
	}
}