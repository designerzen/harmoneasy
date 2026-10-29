import { describe, expect, it } from "vitest"
import { createRoomUrl, readRoomUrl } from "../source/services/room-url"

const setup = {
	version: 1 as const,
	workspace: "workspace:encoded-io",
	bpm: 125,
	swing: 0.2,
	divisions: 24,
	bars: 4
}

describe("room and setup URLs", () => {
	it("carries a room identity and its full starting setup in a static-host-compatible fragment", () => {
		const link = createRoomUrl("https://example.test/harmoneasy/?private=1#old=secret", {
			roomId: "our-jam",
			setup
		})
		expect(readRoomUrl(link)).toEqual({ roomId: "our-jam", setup })
		expect(new URL(link).pathname).toBe("/harmoneasy/room/")
		expect(new URL(link).search).toBe("")
		expect(link).not.toContain("secret")
	})
	it("allows setup-only links to seed new rooms, without inheriting an old room or invitation", () => {
		const link = createRoomUrl("https://example.test/#room=old&sync-bundle=expired", { setup })
		expect(readRoomUrl(link)).toEqual({ setup })
		expect(link).not.toContain("sync-bundle")
		expect(link).not.toContain("room=old")
	})
	it("accepts explicit query parameters and leaves ordinary application bookmarks alone", () => {
		const url = new URL(createRoomUrl("https://example.test/", { roomId: "classroom", setup }))
		url.search = url.hash.slice(1)
		url.hash = ""
		expect(readRoomUrl(url.href)).toEqual({ roomId: "classroom", setup })
		expect(readRoomUrl("https://example.test/#harmoneasy-state=existing")).toEqual({})
	})
	it("rejects broken setups, invalid names and unsupported transport values", () => {
		expect(() => readRoomUrl("https://example.test/#room=bad/name")).toThrow()
		expect(() => readRoomUrl("https://example.test/#room-setup=corrupted")).toThrow()
		expect(() =>
			createRoomUrl("https://example.test", { setup: { ...setup, bpm: -1 } })
		).toThrow()
		expect(() =>
			createRoomUrl("https://example.test", { setup: { ...setup, workspace: "invalid" } })
		).toThrow()
	})
	it.each([
		["https://example.test/", "/room/"],
		["https://example.test/harmoneasy/", "/harmoneasy/room/"],
		["https://example.test/harmoneasy/index.html", "/harmoneasy/room/"],
		["https://example.test/harmoneasy/room", "/harmoneasy/room/"],
		["https://example.test/harmoneasy/room/", "/harmoneasy/room/"],
		["https://example.test/harmoneasy/room/index.html", "/harmoneasy/room/"]
	])(
		"uses the room entry point from %s without nesting room directories",
		(location, pathname) => {
			const url = createRoomUrl(location, { roomId: "our-jam", setup })
			expect(new URL(url).pathname).toBe(pathname)
			expect(createRoomUrl(url, { roomId: "our-jam", setup })).toBe(url)
			expect(readRoomUrl(url)).toEqual({ roomId: "our-jam", setup })
		}
	)
	it("continues reading previously shared root-page URLs", () => {
		const current = new URL(
			createRoomUrl("https://example.test/harmoneasy/", { roomId: "old-room", setup })
		)
		current.pathname = "/harmoneasy/"
		expect(readRoomUrl(current.href)).toEqual({ roomId: "old-room", setup })
	})
	it("preserves the native Electron entry point for file URLs", () => {
		const url = createRoomUrl("file:///C:/Harmoneasy/dist-electron/index.html", { setup })
		expect(new URL(url).pathname).toBe("/C:/Harmoneasy/dist-electron/index.html")
		expect(readRoomUrl(url)).toEqual({ setup })
	})
})