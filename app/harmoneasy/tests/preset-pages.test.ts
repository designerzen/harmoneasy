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
	})
})