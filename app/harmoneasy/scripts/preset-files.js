import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { presetFilePages, presetFileRoute } from "./preset-file-routes.js"

export function readPresetFiles(directory) {
	const files = []
	const ids = new Set()
	const visit = (folder, prefix = "") => {
		for (const entry of readdirSync(folder, { withFileTypes: true })) {
			const path = `${prefix}${entry.name}`
			if (entry.isDirectory()) {
				visit(join(folder, entry.name), `${path}/`)
			} else if (entry.name.endsWith(".json")) {
				try {
					const page = JSON.parse(readFileSync(join(folder, entry.name), "utf8"))
					if (
						page.format !== "harmoneasy-preset" ||
						page.version !== 1 ||
						typeof page.name !== "string" ||
						!page.name.trim() ||
						typeof page.description !== "string" ||
						page.workspace?.version !== 2 ||
						!Array.isArray(page.workspace.chains) ||
						!Array.isArray(page.workspace.devices) ||
						!page.clock ||
						!page.midiControls
					) {
						throw new Error("Expected an exported Harmoneasy preset")
					}
					const id = page.catalogue?.id ?? `published:${presetFileRoute(path)}`
					if (ids.has(id)) {
						throw new Error(`Duplicate preset ID: ${id}`)
					}
					ids.add(id)
					files.push([path, page])
				} catch (error) {
					throw new Error(`Invalid preset file ${path}: ${error.message}`)
				}
			}
		}
	}
	visit(directory)
	return presetFilePages(files)
}