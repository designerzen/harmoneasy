import { afterEach, describe, expect, it, vi } from "vitest"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readPresetFiles } from "../scripts/preset-files.js"
import { presetPagesPlugin } from "../scripts/preset-pages.js"
import { presetFileRoute } from "../scripts/preset-file-routes.js"
import { exportPublishedPreset } from "../source/services/preset-export"
import { parsePresetPage } from "../source/services/preset-page"
import { applySetup, importLibrary, readLibrary } from "../source/components/graph/saved-presets"
import { defaultMusicTools } from "../../../packages/audiobus/io/music-tools"
import { decompressFromBase64 } from "lz-string"

const source = parsePresetPage(await readFile("presets/inputs/leap-motion/aurora.json", "utf8"))
const temporary: string[] = []
afterEach(async () => {
	vi.unstubAllGlobals()
	for (const path of temporary.splice(0)) {
		await rm(path, { recursive: true, force: true })
	}
})

function exported() {
	const workspace = structuredClone(source.workspace)
	workspace.musicTools = defaultMusicTools()
	workspace.chains[0].disabledInputs = [workspace.chains[0].inputs[0]]
	const manager = { exportWorkspaceData: () => workspace }
	return {
		workspace,
		file: exportPublishedPreset(
			manager as any,
			"genres/my-new-set",
			"My new set",
			"Connect the input and play.",
			source.clock,
			{ enabled: true, bindings: [{ target: "app:volume", cc: 7, channel: 0, source: "" }] }
		)
	}
}

describe("JSON preset contributions", () => {
	it("exports a self-contained preset and automatically publishes a newly added file", async () => {
		const root = await mkdtemp(join(tmpdir(), "harmoneasy-preset-"))
		temporary.push(root)
		const folder = join(root, "presets")
		await mkdir(join(folder, "genres"), { recursive: true })
		const { workspace, file } = exported()
		expect(file.filename).toBe("my-new-set.json")
		expect(file.repositoryPath).toBe("app/harmoneasy/presets/genres/my-new-set.json")
		await writeFile(join(folder, "genres", file.filename), file.json)
		const pages = readPresetFiles(folder)
		const page = pages.get("presets/genres/my-new-set")!
		expect(page.catalogue).toBeUndefined()
		expect(parsePresetPage(JSON.stringify(page)).workspace).toEqual(workspace)
		expect(pages.get("preset/genres/my-new-set")).toBe(page)
		const plugin = presetPagesPlugin({ presetsDir: folder })
		plugin.configResolved({ publicDir: join(root, "public"), base: "/app/" })
		const emitFile = vi.fn()
		await plugin.generateBundle.call(
			{ emitFile },
			{},
			{ "index.html": { type: "asset", source: "<html>app</html>" } }
		)
		expect(emitFile).toHaveBeenCalledWith({
			type: "asset",
			fileName: "presets/genres/my-new-set/index.html",
			source: "<html>app</html>"
		})
		const directory = JSON.parse(
			emitFile.mock.calls.find(([asset]) => asset.fileName === "presets/index.json")![0]
				.source
		)
		expect(directory).toHaveLength(1)
		expect(directory[0]).toMatchObject({
			name: "My new set",
			route: "presets/genres/my-new-set"
		})
	})

	it("imports publishing exports and restores their complete workspace state", async () => {
		const storage = new Map<string, string>()
		vi.stubGlobal("localStorage", {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => storage.set(key, value)
		})
		vi.stubGlobal("window", new EventTarget())
		const { workspace, file } = exported()
		importLibrary(file.json)
		const setup = readLibrary().setups[0]
		expect(setup.name).toBe("My new set")
		expect(setup.clock).toEqual(source.clock)
		const manager = { restoreWorkspace: vi.fn() }
		await applySetup(manager as any, setup)
		const restored = JSON.parse(
			decompressFromBase64(manager.restoreWorkspace.mock.calls[0][0].slice(10))
		)
		expect(restored).toEqual(workspace)
	})

	it.each(["../escape", "genres//name", "genres/Bad Name", "index", "genres/index", "/absolute"])(
		"rejects invalid publishing path %s",
		(path) => {
			expect(() => presetFileRoute(path)).toThrow("Invalid preset filename")
		}
	)

	it("rejects malformed JSON, duplicate preset IDs and conflicting route aliases", async () => {
		const folder = await mkdtemp(join(tmpdir(), "harmoneasy-preset-invalid-"))
		temporary.push(folder)
		await writeFile(join(folder, "bad.json"), "{}")
		expect(() => readPresetFiles(folder)).toThrow("bad.json")
		await writeFile(join(folder, "bad.json"), JSON.stringify(source))
		await writeFile(join(folder, "duplicate.json"), JSON.stringify(source))
		expect(() => readPresetFiles(folder)).toThrow("Duplicate preset ID")
		await rm(join(folder, "bad.json"))
		await rm(join(folder, "duplicate.json"))
		const { file } = exported()
		await mkdir(join(folder, "inputs"), { recursive: true })
		await mkdir(join(folder, "hardware"), { recursive: true })
		await writeFile(join(folder, "inputs", "test.json"), file.json)
		await writeFile(join(folder, "hardware", "test.json"), file.json)
		expect(() => readPresetFiles(folder)).toThrow("Duplicate preset route")
	})
})