import { describe, expect, it, vi } from "vitest"
import { fileURLToPath } from "node:url"
import { presetPagesPlugin } from "../scripts/preset-pages.js"

describe("static preset pages", () => {
	it("publishes a real nested page using the built application's absolute asset URLs", async () => {
		const plugin = presetPagesPlugin()
		plugin.configResolved({ publicDir: fileURLToPath(new URL("../public", import.meta.url)) })
		const source = '<script type="module" src="/harmoneasy/assets/app.js"></script>'
		const emitFile = vi.fn()
		await plugin.generateBundle.call(
			{ emitFile },
			{},
			{ "index.html": { type: "asset", source } }
		)
		expect(emitFile).toHaveBeenCalledWith({
			type: "asset",
			fileName: "preset/hardware/arcana/strum/index.html",
			source
		})
		expect(emitFile).toHaveBeenCalledWith({
			type: "asset",
			fileName: "preset/hardware/cosmo/dots/index.html",
			source
		})
		const files = new Map(emitFile.mock.calls.map(([file]) => [file.fileName, file.source]))
		const directory = files.get("presets/index.html")!
		const catalogue = JSON.parse(files.get("presets/index.json")!)
		expect(directory).toContain("Find a setup.")
		expect(directory).not.toContain("assets/app.js")
		expect(catalogue.some((entry: any) => entry.name.includes("Cosmo"))).toBe(true)
		for (const item of catalogue) {
			expect(files.has(`${item.route}/index.html`)).toBe(true)
		}
	})
	it("serves the standalone directory and its JSON in development below the deployment base", async () => {
		const plugin = presetPagesPlugin()
		plugin.configResolved({
			base: "/harmoneasy/",
			publicDir: fileURLToPath(new URL("../public", import.meta.url))
		})
		let middleware: any
		plugin.configureServer({
			middlewares: {
				use: (handler: any) => {
					middleware = handler
				}
			}
		})
		const response = { setHeader: vi.fn(), end: vi.fn() }
		const next = vi.fn()
		await middleware({ url: "/harmoneasy/presets/?q=cosmo" }, response, next)
		expect(response.setHeader).toHaveBeenLastCalledWith(
			"Content-Type",
			"text/html; charset=utf-8"
		)
		expect(response.end.mock.calls[0][0]).toContain("preset-directory")
		await middleware({ url: "/harmoneasy/presets/index.json" }, response, next)
		expect(JSON.parse(response.end.mock.calls[1][0]).length).toBeGreaterThan(2)
		expect(next).not.toHaveBeenCalled()
	})
})