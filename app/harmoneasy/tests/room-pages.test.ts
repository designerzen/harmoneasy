import { describe, expect, it, vi } from "vitest"
import { runInNewContext } from "node:vm"
import { roomFallbackHtml, roomPagesPlugin } from "../scripts/room-pages.js"
import { playDirectoryHtml } from "../scripts/play-directory.js"
import { Window } from "happy-dom"
import { readFileSync } from "node:fs"

describe("static room pages", () => {
	it.each(["/harmoneasy/play/", "/harmoneasy/play/abba/", "/harmoneasy/play/?play=abba"])(
		"renders the artist directory or actual song links at %s without starting the app",
		async (path) => {
			const plugin = roomPagesPlugin()
			plugin.configResolved({ base: "/harmoneasy/" })
			const assets = new Map<string, string>()
			plugin.generateBundle.call(
				{
					emitFile(asset: any) {
						assets.set(asset.fileName, asset.source)
					}
				},
				{},
				{ "index.html": { type: "asset", source: "APP START SCREEN" } }
			)
			const html = assets.get("play/index.html")!
			const window = new Window({ url: `https://example.test${path}` })
			window.document.body.innerHTML = html
			const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)![1]
			runInNewContext(script, {
				document: window.document,
				location: window.location,
				URLSearchParams,
				fetch: async (url: string) =>
					Response.json(JSON.parse(assets.get(url.replace("/harmoneasy/", ""))!))
			})
			await vi.waitFor(() =>
				expect(window.document.querySelector('[role="status"]')?.textContent).not.toBe(
					"Loading full catalogue…"
				)
			)
			const links = [...window.document.querySelectorAll<HTMLAnchorElement>("h2 a")]
			expect(links.length).toBeGreaterThan(0)
			if (path === "/harmoneasy/play/") {
				expect(window.document.querySelector("h1")?.textContent).toBe("Find an artist.")
				expect(links.some((link) => link.textContent === "ABBA")).toBe(true)
			} else {
				expect(links.every((link) => link.href.includes("/play/bitmidi/"))).toBe(true)
				expect(links.some((link) => /dancing/i.test(link.textContent ?? ""))).toBe(true)
			}
			expect(html).not.toContain("APP START SCREEN")
			await window.happyDOM.close()
		}
	)

	it("ships thousands of distinct real BitMidi records with exact play links", () => {
		const catalogue = JSON.parse(readFileSync("public/midi/bitmidi-catalogue.json", "utf8"))
		expect(catalogue.songs.length).toBeGreaterThanOrEqual(9000)
		expect(new Set(catalogue.songs.map((song: any) => song.id)).size).toBe(
			catalogue.songs.length
		)
		expect(new Set(catalogue.songs.map((song: any) => song.slug)).size).toBe(
			catalogue.songs.length
		)
		for (const song of catalogue.songs) {
			expect(song.id).toBeGreaterThan(0)
			expect(song.name).toBeTruthy()
			expect(song.slug).toMatch(/^[^/?#]+$/)
		}
	})
	it("serves the directory in development while retaining song routes", () => {
		const plugin = roomPagesPlugin()
		plugin.configResolved({ base: "/harmoneasy/" })
		let handler: any
		plugin.configureServer({
			middlewares: {
				use: (value: any) => {
					handler = value
				}
			}
		})
		const response = { setHeader: vi.fn(), end: vi.fn() }
		const next = vi.fn()
		handler({ url: "/harmoneasy/play/" }, response, next)
		expect(response.end).toHaveBeenCalledWith(expect.stringContaining("Browse songs"))
		handler({ url: "/harmoneasy/play/?play=abba" }, response, next)
		handler({ url: "/harmoneasy/play/abba/" }, response, next)
		expect(next).not.toHaveBeenCalled()
		handler({ url: "/harmoneasy/play/abba/sos/" }, response, next)
		handler({ url: "/harmoneasy/play/?play=abba%2Fsos" }, response, next)
		expect(next).toHaveBeenCalledTimes(2)
	})
	it("passes static song redirects through to the application with their query and hash", () => {
		const html = playDirectoryHtml([], "/harmoneasy/")
		const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]
		const location = { search: "?play=abba%2Fsos", hash: "#setup", replace: vi.fn() }
		runInNewContext(script, { URLSearchParams, location })
		expect(location.replace).toHaveBeenCalledWith("/harmoneasy/?play=abba%2Fsos#setup")
	})
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
			fileName: "play/index.html",
			source: expect.stringContaining("Search artists")
		})
		const assets = emitFile.mock.calls.map(([asset]) => asset)
		const catalogue = assets.find((asset) =>
			/^play\/catalogue-[a-f0-9]+\.json$/.test(asset.fileName)
		)!
		const page = assets.find((asset) => asset.fileName === "play/index.html")!
		expect(JSON.parse(catalogue.source).tracks).toHaveLength(
			JSON.parse(readFileSync("public/midi/bitmidi-catalogue.json", "utf8")).songs.length +
				JSON.parse(readFileSync("public/midi/index.json", "utf8")).length
		)
		expect(page.source.length).toBeLessThan(100000)
		expect(page.source).toContain(`/harmoneasy/${catalogue.fileName}`)
		expect(page.source).not.toContain('"tracks":[')
		expect(emitFile).toHaveBeenCalledWith({
			type: "asset",
			fileName: "404.html",
			source: roomFallbackHtml("/harmoneasy/room/", "/harmoneasy/play/")
		})
	})
	it.each(["/harmoneasy/", "/"])(
		"recovers missing paths under %s without losing setup or pairing data",
		(base) => {
			const html = roomFallbackHtml(`${base}room/`, `${base}play/`)
			const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]
			const link = { href: "" }
			const location = {
				origin: "https://example.test",
				pathname: `${base}missing`,
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
	it("redirects missing play paths to the play entry with the song kept", () => {
		const html = roomFallbackHtml("/harmoneasy/room/", "/harmoneasy/play/")
		const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]
		const location = {
			origin: "https://example.test",
			pathname: "/harmoneasy/play/rick-astley/never-gonna-give-you-up/",
			search: "",
			hash: "",
			replace: vi.fn()
		}
		runInNewContext(script, {
			URL,
			location,
			document: { getElementById: () => ({ href: "" }) }
		})
		expect(location.replace).toHaveBeenCalledExactlyOnceWith(
			"https://example.test/harmoneasy/play/?play=rick-astley%2Fnever-gonna-give-you-up%2F"
		)
	})
})