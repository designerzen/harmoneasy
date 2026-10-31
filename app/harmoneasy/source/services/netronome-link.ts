import { createRoomConnection, ROOM_PROTOCOL } from "./room-connection"
import { RoomWorkspace } from "./room-workspace"
import type IOChainManager from "audiobus/io/IO-chain-manager"
import { EVENT_CLICK, EVENT_PAGE_HIDE, EVENT_TRANSPORT_CHANGED } from "audiobus/event-constants"
import { selectField } from "./music-tools-dom"
import QRCode from "qrcode"
import LZString from "lz-string"
import type { ClockSource } from "./clock-source"
import { createRoomUrl, readRoomUrl, roomName, type RoomSetup } from "./room-url"

export function readSyncBundle(value: string) {
	const text = value.trim()
	const payload = /^https?:\/\//i.test(text)
		? new URLSearchParams(new URL(text).hash.slice(1)).get("sync-bundle")
		: text
	if (!payload || payload.length > 32000) {
		throw new Error("Paste a shared room invitation or reply link.")
	}
	const decoded = LZString.decompressFromEncodedURIComponent(payload)
	const bundle = decoded && JSON.parse(decoded)
	if (
		bundle?.protocol !== ROOM_PROTOCOL ||
		["roomId", "peerId", "connectionId"].some(
			(key) => typeof bundle[key] !== "string" || !/^[a-zA-Z0-9-]{1,128}$/.test(bundle[key])
		) ||
		!bundle?.description ||
		!["offer", "answer"].includes(bundle.description.type) ||
		typeof bundle.description.sdp !== "string" ||
		bundle.description.sdp.length > 32000
	) {
		throw new Error(
			"This is not a shared room connection link. Create a new invitation in Shared room."
		)
	}
	return bundle
}

export function createSyncUrl(bundle: unknown, location: string, setup?: RoomSetup) {
	const id = (bundle as { roomId?: string })?.roomId
	const url = new URL(createRoomUrl(location, { roomId: id, setup }))
	const fragment = new URLSearchParams(url.hash.slice(1))
	fragment.set("sync-bundle", LZString.compressToEncodedURIComponent(JSON.stringify(bundle)))
	url.hash = fragment.toString()
	return url.href
}

export function createNetronomeLink(
	timer: any,
	isPlaying: () => boolean,
	options: {
		source?: ClockSource
		autoStart?: boolean
		onSharedRequested?: () => Promise<void>
		manager?: IOChainManager
		onLeaveRequested?: () => Promise<void>
		onConductorChanged?: (conductor: boolean) => void
		roomId?: string
	} = {}
) {
	const button = document.getElementById("netronome-link") as HTMLButtonElement
	const preview = document.getElementById("netronome-qr-preview") as HTMLImageElement
	const dialog = document.getElementById("netronome-dialog") as HTMLDialogElement
	const qr = document.getElementById("netronome-qr") as HTMLImageElement
	const local = document.getElementById("netronome-local-link") as HTMLTextAreaElement
	const remote = document.getElementById("netronome-remote-link") as HTMLTextAreaElement
	const status = document.getElementById("netronome-status")!
	const instructions = document.getElementById("netronome-instructions")!
	const apply = document.getElementById("netronome-apply") as HTMLButtonElement
	const copy = document.getElementById("netronome-copy") as HTMLButtonElement
	const regenerate = document.getElementById("netronome-regenerate") as HTMLButtonElement
	const room = document.getElementById("netronome-room-name") as HTMLInputElement
	const roomLink = document.getElementById("netronome-room-link") as HTMLTextAreaElement
	const sharing = selectField(dialog, "Follow the room", [
		{ name: "Whole workspace and notes", value: "workspace" },
		{ name: "Harmony only — keep my instruments", value: "harmony" }
	])
	const initialInvitation = readRoomUrl(window.location.href)
	const initialBundle = new URLSearchParams(window.location.hash.slice(1)).get("sync-bundle")
	if (initialBundle) {
		try {
			if (readSyncBundle(initialBundle).harmonyOnly === true) {
				sharing.value = "harmony"
			}
		} catch {
			/* Existing invitation validation reports malformed links. */
		}
	}
	room.value = options.roomId ?? initialInvitation.roomId ?? crypto.randomUUID()
	let controller: ReturnType<typeof createRoomConnection> | undefined
	let workspace: RoomWorkspace | undefined
	let roomStatus = ""
	let applyingTransport = false
	let linked = false
	let busy = false
	let follower = false
	let source: ClockSource = options.source ?? "internal"
	let queue: Promise<void> = Promise.resolve()
	let pending = 0
	type Step = "choose" | "join" | "invite" | "reply" | "connected"
	let step: Step = source === "shared" ? "join" : "choose"
	const showStep = (next: Step) => {
		step = next
		const joining = next === "join"
		const inviting = next === "invite"
		const replying = next === "reply"
		document.getElementById("netronome-choice")!.hidden = next !== "choose"
		document.getElementById("netronome-flow")!.hidden = next === "choose"
		document.getElementById("netronome-outgoing")!.hidden = !inviting && !replying
		document.getElementById("netronome-incoming")!.hidden = !joining && !inviting
		document.getElementById("netronome-back")!.hidden =
			next === "choose" || next === "connected"
		regenerate.hidden = next !== "connected" || follower
		document.getElementById("netronome-leave")!.hidden = !linked && !replying
		status.hidden = next === "choose"
		document.getElementById("netronome-step")!.textContent = {
			choose: "",
			join: "Join a room",
			invite: "Invite a player",
			reply: "Send your reply",
			connected: "You’re connected"
		}[next]
		instructions.textContent = {
			choose: "",
			join: "Paste an invitation from the person starting the room. Joining uses their sounds and setup.",
			invite: "1. Send this invitation, or have the other player scan it.\n2. Paste the reply they send back below.",
			reply: "Send this reply back to the person who invited you. Keep this page open.",
			connected: "Play together. Notes, tempo and setup are shared."
		}[next]
		document.getElementById("netronome-copy")!.textContent = replying
			? "Copy reply"
			: "Copy invitation"
		document.getElementById("netronome-remote-label")!.textContent = inviting
			? "2. Reply from the other player"
			: "Invitation link"
		remote.placeholder = inviting ? "Paste reply link" : "Paste invitation link"
		apply.textContent = inviting ? "Connect player" : "Join room"
	}

	const hideQR = () => {
		qr.hidden = preview.hidden = true
	}
	const updateSourceUI = () => {
		if (source !== "internal") {
			hideQR()
		}
		button.hidden = source === "midi" || source === "manual"
		regenerate.disabled = busy || source !== "internal"
	}

	const showError = (error: unknown) => {
		roomStatus = error instanceof Error ? error.message : String(error)
		status.hidden = false
		status.textContent = roomStatus
	}
	const captureSetup = (): RoomSetup | undefined =>
		options.manager && sharing.value !== "harmony"
			? {
					version: 1,
					workspace: options.manager.exportWorkspace(),
					bpm: timer.BPM,
					swing: timer.swing,
					divisions: timer.divisions,
					bars: timer.bars
				}
			: undefined
	const setupUrl = (includeRoom = true) =>
		createRoomUrl(window.location.href, {
			roomId: includeRoom ? (controller?.roomId ?? roomName(room.value)) : undefined,
			setup: captureSetup()
		})
	const rememberRoom = (current: NonNullable<typeof controller>) => {
		if (!current.roomId) {
			return
		}
		const previous = new URLSearchParams(window.location.hash.slice(1))
		const url = new URL(
			createRoomUrl(window.location.href, { roomId: current.roomId, setup: captureSetup() })
		)
		const fragment = new URLSearchParams(url.hash.slice(1))
		const savedState = previous.get("harmoneasy-state")
		if (savedState) {
			fragment.set("harmoneasy-state", savedState)
		}
		url.hash = fragment.toString()
		window.history.replaceState(window.history.state, "", url)
	}
	const drawQR = async (url: string, current = controller) => {
		try {
			const image = await QRCode.toDataURL(url, {
				width: 512,
				margin: 4,
				errorCorrectionLevel: "L"
			})
			if (controller !== current) {
				return
			}
			qr.src = preview.src = image
			qr.hidden = preview.hidden = false
			return true
		} catch {
			hideQR()
			status.textContent = "This setup is too large for one QR code. Copy its link instead."
			return false
		}
	}
	const render = async (bundle: unknown, current = controller) => {
		const tagged =
			sharing.value === "harmony" ? { ...(bundle as object), harmonyOnly: true } : bundle
		// The data channel sends the workspace after pairing. Keeping it out of the
		// invitation lets a joining player choose harmony-only before any restore.
		const url = createSyncUrl(tagged, window.location.href)
		local.value = url
		if (controller?.roomId) {
			room.value = controller.roomId
		}
		roomLink.value = setupUrl()
		if (source !== "internal") {
			hideQR()
			return true
		}
		const drawn = await drawQR(url, current)
		if (source !== "internal") {
			hideQR()
		}
		return drawn
	}
	const run = (operation: () => Promise<void>): Promise<void> => {
		pending++
		busy = true
		apply.disabled = regenerate.disabled = true
		copy.disabled = true
		const next = queue.then(async () => {
			try {
				await operation()
			} catch (error) {
				showError(error)
			} finally {
				busy = --pending > 0
				apply.disabled = busy
				copy.disabled = busy || !local.value
				updateSourceUI()
			}
		})
		queue = next
		return next
	}
	const setFollowerControls = (disabled: boolean) => {
		for (const id of [
			"tempo",
			"swing",
			"btn-tempo-up",
			"btn-tempo-down",
			"btn-transport-start",
			"btn-transport-stop",
			"btn-transport-reset"
		]) {
			const control = document.getElementById(id) as
				| HTMLButtonElement
				| HTMLInputElement
				| null
			if (control) {
				control.disabled = disabled
			}
		}
	}
	const create = async (role: "leader" | "follower") => {
		if (controller) {
			await workspace?.destroy()
			workspace = undefined
			await controller.destroy()
			if (source === "internal" && isPlaying()) {
				await timer.start()
			}
		}
		linked = false
		follower = role === "follower"
		setFollowerControls(follower)
		roomStatus = ""
		controller = createRoomConnection(timer, { role, roomId: roomName(room.value) })
		const current = controller
		current.onError = showError
		current.onTransportChange = () => {
			applyingTransport = true
			try {
				options.manager?.dispatchEvent(new Event(EVENT_TRANSPORT_CHANGED))
			} finally {
				applyingTransport = false
			}
		}
		current.onRoleChange = (conductor) => {
			if (controller !== current) {
				return
			}
			follower = !conductor
			source = conductor ? "internal" : "shared"
			options.onConductorChanged?.(conductor)
			setFollowerControls(!conductor)
			hideQR()
			local.value = ""
			updateSourceUI()
			showStep(linked ? "connected" : step)
		}
		if (options.manager) {
			workspace = new RoomWorkspace(
				current,
				options.manager,
				() => timer.now,
				(message) => {
					roomStatus = message
					status.textContent = message
				},
				sharing.value === "harmony" ? "harmony" : "workspace"
			)
		}
		current.onStateChange = (state: { connected: boolean; locked: boolean }) => {
			if (controller !== current) {
				return
			}
			status.textContent = state.connected
				? roomStatus ||
					(state.locked || !follower
						? "Connected to room"
						: "Connected — synchronizing clock…")
				: roomStatus || "Waiting for the other browser"
			if (state.connected && !linked) {
				sharing.disabled = true
				linked = true
				remote.value = ""
				showStep("connected")
				if (source === "internal" && !follower && isPlaying()) {
					void current.startSynchronized().catch(showError)
				}
			}
		}
		return current
	}
	const host = async () => {
		if (source !== "internal") {
			return
		}
		qr.hidden = preview.hidden = true
		local.value = ""
		status.textContent = "Preparing connection QR…"
		const current = controller && !follower ? controller : await create("leader")
		rememberRoom(current)
		const drawn = await render(await current.createOfferBundle())
		if (drawn !== false) {
			status.textContent = linked ? "Invitation ready for another player" : "Ready to connect"
		}
	}
	const accept = async (value: string) => {
		const bundle = readSyncBundle(value)
		if (bundle.description.type === "offer") {
			source = "shared"
			updateSourceUI()
			status.textContent = "Preparing reply…"
			const current = await create("follower")
			await current.applyOfferBundle(bundle)
			rememberRoom(current)
			await render(await current.createAnswerBundle())
			remote.value = ""
			showStep("reply")
			status.textContent = "Waiting for the other player to connect…"
		} else {
			if (!controller || follower) {
				throw new Error("Open the original browser and paste the reply there.")
			}
			await controller.applyAnswerBundle(bundle)
			status.textContent = "Connecting…"
		}
	}
	const connect = async (value: string) => {
		apply.disabled = true
		try {
			const bundle = readSyncBundle(value)
			if (bundle.description.type === "offer") {
				if (bundle.harmonyOnly === true) {
					sharing.value = "harmony"
				}
				await options.onSharedRequested?.()
			}
			await run(() => accept(value))
		} catch (error) {
			apply.disabled = busy
			showError(error)
		}
	}
	button.disabled = false
	button.addEventListener(EVENT_CLICK, () => dialog.showModal())
	document.getElementById("netronome-close")!.addEventListener(EVENT_CLICK, () => dialog.close())
	document.getElementById("netronome-start")!.addEventListener(EVENT_CLICK, () => {
		showStep("invite")
		if (!controller || follower || !local.value) {
			void run(host)
		}
	})
	document.getElementById("netronome-join")!.addEventListener(EVENT_CLICK, () => {
		showStep("join")
		status.textContent = ""
		remote.focus()
	})
	document
		.getElementById("netronome-back")!
		.addEventListener(EVENT_CLICK, () => showStep(linked ? "connected" : "choose"))
	apply.addEventListener(EVENT_CLICK, () => void connect(remote.value))
	regenerate.addEventListener(EVENT_CLICK, () => {
		remote.value = ""
		showStep("invite")
		void run(host)
	})
	document.getElementById("netronome-copy")!.addEventListener(EVENT_CLICK, async () => {
		try {
			await navigator.clipboard.writeText(local.value)
			status.textContent =
				step === "reply"
					? "Reply copied — send it back to the person who invited you."
					: "Invitation copied — send it to the other player."
		} catch {
			local.select()
			status.textContent = "Select and copy the connection link above."
		}
	})
	const share = async (includeRoom: boolean) => {
		try {
			const url = setupUrl(includeRoom)
			roomLink.value = url
			try {
				await navigator.clipboard.writeText(url)
				status.hidden = false
				status.textContent = includeRoom
					? "Setup copied. Use “Start a room” to invite someone to play."
					: "Setup copied — opening it starts a fresh room."
			} catch {
				roomLink.hidden = false
				roomLink.select()
				status.hidden = false
				status.textContent = "Select and copy the setup link."
			}
		} catch (error) {
			showError(error)
		}
	}
	document
		.getElementById("netronome-copy-room")!
		.addEventListener(EVENT_CLICK, () => void share(true))
	document
		.getElementById("netronome-copy-setup")!
		.addEventListener(EVENT_CLICK, () => void share(false))
	document.getElementById("netronome-new-room")!.addEventListener(EVENT_CLICK, () => {
		void (async () => {
			roomName(room.value)
			if (room.value === controller?.roomId) {
				room.value = crypto.randomUUID()
			}
			if (follower && options.onLeaveRequested) {
				await options.onLeaveRequested()
			}
			await controls.setSource("internal")
			showStep("invite")
		})().catch(showError)
	})
	// Capture the scanned invitation before persisting clock settings changes the URL.
	const incoming = new URLSearchParams(window.location.hash.slice(1)).get("sync-bundle")
	const initialize = async () => {
		if (incoming) {
			dialog.showModal()
			await connect(incoming)
		} else if (!controller && source === "internal") {
			await run(host)
		}
	}
	updateSourceUI()
	showStep(step)
	if (options.autoStart !== false) {
		void initialize()
	}
	window.addEventListener(
		EVENT_PAGE_HIDE,
		() => {
			void workspace?.destroy()
			void controller?.destroy()
		},
		{ once: true }
	)
	const controls = {
		initialize,
		async setSource(nextSource: ClockSource) {
			source = nextSource
			hideQR()
			updateSourceUI()
			await run(async () => {
				const old = controller
				controller = undefined
				await workspace?.destroy()
				workspace = undefined
				sharing.disabled = false
				roomStatus = ""
				linked = follower = false
				await old?.destroy()
				local.value = ""
				setFollowerControls(source !== "internal")
				if (source === "internal") {
					await host()
					showStep("choose")
				} else {
					showStep("join")
					status.textContent = ""
					if (source === "midi" || source === "manual") {
						dialog.close()
					}
				}
			})
		},
		tempoChanged() {
			if (source === "internal" && linked && !follower) {
				controller?.broadcastTempoUpdate()
			}
		},
		silence() {
			workspace?.silence()
		},
		transportChanged() {
			if (applyingTransport || source !== "internal" || !linked || follower || !controller) {
				return
			}
			void (
				isPlaying() ? controller.startSynchronized() : controller.stopSynchronized()
			).catch(showError)
		},
		get isFollower() {
			return follower
		}
	}
	document.getElementById("netronome-leave")!.addEventListener(EVENT_CLICK, () => {
		void (
			follower && options.onLeaveRequested
				? options.onLeaveRequested()
				: controls.setSource("internal")
		).catch(showError)
	})
	return controls
}