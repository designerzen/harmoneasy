import LZString from "lz-string"

const SETUP_KEY = "room-setup"
const ROOM_KEY = "room"
const MAX_SETUP = 1024 * 1024

export interface RoomSetup {
	version: 1
	workspace: string
	bpm: number
	swing: number
	divisions: number
	bars: number
}

export interface RoomInvitation {
	roomId?: string
	setup?: RoomSetup
}

export function isRoomSetup(value: unknown): value is RoomSetup {
	if (!value || typeof value !== "object") {
		return false
	}
	const setup = value as RoomSetup
	return (
		setup.version === 1 &&
		typeof setup.workspace === "string" &&
		setup.workspace.startsWith("workspace:") &&
		setup.workspace.length <= MAX_SETUP &&
		Number.isFinite(setup.bpm) &&
		setup.bpm >= 10 &&
		setup.bpm <= 303 &&
		Number.isFinite(setup.swing) &&
		setup.swing >= 0 &&
		setup.swing <= 1 &&
		Number.isInteger(setup.divisions) &&
		setup.divisions >= 1 &&
		setup.divisions <= 960 &&
		Number.isInteger(setup.bars) &&
		setup.bars >= 1 &&
		setup.bars <= 32
	)
}

export function roomName(value: string): string {
	if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value)) {
		throw new Error(
			"Use a room name of 1–64 lowercase letters, numbers, dots, hyphens or underscores."
		)
	}
	return value
}

export function readRoomUrl(location: string): RoomInvitation {
	const url = new URL(location)
	const fragment = new URLSearchParams(url.hash.slice(1))
	const id = fragment.get(ROOM_KEY) ?? url.searchParams.get(ROOM_KEY)
	const encoded = fragment.get(SETUP_KEY) ?? url.searchParams.get(SETUP_KEY)
	const result: RoomInvitation = {}
	if (id !== null) {
		result.roomId = roomName(id)
	}
	if (encoded !== null) {
		if (!encoded || encoded.length > MAX_SETUP) {
			throw new Error("The setup in this link is too large or empty.")
		}
		const decoded = LZString.decompressFromEncodedURIComponent(encoded)
		if (!decoded || decoded.length > MAX_SETUP + 1024) {
			throw new Error("Invalid setup link.")
		}
		const setup: unknown = JSON.parse(decoded)
		if (!isRoomSetup(setup)) {
			throw new Error("Invalid setup link.")
		}
		result.setup = setup
	}
	return result
}

/** Fragments keep setups out of web server requests and work on GitHub Pages. */
export function createRoomUrl(location: string, invitation: RoomInvitation): string {
	const url = new URL(location)
	if (url.protocol === "http:" || url.protocol === "https:") {
		const directory = url.pathname.replace(/\/index\.html$/, "/").replace(/\/$/, "")
		url.pathname = directory.endsWith("/room") ? `${directory}/` : `${directory}/room/`
	}
	url.search = ""
	const fragment = new URLSearchParams()
	if (invitation.roomId !== undefined) {
		fragment.set(ROOM_KEY, roomName(invitation.roomId))
	}
	if (invitation.setup !== undefined) {
		if (!isRoomSetup(invitation.setup)) {
			throw new Error("Cannot share an invalid room setup.")
		}
		fragment.set(
			SETUP_KEY,
			LZString.compressToEncodedURIComponent(JSON.stringify(invitation.setup))
		)
	}
	url.hash = fragment.toString()
	return url.href
}