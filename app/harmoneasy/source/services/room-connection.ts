import { NetworkSession } from "netronome"
import {
	EVENT_OPEN,
	EVENT_CLOSE,
	EVENT_MESSAGE,
	EVENT_BUFFERED_AMOUNT_LOW,
	EVENT_ICE_GATHERING_STATE_CHANGE
} from "audiobus/event-constants"

export const ROOM_PROTOCOL = "harmoneasy-room/1"
const FRAME_SIZE = 12000
const MAX_MESSAGE = 2 * 1024 * 1024
const MAX_PLAYERS = 8

export interface RoomBundle {
	protocol: typeof ROOM_PROTOCOL
	roomId: string
	peerId: string
	connectionId: string
	description: RTCSessionDescriptionInit
}

interface Peer {
	id: string
	pc: RTCPeerConnection
	channel?: RTCDataChannel
	queue: string[]
	queuedBytes: number
	incoming?: { id: number; count: number; text: string }
	sequence: number
}

/** Manual offer/reply pairing; clock and application data use the same P2P channel. */
export class RoomConnection {
	readonly id = crypto.randomUUID()
	roomId: string
	conductorId: string
	private members: string[]
	private term = 0
	private transitioning = false
	private transition: Promise<void> = Promise.resolve()
	private pendingMesh = new Set<string>()
	private peers = new Map<string, Peer>()
	private session?: NetworkSession
	private starting?: Promise<void>
	private destroyed = false
	private rtcConfig: RTCConfiguration
	private waits = new Set<() => void>()
	onStateChange?: (state: { connected: boolean; locked: boolean; players: number }) => void
	onPeerOpen?: (id: string) => void
	onPeerClose?: (id: string) => void
	onData?: (id: string, message: unknown) => void
	onError?: (error: unknown) => void
	onClockChange?: () => void
	onTransportChange?: () => void
	onConductorChange?: (id: string, conductor: boolean) => void
	onRoleChange?: (conductor: boolean) => void

	get role(): "leader" | "follower" {
		return this.conductorId === this.id ? "leader" : "follower"
	}
	get connectedPeerIds() {
		return [...this.peers.values()]
			.filter((peer) => peer.channel?.readyState === "open")
			.map((peer) => peer.id)
	}
	get memberIds() {
		return [...this.members]
	}
	get meshReady() {
		return this.members.every((id) => id === this.id || this.connectedPeerIds.includes(id))
	}
	private get conductorClock() {
		return this.session?.getState().peers.find((peer) => peer.id === this.conductorId)
	}

	get clockLocked() {
		return (
			!this.transitioning &&
			this.meshReady &&
			(this.role === "leader" || Boolean(this.conductorClock?.locked))
		)
	}
	get leaderTimeMs() {
		return (
			performance.now() + (this.role === "leader" ? 0 : (this.conductorClock?.offsetMs ?? 0))
		)
	}
	get playbackDelayMs() {
		const times =
			this.session
				?.getState()
				.peers.map((peer) => peer.rttMs)
				.filter(Number.isFinite) ?? []
		return Math.min(1000, Math.max(120, ...times.map((time) => time * 1.5)))
	}

	constructor(
		private timer: ConstructorParameters<typeof NetworkSession>[0],
		options: { role: "leader" | "follower"; rtcConfig?: RTCConfiguration; roomId?: string }
	) {
		this.conductorId = options.role === "leader" ? this.id : ""
		this.roomId = options.roomId ?? this.id
		this.members = options.role === "leader" ? [this.id] : []
		this.rtcConfig = options.rtcConfig ?? {
			iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
		}
	}

	private changed() {
		const peers = [...this.peers.values()].filter((peer) => peer.channel?.readyState === "open")
		const locked = this.clockLocked
		this.onStateChange?.({ connected: peers.length > 0, locked, players: peers.length + 1 })
		this.onClockChange?.()
	}

	private ensureSession() {
		return (this.starting ??= (async () => {
			this.session = new NetworkSession(this.timer, {
				peerId: this.id,
				leaderId: this.conductorId,
				send: (id, message) => this.send(id, message),
				onStateChange: () => this.changed(),
				onTransport: (state) => {
					this.timer.isRunning = state.playing
					this.onTransportChange?.()
				}
			})
			await this.session.start()
			if (this.destroyed) {
				return
			}
			if (this.role === "leader") {
				this.session.setTransport({
					playing: false,
					bpm: this.timer.BPM,
					swing: this.timer.swing
				})
			}
		})())
	}

	private peer(connectionId: string, id: string): Peer {
		if (this.destroyed) {
			throw new Error("Room connection is closed.")
		}
		if (this.peers.size >= MAX_PLAYERS - 1) {
			throw new Error("This room is full (8 players).")
		}
		const pc = new RTCPeerConnection(this.rtcConfig)
		const peer: Peer = { id, pc, queue: [], queuedBytes: 0, sequence: 0 }
		this.peers.set(connectionId, peer)
		pc.ondatachannel = ({ channel }) => this.attach(connectionId, peer, channel)
		pc.onconnectionstatechange = () => {
			if (pc.connectionState === "failed") {
				this.onError?.(
					new Error(
						"Peer connection failed. Try a new invitation; this network may require a relay."
					)
				)
				this.remove(connectionId)
			}
		}
		return peer
	}

	private attach(connectionId: string, peer: Peer, channel: RTCDataChannel) {
		if (this.destroyed || peer.channel) {
			channel.close()
			return
		}
		peer.channel = channel
		channel.bufferedAmountLowThreshold = 32768
		channel.addEventListener(EVENT_OPEN, () => {
			void this.ensureSession()
				.then(() => {
					if (this.destroyed || channel.readyState !== "open") {
						return
					}
					this.session!.addPeer(peer.id)
					this.pendingMesh.delete(peer.id)
					if (this.role === "leader" && !this.members.includes(peer.id)) {
						this.members.push(peer.id)
						this.term++
						this.announceMembers()
					}
					this.onPeerOpen?.(peer.id)
					this.changed()
				})
				.catch((error) => {
					this.onError?.(error)
					this.remove(connectionId)
				})
		})
		channel.addEventListener(EVENT_CLOSE, () => this.remove(connectionId))
		channel.addEventListener(EVENT_BUFFERED_AMOUNT_LOW, () => this.flush(peer))
		channel.addEventListener(EVENT_MESSAGE, (event) => {
			if (this.destroyed || typeof event.data !== "string" || event.data.length > 32768) {
				return
			}
			try {
				const message = JSON.parse(event.data)
				if (message?.protocol === ROOM_PROTOCOL && message.type === "chunk") {
					if (
						!Number.isInteger(message.id) ||
						!Number.isInteger(message.index) ||
						!Number.isInteger(message.count) ||
						message.count < 1 ||
						message.count > Math.ceil(MAX_MESSAGE / FRAME_SIZE) ||
						typeof message.text !== "string" ||
						message.text.length > FRAME_SIZE
					) {
						return
					}
					if (message.index === 0) {
						peer.incoming = { id: message.id, count: message.count, text: "" }
					}
					const incoming = peer.incoming
					if (
						!incoming ||
						incoming.id !== message.id ||
						incoming.count !== message.count ||
						message.index !== Math.ceil(incoming.text.length / FRAME_SIZE)
					) {
						return
					}
					incoming.text += message.text
					if (incoming.text.length > MAX_MESSAGE) {
						peer.incoming = undefined
						return
					}
					if (message.index === message.count - 1) {
						peer.incoming = undefined
						this.receive(peer, JSON.parse(incoming.text))
					}
				} else {
					this.receive(peer, message)
				}
			} catch {
				/* Ignore invalid peer frames. */
			}
		})
	}

	private receive(peer: Peer, message: any) {
		if (message?.protocol === "netronome/1") {
			this.session?.receive(peer.id, message)
		} else if (message?.protocol === ROOM_PROTOCOL && message.control) {
			void this.control(peer.id, message.control).catch((error) => this.onError?.(error))
		} else if (message?.protocol === ROOM_PROTOCOL) {
			this.onData?.(peer.id, message.data)
		}
	}

	private announceMembers() {
		const message = {
			protocol: ROOM_PROTOCOL,
			control: {
				type: "members",
				members: this.members,
				term: this.term,
				conductorId: this.conductorId
			}
		}
		for (const id of this.connectedPeerIds) {
			this.send(id, message)
		}
		this.connectMesh()
	}

	private connectMesh() {
		if (this.destroyed) {
			return
		}
		for (const id of this.members) {
			if (this.id >= id || this.connectedPeerIds.includes(id) || this.pendingMesh.has(id)) {
				continue
			}
			this.pendingMesh.add(id)
			const connectionId = crypto.randomUUID()
			const peer = this.peer(connectionId, id)
			this.attach(
				connectionId,
				peer,
				peer.pc.createDataChannel(ROOM_PROTOCOL, { ordered: true })
			)
			void (async () => {
				await peer.pc.setLocalDescription(await peer.pc.createOffer())
				const bundle = await this.gather(connectionId, peer)
				this.routeControl(id, { type: "mesh-offer", bundle })
			})().catch((error) => {
				this.pendingMesh.delete(id)
				this.remove(connectionId)
				this.onError?.(error)
			})
		}
	}

	private routeControl(to: string, data: unknown) {
		if (this.connectedPeerIds.includes(to)) {
			this.send(to, { protocol: ROOM_PROTOCOL, control: data })
		} else {
			this.send(this.conductorId, {
				protocol: ROOM_PROTOCOL,
				control: { type: "relay", to, data }
			})
		}
	}

	private async control(from: string, message: any) {
		if (this.destroyed || !message || typeof message !== "object") {
			return
		}
		if (
			message.type === "members" &&
			from === this.conductorId &&
			Number.isSafeInteger(message.term) &&
			message.term >= this.term &&
			Array.isArray(message.members) &&
			message.members.length > 0 &&
			message.members.length <= MAX_PLAYERS &&
			message.members.every(
				(id: unknown) => typeof id === "string" && /^[a-zA-Z0-9-]{1,128}$/.test(id)
			) &&
			new Set(message.members).size === message.members.length &&
			message.members.includes(this.id) &&
			message.members[0] === message.conductorId
		) {
			this.members = message.members
			this.term = message.term
			if (message.conductorId !== this.conductorId) {
				await this.changeConductor(message.conductorId)
			}
			this.connectMesh()
		} else if (
			message.type === "relay" &&
			this.role === "leader" &&
			this.members.includes(from) &&
			typeof message.to === "string" &&
			this.members.includes(message.to)
		) {
			this.send(message.to, {
				protocol: ROOM_PROTOCOL,
				control: { type: "relayed", from, data: message.data }
			})
		} else if (
			message.type === "relayed" &&
			from === this.conductorId &&
			this.members.includes(message.from)
		) {
			await this.control(message.from, message.data)
		} else if (
			message.type === "mesh-offer" &&
			this.members.includes(from) &&
			!this.connectedPeerIds.includes(from)
		) {
			const bundle = message.bundle as RoomBundle
			if (!this.meshBundle(bundle, from, "offer") || this.peers.has(bundle.connectionId)) {
				return
			}
			this.pendingMesh.add(from)
			const peer = this.peer(bundle.connectionId, from)
			await peer.pc.setRemoteDescription(bundle.description)
			await peer.pc.setLocalDescription(await peer.pc.createAnswer())
			this.routeControl(from, {
				type: "mesh-answer",
				bundle: await this.gather(bundle.connectionId, peer)
			})
		} else if (message.type === "mesh-answer" && this.members.includes(from)) {
			const bundle = message.bundle as RoomBundle
			if (!this.meshBundle(bundle, from, "answer")) {
				return
			}
			const peer = this.peers.get(bundle.connectionId)
			if (peer?.id === from && peer.channel?.readyState !== "open") {
				await peer.pc.setRemoteDescription(bundle.description)
			}
		}
	}

	private meshBundle(bundle: RoomBundle, from: string, type: "offer" | "answer") {
		return (
			bundle?.protocol === ROOM_PROTOCOL &&
			bundle.roomId === this.roomId &&
			bundle.peerId === from &&
			typeof bundle.connectionId === "string" &&
			/^[a-zA-Z0-9-]{1,128}$/.test(bundle.connectionId) &&
			bundle.description?.type === type &&
			typeof bundle.description.sdp === "string" &&
			bundle.description.sdp.length <= 32000
		)
	}

	private changeConductor(id: string) {
		if (id === this.conductorId || this.destroyed) {
			return this.transition
		}
		const previous = this.session?.getState()
		const playing = previous?.playing ?? this.timer.isRunning
		const position = previous?.position ?? 0
		this.conductorId = id
		this.transitioning = true
		this.transition = this.transition
			.then(async () => {
				await this.session?.destroy()
				this.session = undefined
				this.starting = undefined
				if (this.destroyed) {
					return
				}
				await this.ensureSession()
				if (this.destroyed) {
					return
				}
				for (const peerId of this.connectedPeerIds) {
					this.session!.addPeer(peerId)
				}
				if (this.role === "leader") {
					this.session!.setTransport({ playing, position })
				}
				this.transitioning = false
				this.onConductorChange?.(this.conductorId, this.role === "leader")
				this.onRoleChange?.(this.role === "leader")
				this.changed()
			})
			.catch((error) => {
				this.transitioning = false
				this.onError?.(error)
			})
		return this.transition
	}

	private flush(peer: Peer) {
		const channel = peer.channel
		while (
			channel?.readyState === "open" &&
			channel.bufferedAmount < 65536 &&
			peer.queue.length
		) {
			const frame = peer.queue.shift()!
			peer.queuedBytes -= frame.length
			try {
				channel.send(frame)
			} catch (error) {
				this.onError?.(error)
				channel.close()
				break
			}
		}
	}

	private send(id: string, message: unknown): boolean {
		const peer = [...this.peers.values()].find((peer) => peer.id === id)
		if (!peer || peer.channel?.readyState !== "open" || this.destroyed) {
			return false
		}
		const text = JSON.stringify(message)
		if (text.length > MAX_MESSAGE) {
			throw new Error("This workspace is too large to share (2 MB limit).")
		}
		const sequence = ++peer.sequence
		const frames =
			text.length <= FRAME_SIZE
				? [text]
				: Array.from({ length: Math.ceil(text.length / FRAME_SIZE) }, (_, index) =>
						JSON.stringify({
							protocol: ROOM_PROTOCOL,
							type: "chunk",
							id: sequence,
							index,
							count: Math.ceil(text.length / FRAME_SIZE),
							text: text.slice(index * FRAME_SIZE, (index + 1) * FRAME_SIZE)
						})
					)
		const size = frames.reduce((sum, frame) => sum + frame.length, 0)
		if (peer.queuedBytes + size > MAX_MESSAGE * 2) {
			peer.channel.close()
			throw new Error("The peer cannot keep up with the session. Reconnect to resynchronize.")
		}
		peer.queue.push(...frames)
		peer.queuedBytes += size
		this.flush(peer)
		return true
	}

	sendData(id: string, data: unknown) {
		return this.send(id, { protocol: ROOM_PROTOCOL, data })
	}
	broadcastData(data: unknown) {
		for (const peer of this.peers.values()) {
			this.sendData(peer.id, data)
		}
	}

	private async gather(connectionId: string, peer: Peer): Promise<RoomBundle> {
		const pc = peer.pc
		if (pc.iceGatheringState !== "complete") {
			await new Promise<void>((resolve, reject) => {
				const cleanup = () => {
					clearTimeout(timeout)
					pc.removeEventListener(EVENT_ICE_GATHERING_STATE_CHANGE, check)
					this.waits.delete(cancel)
				}
				const cancel = () => {
					cleanup()
					reject(new Error("Invitation cancelled."))
				}
				const check = () => {
					if (pc.iceGatheringState === "complete") {
						cleanup()
						resolve()
					}
				}
				const timeout = setTimeout(() => {
					cleanup()
					// Public STUN may be blocked while direct LAN candidates are already usable.
					if (pc.localDescription?.sdp.includes("a=candidate:")) {
						resolve()
					} else {
						reject(new Error("Connection setup timed out. Try again."))
					}
				}, 10000)
				this.waits.add(cancel)
				pc.addEventListener(EVENT_ICE_GATHERING_STATE_CHANGE, check)
				check()
			})
		}
		if (this.destroyed || !pc.localDescription) {
			throw new Error("Invitation cancelled.")
		}
		return {
			protocol: ROOM_PROTOCOL,
			roomId: this.roomId,
			peerId: this.id,
			connectionId,
			description: pc.localDescription.toJSON()
		}
	}

	async createOfferBundle(): Promise<RoomBundle> {
		if (this.role !== "leader") {
			throw new Error("Only the host can invite players.")
		}
		for (const [id, peer] of this.peers) {
			if (peer.channel?.readyState !== "open") {
				this.remove(id)
			}
		}
		const connectionId = crypto.randomUUID()
		const peer = this.peer(connectionId, connectionId)
		this.attach(connectionId, peer, peer.pc.createDataChannel(ROOM_PROTOCOL, { ordered: true }))
		await peer.pc.setLocalDescription(await peer.pc.createOffer())
		return this.gather(connectionId, peer)
	}

	async applyOfferBundle(bundle: RoomBundle) {
		if (this.role !== "follower" || this.peers.size) {
			throw new Error("Leave the current connection before joining another room.")
		}
		this.roomId = bundle.roomId
		this.conductorId = bundle.peerId
		this.members = [bundle.peerId, this.id]
		const peer = this.peer(bundle.connectionId, bundle.peerId)
		await peer.pc.setRemoteDescription(bundle.description)
		await peer.pc.setLocalDescription(await peer.pc.createAnswer())
	}

	async createAnswerBundle(): Promise<RoomBundle> {
		const entry = [...this.peers][0]
		if (this.role !== "follower" || !entry) {
			throw new Error("Apply an invitation first.")
		}
		return this.gather(...entry)
	}

	async applyAnswerBundle(bundle: RoomBundle) {
		const peer = this.peers.get(bundle.connectionId)
		if (
			this.role !== "leader" ||
			!peer ||
			bundle.roomId !== this.roomId ||
			peer.channel?.readyState === "open"
		) {
			throw new Error("This reply belongs to a different or expired invitation.")
		}
		peer.id = bundle.peerId
		await peer.pc.setRemoteDescription(bundle.description)
	}

	async startSynchronized() {
		await this.ensureSession()
		this.session!.setTransport({ playing: true, position: 0 })
	}
	async stopSynchronized() {
		this.session?.setTransport({ playing: false })
	}
	broadcastTempoUpdate() {
		if (this.role !== "leader" || !this.session) {
			return
		}
		const bpm = this.timer.BPM,
			swing = this.timer.swing,
			current = this.session.getState()
		this.timer.BPM = current.bpm
		this.timer.swing = current.swing
		this.session.setTransport({ bpm, swing })
	}

	private remove(connectionId: string) {
		const peer = this.peers.get(connectionId)
		if (!peer) {
			return
		}
		this.peers.delete(connectionId)
		this.session?.removePeer(peer.id)
		peer.channel?.close()
		peer.pc.close()
		peer.queue = []
		this.pendingMesh.delete(peer.id)
		this.onPeerClose?.(peer.id)
		if (!this.destroyed && this.members.includes(peer.id)) {
			if (this.role === "leader") {
				this.members = this.members.filter((id) => id !== peer.id)
				this.term++
				this.announceMembers()
			} else if (peer.id === this.conductorId) {
				this.members = this.members.filter(
					(id) => id === this.id || this.connectedPeerIds.includes(id)
				)
				this.term++
				const successor = this.members[0] ?? this.id
				void this.changeConductor(successor).then(() => {
					if (this.role === "leader") {
						this.announceMembers()
					}
				})
			}
		}
		this.changed()
	}

	async destroy() {
		this.destroyed = true
		for (const cancel of Array.from(this.waits)) {
			cancel()
		}
		for (const id of this.peers.keys()) {
			this.remove(id)
		}
		await this.transition
		await this.session?.destroy()
	}
}

export const createRoomConnection = (
	timer: ConstructorParameters<typeof RoomConnection>[0],
	options: { role: "leader" | "follower"; roomId?: string }
) => new RoomConnection(timer, options)