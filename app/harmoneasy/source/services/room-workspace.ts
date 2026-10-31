import type IOChainManager from "audiobus/io/IO-chain-manager"
import type { IAudioCommand } from "audiobus/audio-command-interface"
import AudioCommand from "audiobus/audio-command"
import InputAudioEvent from "audiobus/io/events/input-audio-event"
import { NOTE_ON, NOTE_OFF, CONTROL_CHANGE, PITCH_BEND, PROGRAM_CHANGE } from "audiobus/commands"
import { POLYPHONIC_PRESSURE, CHANNEL_PRESSURE } from "audiobus/midi/midi-command-conversion"
import {
	EVENT_CHAINS_UPDATED,
	EVENT_HARMONY_CHANGED,
	EVENT_CHAIN_ACTIVE_CHANGED,
	EVENT_TRANSPORT_CHANGED
} from "audiobus/event-constants"
import type { RoomConnection } from "./room-connection"
import { parseHarmony } from "audiobus/io/harmony"

const MUSICAL_COMMANDS = new Set([
	NOTE_ON,
	NOTE_OFF,
	CONTROL_CHANGE,
	PITCH_BEND,
	PROGRAM_CHANGE,
	POLYPHONIC_PRESSURE,
	CHANNEL_PRESSURE
])
const MAX_WORKSPACE = 1024 * 1024

export function packRoomCommand(command: IAudioCommand) {
	return {
		type: command.type,
		number: command.number,
		velocity: command.velocity ?? 0,
		channel: command.channel ?? -1,
		value: command.value ?? 0,
		pitchBend: command.pitchBend ?? 0,
		subtype: command.subtype ?? "",
		from: command.from ?? "",
		text: command.text ?? "",
		raw: Array.from(command.raw ?? []),
		ump: command.ump,
		umpOriginal: command.umpOriginal
	}
}

export function unpackRoomCommand(value: any, now: number): IAudioCommand | undefined {
	if (
		!value ||
		!MUSICAL_COMMANDS.has(value.type) ||
		!Number.isInteger(value.number) ||
		value.number < 0 ||
		value.number > 127 ||
		!Number.isFinite(value.velocity) ||
		value.velocity < 0 ||
		value.velocity > 127 ||
		!Number.isInteger(value.channel) ||
		value.channel < -1 ||
		value.channel > 16 ||
		!Number.isFinite(value.value) ||
		!Number.isFinite(value.pitchBend) ||
		!Array.isArray(value.raw) ||
		value.raw.length > 1024 ||
		value.raw.some(
			(byte: unknown) => !Number.isInteger(byte) || Number(byte) < 0 || Number(byte) > 255
		) ||
		["subtype", "from", "text"].some(
			(key) => typeof value[key] !== "string" || value[key].length > 256
		) ||
		(value.ump !== undefined &&
			(!Array.isArray(value.ump) ||
				value.ump.length > 4 ||
				value.ump.some(
					(word: unknown) =>
						!Number.isInteger(word) || Number(word) < 0 || Number(word) > 0xffffffff
				)))
	) {
		return
	}
	const command = Object.assign(new AudioCommand(), {
		type: value.type,
		number: value.number,
		velocity: value.velocity,
		channel: value.channel,
		value: value.value,
		pitchBend: value.pitchBend,
		subtype: value.subtype,
		from: value.from,
		text: value.text,
		raw: Uint8Array.from(value.raw),
		ump: value.ump,
		startAt: now,
		time: now
	}) as unknown as IAudioCommand
	if (
		value.umpOriginal &&
		typeof value.umpOriginal.type === "string" &&
		["number", "velocity", "value"].every((key) => Number.isFinite(value.umpOriginal[key]))
	) {
		command.umpOriginal = value.umpOriginal
	}
	return command as unknown as IAudioCommand
}

/** The host transforms inputs once; all machines play those exact output commands. */
export class RoomWorkspace {
	private abort = new AbortController()
	private revision = 0
	private encoded = ""
	private applying = false
	private dirty = false
	private ready = false
	private loaded = false
	private closed = false
	private leader = ""
	private readyPeers = new Set<string>()
	private harmonyPeers = new Set<string>()
	private applyingHarmony = false
	private edits?: ReturnType<typeof setTimeout>
	private queue: Promise<void> = Promise.resolve()
	private scheduled = new Set<ReturnType<typeof setTimeout>>()
	private previousInput: IOChainManager["sessionInputHandler"]
	private previousOutput: IOChainManager["sessionOutputHandler"]

	constructor(
		private connection: RoomConnection,
		private manager: IOChainManager,
		private now: () => number,
		private report: (status: string) => void = () => {},
		private mode: "workspace" | "harmony" = "workspace"
	) {
		this.previousInput = manager.sessionInputHandler
		this.previousOutput = manager.sessionOutputHandler
		manager.sessionInputHandler = this.input
		manager.sessionOutputHandler = this.output
		manager.addEventListener(EVENT_HARMONY_CHANGED, () => {
			if (!this.applyingHarmony && connection.role === "leader") {
				connection.broadcastData({ type: "harmony", state: manager.harmony })
			}
		}, { signal: this.abort.signal })
		for (const event of [EVENT_CHAINS_UPDATED, EVENT_CHAIN_ACTIVE_CHANGED]) {
			manager.addEventListener(event, this.changed, { signal: this.abort.signal })
		}
		manager.addEventListener(
			EVENT_TRANSPORT_CHANGED,
			() => {
				if (!manager.transportRunning && connection.role === "leader") {
					this.silence()
				}
			},
			{ signal: this.abort.signal }
		)
		connection.onPeerOpen = (id) => {
			if (this.mode === "harmony") {
				if (connection.role === "leader") this.send(id, { type: "harmony", state: manager.harmony })
				else {
					this.leader = id
					this.send(id, { type: "request-harmony" })
				}
				return
			}
			if (connection.role === "leader") {
				this.silence()
				if (!this.publish()) {
					connection.sendData(id, {
						type: "workspace",
						revision: this.revision,
						encoded: this.encoded
					})
				}
			} else if (!connection.conductorId || id === connection.conductorId) {
				this.leader = id
				this.report("Connected — loading the room setup…")
			}
		}
		connection.onClockChange = () => this.finishJoining()
		connection.onConductorChange = (id, conductor) => {
			if (this.mode === "harmony") {
				this.leader = id
				if (conductor) connection.broadcastData({ type: "harmony", state: manager.harmony })
				else this.send(id, { type: "request-harmony" })
				return
			}
			this.leader = id
			this.ready = this.loaded = this.dirty = false
			this.readyPeers.clear()
			clearTimeout(this.edits)
			this.clearNotes()
			this.queue = this.queue
				.then(() => {
					if (this.closed) {
						return
					}
					if (conductor) {
						this.encoded = ""
						this.publish()
						this.report(
							"You are the conductor. The room continues with its current setup."
						)
					} else {
						this.send(id, { type: "request-workspace" })
						this.report("Following the next conductor — synchronizing the room…")
					}
				})
				.catch((error) => this.report(String(error)))
		}
		connection.onData = (id, message) => {
			this.queue = this.queue
				.then(() => this.receive(id, message))
				.catch((error) => {
					this.ready = false
					this.loaded = false
					this.report(
						`Room setup failed: ${error instanceof Error ? error.message : String(error)}`
					)
				})
		}
		connection.onPeerClose = (id) => {
			this.harmonyPeers.delete(id)
			this.readyPeers.delete(id)
			if (connection.role === "follower" && id === this.leader) {
				this.ready = false
				this.clearNotes()
				this.report(
					"Disconnected from the host. Select Internal clock to leave the room or reconnect with a new invitation."
				)
			} else if (connection.role === "leader") {
				this.silence()
			}
		}
	}

	private send(id: string, message: unknown) {
		if (!this.closed) {
			this.connection.sendData(id, message)
		}
	}
	private clearNotes() {
		for (const timeout of this.scheduled) {
			clearTimeout(timeout)
		}
		this.scheduled.clear()
		this.manager.chains.forEach((chain) => chain.clearNoteCommands())
	}

	private finishJoining() {
		if (
			this.closed ||
			this.connection.role === "leader" ||
			!this.loaded ||
			this.ready ||
			this.dirty ||
			!this.connection.clockLocked
		) {
			return
		}
		this.ready = true
		this.send(this.leader, { type: "ready", revision: this.revision, ready: true })
		this.report("Room ready — tempo, notes and workspace are shared.")
	}

	private schedule(chainId: string, commands: IAudioCommand[], at: number) {
		const revision = this.revision
		const timeout = setTimeout(
			() => {
				this.scheduled.delete(timeout)
				if (this.closed || revision !== this.revision) {
					return
				}
				const chain = this.manager.getChain(chainId)
				if (!chain?.isActive) {
					return
				}
				const now = this.now()
				for (const command of commands) {
					command.startAt = now
					command.time = now
				}
				void chain.outputManager
					.triggerAudioCommandsOnOutputs(commands)
					.catch((error) => this.report(String(error)))
			},
			Math.max(0, at - this.connection.leaderTimeMs)
		)
		this.scheduled.add(timeout)
	}

	silence() {
		this.clearNotes()
		if (this.connection.role === "leader") {
			this.connection.broadcastData({ type: "silence" })
		} else if (this.ready) {
			this.send(this.leader, { type: "silence" })
		}
	}

	private input = (chainId: string, command: IAudioCommand): boolean => {
		if (this.previousInput?.(chainId, command)) {
			return true
		}
		if (this.mode === "harmony") return false
		if (this.applying || this.dirty) {
			return true
		}
		if (this.connection.role === "leader") {
			return false
		}
		if (this.ready && !this.applying && MUSICAL_COMMANDS.has(command.type)) {
			this.send(this.leader, {
				type: "input",
				revision: this.revision,
				chainId,
				command: packRoomCommand(command)
			})
		}
		// Followers must not transform or play inputs independently, including while loading.
		return true
	}

	private output = (chainId: string, commands: IAudioCommand[]): boolean => {
		if (this.previousOutput?.(chainId, commands)) {
			return true
		}
		if (this.mode === "harmony") return false
		if (this.applying || this.dirty) {
			return true
		}
		if (this.connection.role === "follower") {
			return true
		}
		const notes = commands
			.filter((command) => MUSICAL_COMMANDS.has(command.type))
			.map(packRoomCommand)
		if (!this.readyPeers.size || !notes.length) {
			return false
		}
		const at = this.connection.leaderTimeMs + this.connection.playbackDelayMs
		if (notes.length) {
			for (const id of this.readyPeers) {
				for (let index = 0; index < notes.length; index += 64) {
					this.send(id, {
						type: "output",
						revision: this.revision,
						chainId,
						at,
						commands: notes.slice(index, index + 64)
					})
				}
			}
		}
		this.schedule(
			chainId,
			commands.map((command) => ({ ...command })),
			at
		)
		return true
	}

	private changed = () => {
		if (this.mode === "harmony") return
		if (this.applying || this.closed) {
			return
		}
		if (!this.dirty) {
			this.silence()
		}
		this.dirty = true
		clearTimeout(this.edits)
		this.edits = setTimeout(() => {
			if (this.closed) {
				return
			}
			try {
				if (this.connection.role === "leader") {
					this.publish()
				} else if (this.ready || this.loaded) {
					const encoded = this.manager.exportWorkspace()
					if (encoded === this.encoded) {
						this.dirty = false
						this.finishJoining()
						return
					}
					this.ready = false
					this.loaded = false
					this.clearNotes()
					this.send(this.leader, { type: "edit", revision: this.revision, encoded })
					this.report("Synchronizing workspace changes…")
				}
			} catch (error) {
				this.report(String(error))
			}
		}, 100)
	}

	private publish() {
		const encoded = this.manager.exportWorkspace()
		if (encoded.length > MAX_WORKSPACE) {
			throw new Error("Workspace exceeds the 1 MB sharing limit.")
		}
		this.dirty = false
		if (encoded === this.encoded) {
			return false
		}
		this.silence()
		this.encoded = encoded
		this.revision++
		this.readyPeers.clear()
		this.connection.broadcastData({ type: "workspace", revision: this.revision, encoded })
		return true
	}

	private validWorkspace(message: any) {
		return (
			typeof message.encoded === "string" &&
			message.encoded.startsWith("workspace:") &&
			message.encoded.length <= MAX_WORKSPACE &&
			Number.isSafeInteger(message.revision) &&
			message.revision >= 0
		)
	}

	private async restore(encoded: string) {
		this.applying = true
		this.clearNotes()
		try {
			await this.manager.restoreWorkspace(encoded)
		} finally {
			this.applying = false
		}
	}

	private async receive(id: string, message: any) {
		if (this.closed || !message || typeof message !== "object") {
			return
		}
		const host = this.connection.role === "leader"
		if (!host && this.leader && id !== this.leader) {
			return
		}
		if (message.type === "request-harmony" && host) {
			this.readyPeers.delete(id)
			this.harmonyPeers.add(id)
			this.send(id, { type: "harmony", state: this.manager.harmony })
			return
		}
		if (message.type === "harmony" && !host) {
			this.leader = id
			const state = parseHarmony(message.state)
			this.applyingHarmony = true
			try { this.manager.setHarmony(state) } finally { this.applyingHarmony = false }
			if (this.mode === "harmony") this.report("Following room harmony; your instruments and chains stay local.")
			return
		}
		if (this.mode === "harmony" || this.harmonyPeers.has(id)) return
		if (message.type === "request-workspace" && host) {
			if (!this.publish()) {
				this.send(id, { type: "workspace", revision: this.revision, encoded: this.encoded })
			}
		} else if (
			message.type === "workspace" &&
			!host &&
			this.validWorkspace(message) &&
			message.revision >= this.revision
		) {
			this.leader = id
			this.ready = false
			this.loaded = false
			this.report("Loading the room’s instruments and chains…")
			if (
				this.encoded !== message.encoded ||
				this.manager.exportWorkspace() !== message.encoded
			) {
				await this.restore(message.encoded)
			}
			if (this.closed) {
				return
			}
			this.encoded = message.encoded
			this.revision = message.revision
			this.dirty = false
			const warnings = this.manager.restoreWarnings
			this.loaded = warnings.length === 0
			if (this.loaded) {
				this.report("Workspace loaded — synchronizing the room clock and peer connections…")
				this.finishJoining()
			} else {
				this.send(id, { type: "ready", revision: this.revision, ready: false })
				this.report(`Room setup incomplete; shared playback paused. ${warnings.join(" ")}`)
			}
		} else if (message.type === "ready" && host && message.revision === this.revision) {
			if (message.ready === true) {
				this.readyPeers.add(id)
				this.report(
					`Room ready — ${this.readyPeers.size + 1} players sharing tempo, notes and workspace.`
				)
			} else {
				this.readyPeers.delete(id)
				this.report(
					"A joining device cannot load every device in this workspace; its shared playback is paused."
				)
			}
		} else if (message.type === "edit" && host && this.validWorkspace(message)) {
			this.publish() // Commit any local edit before comparing revisions.
			if (message.revision === this.revision) {
				const previous = this.encoded
				try {
					await this.restore(message.encoded)
					if (this.closed) {
						return
					}
					if (this.manager.restoreWarnings.length) {
						const warnings = this.manager.restoreWarnings.join(" ")
						await this.restore(previous)
						throw new Error(warnings)
					}
					this.publish()
				} catch (error) {
					this.report(`Workspace edit rejected: ${String(error)}`)
					this.send(id, {
						type: "error",
						message:
							"The host could not load your workspace edit; the room setup has been restored."
					})
				}
			}
			this.send(id, { type: "workspace", revision: this.revision, encoded: this.encoded })
		} else if (
			message.type === "error" &&
			!host &&
			typeof message.message === "string" &&
			message.message.length < 1000
		) {
			this.report(message.message)
		} else if (
			message.type === "input" &&
			host &&
			this.readyPeers.has(id) &&
			message.revision === this.revision
		) {
			const chain = this.manager.getChain(message.chainId)
			const command = unpackRoomCommand(message.command, this.now())
			if (chain?.isActive && command) {
				chain.onInputEvent(new InputAudioEvent(command))
			}
		} else if (
			message.type === "output" &&
			!host &&
			this.ready &&
			message.revision === this.revision &&
			Array.isArray(message.commands) &&
			message.commands.length <= 64 &&
			Number.isFinite(message.at) &&
			Math.abs(message.at - this.connection.leaderTimeMs) < 5000
		) {
			const chain = this.manager.getChain(message.chainId)
			if (!chain?.isActive) {
				return
			}
			const commands = message.commands.map((command: unknown) =>
				unpackRoomCommand(command, this.now())
			)
			if (commands.some((command: IAudioCommand | undefined) => !command)) {
				return
			}
			// Bypass the transformers and sharing hook: these are the host's final notes.
			this.schedule(message.chainId, commands, message.at)
		} else if (message.type === "silence") {
			if (host) {
				this.silence()
			} else {
				this.clearNotes()
			}
		}
	}

	async destroy() {
		this.closed = true
		clearTimeout(this.edits)
		this.abort.abort()
		this.clearNotes()
		if (this.manager.sessionInputHandler === this.input) {
			this.manager.sessionInputHandler = this.previousInput
		}
		if (this.manager.sessionOutputHandler === this.output) {
			this.manager.sessionOutputHandler = this.previousOutput
		}
		this.connection.onData =
			this.connection.onPeerOpen =
			this.connection.onPeerClose =
				undefined
		this.connection.onClockChange = undefined
		this.connection.onConductorChange = undefined
		// Finish any in-flight transactional restore before another room is created.
		await this.queue
	}
}
