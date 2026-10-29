import { describe, expect, it, vi } from "vitest"
import { runInNewContext } from "node:vm"
import { roomFallbackHtml, roomPagesPlugin } from "../scripts/room-pages.js"

describe("static room pages", () => {
	it("publishes the application at /room/ with the same built asset URLs", () => {
		const plugin = roomPagesPlugin()
		plugin.configResolved({ base: "/harmoneasy/" })
		const html = '<script type="module" src="/harmoneasy/assets/app.js"></script>'
		const emitFile = vi.fn()
		plugin.generateBundle.call(
			{ emitFile },
			{},
			{ "index.html": { type: "asset", source: html } }
		)
		expect(emitFile).toHaveBeenCalledWith({
			type: "asset",
			fileName: "room/index.html",
			source: html
		})
		expect(emitFile).toHaveBeenCalledWith({
			type: "asset",
			fileName: "404.html",
			source: roomFallbackHtml("/harmoneasy/room/")
		})
	})
	it.each(["/harmoneasy/", "/"])(
		"recovers missing paths under %s without losing setup or pairing data",
		(base) => {
			const html = roomFallbackHtml(`${base}room/`)
			const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]
			const link = { href: "" }
			const location = {
				origin: "https://example.test",
				search: "?room=our-jam",
				hash: "#room-setup=seed&sync-bundle=offer",
				replace: vi.fn()
			}
			runInNewContext(script, { URL, location, document: { getElementById: () => link } })
			const expected = `https://example.test${base}room/?room=our-jam#room-setup=seed&sync-bundle=offer`
			expect(location.replace).toHaveBeenCalledExactlyOnceWith(expected)
			expect(link.href).toBe(expected)
		}
	)
})