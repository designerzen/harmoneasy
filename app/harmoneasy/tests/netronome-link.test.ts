// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import {
	createNetronomeLink,
	createSyncUrl,
	readSyncBundle
} from "../source/services/netronome-link"
import { readRoomUrl } from "../source/services/room-url"
import { EVENT_TRANSPORT_CHANGED } from "../../../packages/audiobus/events/event-constants"

const identity = {
	protocol: "harmoneasy-room/1",
	roomId: "host",
	peerId: "host",
	connectionId: "invitation"
}
const offer = { ...identity, description: { type: "offer", sdp: "v=0\r\na=offer" } }
const answer = {
	...identity,
	peerId: "follower",
	description: { type: "answer", sdp: "v=0\r\na=answer" }
}
const mocks = vi.hoisted(() => ({
	controllers: [] as any[],
	qr: vi.fn(async () => "data:image/png;base64,qr")
}))
vi.mock("qrcode", () => ({ default: { toDataURL: mocks.qr } }))
vi.mock("../source/services/room-connection", () => ({
	ROOM_PROTOCOL: "harmoneasy-room/1",
	createRoomConnection: vi.fn((_timer, options) => {
		const controller = {
			roomId: options.roomId,
			options,
			destroy: vi.fn(async () => {}),
			createOfferBundle: vi.fn(async () => offer),
			applyOfferBundle: vi.fn(async () => {}),
			createAnswerBundle: vi.fn(async () => answer),
			applyAnswerBundle: vi.fn(async () => {}),
			startSynchronized: vi.fn(async () => {}),
			stopSynchronized: vi.fn(async () => {}),
			broadcastTempoUpdate: vi.fn(),
			onStateChange: undefined
		}
		mocks.controllers.push(controller)
		return controller
	})
}))
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const startHost = async () => {
	element<HTMLButtonElement>("netronome-start").click()
	await idle()
}
const idle = () =>
	vi.waitFor(() => expect(element<HTMLButtonElement>("netronome-apply").disabled).toBe(false))

beforeEach(() => {
	document.body.innerHTML = readFileSync("index.html", "utf8").replace(
		/<script\b[^>]*>[\s\S]*?<\/script>/gi,
		""
	)
	window.history.replaceState(null, "", "http://localhost:3000/")
	mocks.controllers.length = 0
	vi.clearAllMocks()
})

describe("Netronome connection links", () => {
	it("validates room names with the HTML pattern's Unicode sets flag", () => {
		const pattern = element<HTMLInputElement>("netronome-room-name").pattern
		const expression = new RegExp(`^(?:${pattern})$`, "v")
		for (const name of ["jam", "our-jam", "room_1.2"]) {
			expect(expression.test(name)).toBe(true)
		}
		for (const name of ["", "-jam", "bad/name", "A-room", "a".repeat(65)]) {
			expect(expression.test(name)).toBe(false)
		}
	})

	it("does not create a peer or rewrite a preset URL during solo startup", async () => {
		const url = "http://localhost:3000/presets/genres/ambient/"
		window.history.replaceState(null, "", url)
		const link = createNetronomeLink({}, () => false, { autoStart: false })
		await link.setSource("internal")
		await link.initialize()
		expect(mocks.controllers).toHaveLength(0)
		expect(mocks.qr).not.toHaveBeenCalled()
		expect(window.location.href).toBe(url)
		await startHost()
		expect(mocks.controllers[0].createOfferBundle).toHaveBeenCalledOnce()
	})

	it("starts with two choices and guides the host from invitation to connected", async () => {
		createNetronomeLink({}, () => false)
		await idle()
		expect(element("netronome-choice").hidden).toBe(false)
		expect(element("netronome-flow").hidden).toBe(true)
		expect(element<HTMLDetailsElement>("netronome-options").open).toBe(false)
		await startHost()
		expect(element("netronome-choice").hidden).toBe(true)
		expect(element("netronome-outgoing").hidden).toBe(false)
		expect(element("netronome-incoming").hidden).toBe(false)
		expect(element("netronome-copy").textContent).toBe("Copy invitation")
		expect(element("netronome-apply").textContent).toBe("Connect player")
		mocks.controllers[0].onStateChange({ connected: true, locked: true })
		expect(element("netronome-step").textContent).toBe("You’re connected")
		expect(element("netronome-outgoing").hidden).toBe(true)
		expect(element("netronome-incoming").hidden).toBe(true)
		expect(element("netronome-regenerate").hidden).toBe(false)
		expect(element("netronome-leave").hidden).toBe(false)
	})

	it("shows only the invitation input when joining, then only the reply to send back", async () => {
		createNetronomeLink({}, () => false)
		await idle()
		element<HTMLButtonElement>("netronome-join").click()
		expect(element("netronome-outgoing").hidden).toBe(true)
		expect(element("netronome-incoming").hidden).toBe(false)
		expect(element("netronome-apply").textContent).toBe("Join room")
		element<HTMLTextAreaElement>("netronome-remote-link").value = createSyncUrl(
			offer,
			window.location.href
		)
		element<HTMLButtonElement>("netronome-apply").click()
		await idle()
		expect(element("netronome-step").textContent).toBe("Send your reply")
		expect(element("netronome-copy").textContent).toBe("Copy reply")
		expect(element("netronome-outgoing").hidden).toBe(false)
		expect(element("netronome-incoming").hidden).toBe(true)
		expect(element("netronome-regenerate").hidden).toBe(true)
	})

	it("round-trips the session bundle without including workspace state", () => {
		const url = createSyncUrl(offer, "https://example.com/harmoneasy/?io=private&tempo=90#old")
		expect(new URL(url).search).toBe("")
		expect(new URL(url).pathname).toBe("/harmoneasy/room/")
		expect(readSyncBundle(url)).toEqual(offer)
		expect(
			readSyncBundle(new URLSearchParams(new URL(url).hash.slice(1)).get("sync-bundle")!)
		).toEqual(offer)
		expect(() => readSyncBundle("invalid")).toThrow()
		expect(() =>
			readSyncBundle(createSyncUrl({ description: { type: "answer" } }, url))
		).toThrow()
	})

	it("shows a live offer QR and completes the host side with a reply", async () => {
		let playing = true
		const link = createNetronomeLink({}, () => playing)
		await idle()
		await startHost()
		expect(mocks.controllers[0].options.role).toBe("leader")
		expect(element<HTMLImageElement>("netronome-qr-preview").hidden).toBe(false)
		expect(readSyncBundle(element<HTMLTextAreaElement>("netronome-local-link").value)).toEqual(
			offer
		)
		element<HTMLTextAreaElement>("netronome-remote-link").value = createSyncUrl(
			answer,
			window.location.href
		)
		element<HTMLButtonElement>("netronome-apply").click()
		await idle()
		const controller = mocks.controllers[0]
		expect(controller.applyAnswerBundle).toHaveBeenCalledWith(answer)
		controller.onStateChange({ connected: true, locked: true })
		expect(controller.startSynchronized).toHaveBeenCalledOnce()
		link.tempoChanged()
		expect(controller.broadcastTempoUpdate).toHaveBeenCalledOnce()
		playing = false
		link.transportChanged()
		expect(controller.stopSynchronized).toHaveBeenCalledOnce()
	})

	it("accepts a scanned offer URL and returns a reply for the original browser", async () => {
		window.history.replaceState(null, "", createSyncUrl(offer, window.location.href))
		const link = createNetronomeLink({}, () => true)
		await idle()
		expect(link.isFollower).toBe(true)
		expect(element<HTMLDialogElement>("netronome-dialog").open).toBe(true)
		expect(mocks.controllers[0].applyOfferBundle).toHaveBeenCalledWith(offer)
		expect(readSyncBundle(element<HTMLTextAreaElement>("netronome-local-link").value)).toEqual(
			answer
		)
		expect(element<HTMLInputElement>("tempo").disabled).toBe(true)
		link.tempoChanged()
		expect(mocks.controllers[0].broadcastTempoUpdate).not.toHaveBeenCalled()
	})

	it("keeps the live offer when a malformed reply is pasted", async () => {
		createNetronomeLink({}, () => true)
		await idle()
		await startHost()
		element<HTMLTextAreaElement>("netronome-remote-link").value = "invalid"
		element<HTMLButtonElement>("netronome-apply").click()
		await idle()
		expect(mocks.controllers[0].applyAnswerBundle).not.toHaveBeenCalled()
		expect(mocks.controllers[0].destroy).not.toHaveBeenCalled()
		expect(element("netronome-status").textContent).not.toBe("Connecting…")
	})
	it("hides QR codes and destroys the sharing session for every external source, waits for an invitation after returning to Internal", async () => {
		const link = createNetronomeLink({}, () => false)
		await idle()
		await startHost()
		const controller = mocks.controllers[0]
		for (const source of ["midi", "manual", "shared"] as const) {
			await link.setSource(source)
			const room = element<HTMLButtonElement>("netronome-link")
			expect(room.hidden).toBe(false)
			expect(room.disabled).toBe(source !== "shared")
			expect(element<HTMLImageElement>("netronome-qr-preview").hidden).toBe(true)
			expect(element<HTMLImageElement>("netronome-qr").hidden).toBe(true)
			expect(element<HTMLButtonElement>("netronome-regenerate").disabled).toBe(true)
		}
		expect(controller.destroy).toHaveBeenCalledOnce()
		await link.setSource("internal")
		expect(mocks.controllers).toHaveLength(1)
		expect(element<HTMLImageElement>("netronome-qr-preview").hidden).toBe(true)
		await startHost()
		expect(element<HTMLImageElement>("netronome-qr-preview").hidden).toBe(false)
		expect(element<HTMLButtonElement>("netronome-regenerate").disabled).toBe(false)
	})
	it("joins a room in Shared mode using a reply link without showing a follower QR", async () => {
		const requested = vi.fn(async () => {})
		const link = createNetronomeLink({}, () => false, {
			source: "shared",
			onSharedRequested: requested
		})
		await idle()
		expect(mocks.controllers).toHaveLength(0)
		element<HTMLTextAreaElement>("netronome-remote-link").value = createSyncUrl(
			offer,
			window.location.href
		)
		element<HTMLButtonElement>("netronome-apply").click()
		await vi.waitFor(() => expect(link.isFollower).toBe(true))
		await idle()
		expect(requested).toHaveBeenCalledOnce()
		expect(readSyncBundle(element<HTMLTextAreaElement>("netronome-local-link").value)).toEqual(
			answer
		)
		expect(element<HTMLImageElement>("netronome-qr").hidden).toBe(true)
		expect(mocks.qr).not.toHaveBeenCalled()
	})
	it("retains a scanned invitation when saving the chosen source removes the URL hash", async () => {
		window.history.replaceState(null, "", createSyncUrl(offer, window.location.href))
		const link = createNetronomeLink({}, () => false, { source: "shared", autoStart: false })
		window.history.replaceState(null, "", "http://localhost:3000/?clockSource=shared")
		await link.initialize()
		expect(link.isFollower).toBe(true)
		expect(mocks.controllers[0].applyOfferBundle).toHaveBeenCalledWith(offer)
	})
	it("invites another player without destroying the current room", async () => {
		createNetronomeLink({}, () => true)
		await idle()
		await startHost()
		const controller = mocks.controllers[0]
		controller.onStateChange({ connected: true, locked: true })
		element<HTMLButtonElement>("netronome-regenerate").click()
		await idle()
		expect(mocks.controllers).toHaveLength(1)
		expect(controller.destroy).not.toHaveBeenCalled()
		expect(controller.createOfferBundle).toHaveBeenCalledTimes(2)
	})
	it("rejects legacy tempo-only invitations rather than silently omitting workspace sharing", () => {
		expect(() =>
			readSyncBundle(createSyncUrl({ description: offer.description }, window.location.href))
		).toThrow("shared room")
	})
	it("includes a portable setup alongside the manual pairing data in a QR URL", () => {
		const setup = {
			version: 1 as const,
			workspace: "workspace:snapshot",
			bpm: 130,
			swing: 0.3,
			divisions: 24,
			bars: 4
		}
		const url = createSyncUrl(offer, "https://example.test/harmoneasy/", setup)
		expect(readRoomUrl(url)).toEqual({ roomId: "host", setup })
		expect(readSyncBundle(url)).toEqual(offer)
	})
	it("enables conductor controls after succession without destroying the room connection", async () => {
		const changed = vi.fn()
		window.history.replaceState(null, "", createSyncUrl(offer, window.location.href))
		const link = createNetronomeLink({}, () => false, { onConductorChanged: changed })
		await idle()
		const controller = mocks.controllers[0]
		expect(link.isFollower).toBe(true)
		controller.onRoleChange(true)
		expect(changed).toHaveBeenCalledWith(true)
		expect(link.isFollower).toBe(false)
		expect(element<HTMLInputElement>("tempo").disabled).toBe(false)
		expect(element<HTMLButtonElement>("netronome-regenerate").disabled).toBe(false)
		expect(controller.destroy).not.toHaveBeenCalled()
	})
	it("updates transport UI from the shared clock without broadcasting another start or stop", async () => {
		const manager = Object.assign(new EventTarget(), {
			chains: [],
			exportWorkspace: () => "workspace:snapshot"
		})
		const link = createNetronomeLink(
			{ BPM: 120, swing: 0, divisions: 24, bars: 4 },
			() => true,
			{ manager: manager as any }
		)
		await idle()
		await startHost()
		const controller = mocks.controllers[0]
		controller.onStateChange({ connected: true, locked: true })
		controller.startSynchronized.mockClear()
		manager.addEventListener(EVENT_TRANSPORT_CHANGED, () => link.transportChanged())
		controller.onTransportChange()
		expect(controller.startSynchronized).not.toHaveBeenCalled()
		expect(controller.stopSynchronized).not.toHaveBeenCalled()
		link.transportChanged()
		expect(controller.startSynchronized).toHaveBeenCalledOnce()
	})
	it("keeps a usable setup URL when its workspace is too large for a QR code", async () => {
		mocks.qr.mockRejectedValueOnce(new Error("QR capacity exceeded"))
		createNetronomeLink({}, () => false)
		await idle()
		await startHost()
		expect(element<HTMLImageElement>("netronome-qr").hidden).toBe(true)
		expect(element("netronome-status").textContent).toContain("too large")
		expect(readSyncBundle(element<HTMLTextAreaElement>("netronome-local-link").value)).toEqual(
			offer
		)
	})
	it("starts a distinct room, updates its URL, and preserves the current setup", async () => {
		const manager = Object.assign(new EventTarget(), {
			chains: [],
			exportWorkspace: () => "workspace:snapshot"
		})
		createNetronomeLink({ BPM: 126, swing: 0.1, divisions: 24, bars: 4 }, () => false, {
			manager: manager as any
		})
		await idle()
		await startHost()
		const original = readRoomUrl(window.location.href)
		element<HTMLButtonElement>("netronome-new-room").click()
		await vi.waitFor(() => expect(mocks.controllers).toHaveLength(2))
		await idle()
		const fresh = readRoomUrl(window.location.href)
		expect(fresh.roomId).not.toBe(original.roomId)
		expect(fresh.setup).toEqual(original.setup)
		expect(new URLSearchParams(window.location.hash.slice(1)).has("sync-bundle")).toBe(false)
		expect(mocks.controllers[0].destroy).toHaveBeenCalledOnce()
	})
})
