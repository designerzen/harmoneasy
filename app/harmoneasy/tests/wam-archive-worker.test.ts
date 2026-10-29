import { expect, it, vi } from "vitest"
import vm from "node:vm"
import {
	wamArchiveWorkerSource,
	WAM_ARCHIVE_CACHE
} from "../../../packages/audiobus/wam/archive-files.js"

it("serves module-relative assets with their stored MIME and isolation headers, without taking over other fetches", async () => {
	const listeners = new Map<string, Function>()
	const response = new Response("wasm", {
		headers: {
			"Content-Type": "application/wasm",
			"Cross-Origin-Embedder-Policy": "require-corp"
		}
	})
	const match = vi.fn(async () => response)
	const open = vi.fn(async () => ({ match }))
	vm.runInNewContext(wamArchiveWorkerSource, {
		URL,
		Response,
		caches: { open },
		self: {
			registration: { scope: "https://example.com/harmoneasy/" },
			addEventListener: (name: string, callback: Function) => listeners.set(name, callback)
		}
	})
	const event = (url: string) => ({
		request: { url },
		stopImmediatePropagation: vi.fn(),
		respondWith: vi.fn()
	})
	const asset = event("https://example.com/harmoneasy/wam-archives/id/plugin/engine.wasm?v=2")
	listeners.get("fetch")!(asset)
	const result = await asset.respondWith.mock.calls[0][0]
	expect(open).toHaveBeenCalledWith(WAM_ARCHIVE_CACHE)
	expect(match).toHaveBeenCalledWith(
		"https://example.com/harmoneasy/wam-archives/id/plugin/engine.wasm"
	)
	expect(result.headers.get("Content-Type")).toBe("application/wasm")
	expect(result.headers.get("Cross-Origin-Embedder-Policy")).toBe("require-corp")
	expect(asset.stopImmediatePropagation).toHaveBeenCalledOnce()
	const page = event("https://example.com/harmoneasy/main.js")
	listeners.get("fetch")!(page)
	expect(page.respondWith).not.toHaveBeenCalled()
	expect(page.stopImmediatePropagation).not.toHaveBeenCalled()
	match.mockResolvedValueOnce(undefined as any)
	const absent = event("https://example.com/harmoneasy/wam-archives/id/missing.js")
	listeners.get("fetch")!(absent)
	expect((await absent.respondWith.mock.calls[0][0]).status).toBe(404)
})