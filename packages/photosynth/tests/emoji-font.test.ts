// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"

const originalFonts = Object.getOwnPropertyDescriptor(document, "fonts")
afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
	if (originalFonts) Object.defineProperty(document, "fonts", originalFonts)
	else Reflect.deleteProperty(document, "fonts")
})

async function setup() {
	vi.resetModules()
	const fetchFont = vi.fn().mockResolvedValue(new Response(new Uint8Array([0, 1, 2, 255])))
	vi.stubGlobal("fetch", fetchFont)
	const load = vi.fn().mockResolvedValue(undefined)
	const createFace = vi.fn()
	vi.stubGlobal("FontFace", class {
		constructor(family: string, bytes: ArrayBuffer) { createFace(family, bytes) }
		load = load
	})
	const add = vi.fn()
	Object.defineProperty(document, "fonts", { configurable: true, value: { add } })
	return { module: await import("../src/emoji-font.js"), fetchFont, load, add, createFace }
}

describe("bundled Noto Emoji font", () => {
	it("shares a single local asset download and embeds exactly those bytes in SVG font data", async () => {
		const { module, fetchFont, load, add, createFace } = await setup()
		const first = module.loadEmojiFont(), second = module.loadEmojiFont()
		expect(first).toBe(second)
		expect(await first).toEqual({ family: "Photosynth Noto Emoji", dataUrl: "data:font/ttf;base64,AAEC/w==" })
		expect(fetchFont).toHaveBeenCalledOnce()
		expect(String(fetchFont.mock.calls[0]![0])).toContain("/assets/NotoEmoji-Regular.ttf")
		expect(createFace).toHaveBeenCalledWith("Photosynth Noto Emoji", expect.any(ArrayBuffer))
		expect(load).toHaveBeenCalledOnce(); expect(add).toHaveBeenCalledOnce()
	})
	it("retries a failed download instead of permanently caching the failure", async () => {
		const { module, fetchFont } = await setup()
		fetchFont.mockResolvedValueOnce(new Response("Missing", { status: 404 }))
		await expect(module.loadEmojiFont()).rejects.toThrow("404")
		await expect(module.loadEmojiFont()).resolves.toMatchObject({ family: "Photosynth Noto Emoji" })
		expect(fetchFont).toHaveBeenCalledTimes(2)
	})
	it("does not resolve the atlas font until the browser has finished loading its face", async () => {
		const { module, load, add } = await setup()
		let finish!: () => void
		load.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
		const ready = module.loadEmojiFont()
		await vi.waitFor(() => expect(load).toHaveBeenCalledOnce())
		expect(add).not.toHaveBeenCalled()
		finish(); await ready
		expect(add).toHaveBeenCalledOnce()
	})
})
