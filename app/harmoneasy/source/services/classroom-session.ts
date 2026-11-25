import AudioCommand from "audiobus/commands/audio-command"
import type { IAudioCommand } from "audiobus/commands/audio-command-interface"
import { NOTE_OFF, NOTE_ON } from "audiobus/commands/commands"
import { saveScoreToLocalFileSystem } from "audiobus/exporters/download-score"
import { getExportFormat } from "audiobus/exporters/registry"
import type { SequenceNote } from "audiobus/formats/note-sequence"
import { normalizeSong, type SongSource, type SongTrack } from "audiobus/formats/song-source"
import {
	DEFAULT_HARMONY,
	NOTE_NAMES,
	SCALE_FAMILIES,
	parseHarmony,
	sameHarmony,
	type HarmonicState
} from "audiobus/io/harmony"
import { DRUM_ACCOMPANIMENT, MOOG, TB303 } from "audiobus/io/outputs/output-types"
import { ID_CHORD_TRACK } from "audiobus/io/transformers/transformer-chord-track"
import { ID_QUANTISE } from "audiobus/io/transformers/transformer-quantise"
import { mapPitchSet, mod12, pitchClasses, quantisePitchSet } from "audiobus/tuning/pitch-class-set"
import {
	ACCESS_PROFILE_PARAM,
	encodeAccessProfile,
	type AccessProfile
} from "./access-profile"
import { createPartsUrl } from "./parts-url"
import { roomName } from "./room-url"

export const EVENT_CLASSROOM_CHANGED = "classroomChanged"

export type ClassroomRole = "free" | "melody" | "chords" | "bass" | "rhythm"

export interface ClassroomRoleDefinition {
	readonly id: ClassroomRole
	readonly label: string
	readonly description: string
	readonly channel: number
	readonly patch: number
}

export const CLASSROOM_ROLES: readonly ClassroomRoleDefinition[] = [
	{
		id: "free",
		label: "Free play",
		description: "Play freely while staying in the room key when locked.",
		channel: 1,
		patch: 0
	},
	{
		id: "melody",
		label: "Melody",
		description: "Single-note melodic lead locked to the room scale.",
		channel: 2,
		patch: 80
	},
	{
		id: "chords",
		label: "Chords",
		description: "One-finger diatonic triads built from the room scale.",
		channel: 3,
		patch: 4
	},
	{
		id: "bass",
		label: "Bass",
		description: "Low-register bass line locked to the room scale.",
		channel: 4,
		patch: 38
	},
	{
		id: "rhythm",
		label: "Rhythm",
		description: "Percussion and rhythmic accompaniment on MIDI channel 10.",
		channel: 10,
		patch: 0
	}
]

const VALID_ROLES = new Set<ClassroomRole>(CLASSROOM_ROLES.map((role) => role.id))
const MAX_SEATS = 16
const MAX_JAM_NOTES = 20000
const DEFAULT_NOTE_DURATION = 0.25

/** Circle-of-fifths key signature mapping for C..B tonic indices. */
const MAJOR_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5] as const
const MINOR_FIFTHS = [-3, 4, -1, 6, 1, -4, 3, -2, 5, 0, -5, 2] as const

export interface ClassroomSeat {
	peerId: string
	name: string
	role: ClassroomRole
	muted: boolean
	solo: boolean
	isConductor: boolean
}

export interface ClassroomState {
	lockHarmony: boolean
	harmony: HarmonicState
	seats: ClassroomSeat[]
}

interface RecordedJamNote {
	peerId: string
	number: number
	velocity: number
	channel: number
	start: number
	duration: number
}

interface ActiveJamNote {
	peerId: string
	number: number
	velocity: number
	channel: number
	start: number
}

export function isClassroomRole(value: unknown): value is ClassroomRole {
	return typeof value === "string" && VALID_ROLES.has(value as ClassroomRole)
}

export function describeHarmony(harmony: HarmonicState): string {
	const tonic = NOTE_NAMES[harmony.root] ?? "C"
	const relativeMask = mapPitchSet(harmony.scale, 1, -harmony.root)
	const family = SCALE_FAMILIES.find((entry) => entry.mask === relativeMask)
	return `${tonic} ${family?.name ?? "Custom scale"}`
}

export function keySignatureFromHarmony(harmony: HarmonicState): {
	fifths: number
	mode: "major" | "minor"
} {
	const relativeMask = mapPitchSet(harmony.scale, 1, -harmony.root)
	// Bit 3 = minor third, bit 4 = major third.
	const isMinor = Boolean(relativeMask & (1 << 3)) && !(relativeMask & (1 << 4))
	const root = mod12(harmony.root)
	return {
		fifths: isMinor ? MINOR_FIFTHS[root] : MAJOR_FIFTHS[root],
		mode: isMinor ? "minor" : "major"
	}
}

export function parseClassroomState(value: unknown): ClassroomState {
	if (!value || typeof value !== "object") {
		throw new Error("Invalid classroom state")
	}
	const raw = value as Record<string, unknown>
	if (typeof raw.lockHarmony !== "boolean" || !Array.isArray(raw.seats)) {
		throw new Error("Invalid classroom state")
	}
	if (raw.seats.length > MAX_SEATS) {
		throw new Error("Classroom exceeds seat limit")
	}
	const harmony = parseHarmony(raw.harmony)
	const seen = new Set<string>()
	const seats: ClassroomSeat[] = raw.seats.map((entry) => {
		if (!entry || typeof entry !== "object") {
			throw new Error("Invalid classroom seat")
		}
		const seat = entry as Record<string, unknown>
		if (
			typeof seat.peerId !== "string" ||
			!/^[a-zA-Z0-9-]{1,128}$/.test(seat.peerId) ||
			seen.has(seat.peerId) ||
			typeof seat.name !== "string" ||
			seat.name.length > 64 ||
			!isClassroomRole(seat.role) ||
			typeof seat.muted !== "boolean" ||
			typeof seat.solo !== "boolean" ||
			typeof seat.isConductor !== "boolean"
		) {
			throw new Error("Invalid classroom seat")
		}
		seen.add(seat.peerId)
		return {
			peerId: seat.peerId,
			name: seat.name.trim() || "Player",
			role: seat.role,
			muted: seat.muted,
			solo: seat.solo,
			isConductor: seat.isConductor
		}
	})
	return { lockHarmony: raw.lockHarmony, harmony, seats }
}

function clampMidi(note: number): number {
	return Math.max(0, Math.min(127, Math.round(note)))
}

function foldToBassRegister(note: number): number {
	let folded = clampMidi(note)
	while (folded > 59) {
		folded -= 12
	}
	while (folded < 36) {
		folded += 12
	}
	return folded
}

/** Build a diatonic triad above a root note using the active absolute pitch-class mask. */
function buildScaleTriad(rootNote: number, scaleMask: number): number[] {
	const scalePitches = pitchClasses(scaleMask)
	if (scalePitches.length < 3) {
		return [rootNote, clampMidi(rootNote + 4), clampMidi(rootNote + 7)]
	}
	const ordered: number[] = []
	for (let pitch = 0; pitch <= 127; pitch++) {
		if (scaleMask & (1 << mod12(pitch))) {
			ordered.push(pitch)
		}
	}
	let index = ordered.indexOf(rootNote)
	if (index < 0) {
		const snapped = quantisePitchSet(rootNote, scaleMask, 0, "nearest") ?? rootNote
		index = ordered.indexOf(snapped)
	}
	if (index < 0) {
		return [rootNote]
	}
	return [ordered[index], ordered[index + 2], ordered[index + 4]].filter(
		(pitch): pitch is number => pitch !== undefined && pitch <= 127
	)
}

function cloneCommand(
	source: IAudioCommand,
	overrides: Partial<Pick<IAudioCommand, "type" | "number" | "velocity" | "channel" | "from">>
): IAudioCommand {
	return Object.assign(new AudioCommand(), {
		type: overrides.type ?? source.type,
		number: overrides.number ?? source.number,
		velocity: overrides.velocity ?? source.velocity ?? 0,
		channel: overrides.channel ?? source.channel ?? 1,
		value: source.value ?? 0,
		pitchBend: source.pitchBend ?? 0,
		subtype: source.subtype ?? "",
		from: overrides.from ?? source.from ?? "",
		text: source.text ?? "",
		raw: source.raw ? new Uint8Array(source.raw) : new Uint8Array(),
		startAt: source.startAt,
		time: source.time
	}) as unknown as IAudioCommand
}

/** Map a single MIDI note to its role/harmony-aware pitches. */
export function mapSeatPitches(
	noteNumber: number,
	role: ClassroomRole,
	harmony: HarmonicState,
	lockHarmony: boolean
): number[] {
	const clamped = clampMidi(noteNumber)
	if (role === "rhythm") {
		return [clamped]
	}
	const snapped = lockHarmony
		? (quantisePitchSet(clamped, harmony.scale, 0, "nearest") ?? clamped)
		: clamped
	if (role === "bass") {
		const bass = foldToBassRegister(snapped)
		return [lockHarmony ? (quantisePitchSet(bass, harmony.scale, 0, "nearest") ?? bass) : bass]
	}
	if (role === "chords") {
		return buildScaleTriad(snapped, harmony.scale)
	}
	return [snapped]
}

export interface SeatPresetUrlOptions {
	location: string
	base?: string
	roomId?: string
	role: ClassroomRole
	seatName?: string
	bpm?: number
	swing?: number
	accessProfile?: Partial<AccessProfile>
}

/** Build a validated `/parts/v1/` Harmoneasy link configured for a classroom seat role. */
export function buildSeatPresetUrl(options: SeatPresetUrlOptions): string {
	const base = options.base ?? "/"
	const roleDef = CLASSROOM_ROLES.find((entry) => entry.id === options.role) ?? CLASSROOM_ROLES[0]
	const seatTitle = options.seatName?.trim()
		? `${options.seatName.trim()} (${roleDef.label})`
		: `Classroom ${roleDef.label}`
	const inputs = ["keyboard", "onscreen-keyboard"]
	const outputs =
		options.role === "rhythm"
			? [DRUM_ACCOMPANIMENT]
			: options.role === "bass"
				? [TB303]
				: [MOOG]
	const transformers = options.role === "rhythm" ? [ID_QUANTISE] : [ID_CHORD_TRACK]
	const config =
		options.role === "rhythm"
			? { chains: { "url-chain": { name: seatTitle } } }
			: {
					chains: { "url-chain": { name: seatTitle } },
					steps: {
						"url-chain": {
							"0": {
								source: "live",
								follow: "scale",
								role: options.role === "free" ? "melody" : options.role
							}
						}
					}
				}
	const params: Record<string, string | string[]> = {
		inputs: inputs.join(","),
		outputs: outputs.join(","),
		transformers: transformers.join(","),
		name: seatTitle,
		description: roleDef.description,
		config: JSON.stringify(config)
	}
	if (Number.isFinite(options.bpm) && options.bpm! >= 10 && options.bpm! <= 303) {
		params.bpm = String(Math.round(options.bpm!))
	}
	if (Number.isFinite(options.swing) && options.swing! >= 0 && options.swing! <= 1) {
		params.swing = String(options.swing)
	}
	const href = createPartsUrl(options.location, base, params)
	if (!options.roomId && !options.accessProfile) {
		return href
	}
	const url = new URL(href)
	if (options.accessProfile) {
		url.searchParams.set(ACCESS_PROFILE_PARAM, encodeAccessProfile(options.accessProfile))
	}
	if (options.roomId) {
		const fragment = new URLSearchParams(url.hash.slice(1))
		fragment.set("room", roomName(options.roomId))
		url.hash = fragment.toString()
	}
	return url.href
}

export class ClassroomSession extends EventTarget {
	private lockHarmony = false
	private harmony: HarmonicState
	private seats = new Map<string, ClassroomSeat>()
	private studentCounter = 0
	private activeVoices = new Map<string, Map<number, { notes: number[]; channel: number }>>()
	private activeJamNotes = new Map<string, ActiveJamNote>()
	private recordedNotes: RecordedJamNote[] = []
	private jamOriginSeconds?: number

	constructor(
		readonly localPeerId: string,
		isConductor: boolean,
		initialHarmony: HarmonicState = DEFAULT_HARMONY
	) {
		super()
		this.harmony = parseHarmony(initialHarmony)
		this.seats.set(localPeerId, {
			peerId: localPeerId,
			name: isConductor ? "Conductor" : "Player",
			role: "free",
			muted: false,
			solo: false,
			isConductor
		})
	}

	private emitChange() {
		this.dispatchEvent(new Event(EVENT_CLASSROOM_CHANGED))
	}

	getState(): ClassroomState {
		return {
			lockHarmony: this.lockHarmony,
			harmony: { ...this.harmony },
			seats: [...this.seats.values()].map((seat) => ({ ...seat }))
		}
	}

	getSeat(peerId: string): ClassroomSeat | undefined {
		const seat = this.seats.get(peerId)
		return seat ? { ...seat } : undefined
	}

	get localSeat(): ClassroomSeat | undefined {
		return this.getSeat(this.localPeerId)
	}

	get isHarmonyLocked(): boolean {
		return this.lockHarmony
	}

	get currentHarmony(): HarmonicState {
		return { ...this.harmony }
	}

	get jamNoteCount(): number {
		return this.recordedNotes.length + this.activeJamNotes.size
	}

	get jamParticipantCount(): number {
		const peers = new Set<string>()
		for (const note of this.recordedNotes) {
			peers.add(note.peerId)
		}
		for (const note of this.activeJamNotes.values()) {
			peers.add(note.peerId)
		}
		return peers.size
	}

	ensurePeer(peerId: string, isConductor = false): ClassroomSeat {
		const existing = this.seats.get(peerId)
		if (existing) {
			if (existing.isConductor !== isConductor) {
				existing.isConductor = isConductor
				this.emitChange()
			}
			return { ...existing }
		}
		const name = isConductor ? "Conductor" : `Student ${++this.studentCounter}`
		const seat: ClassroomSeat = {
			peerId,
			name,
			role: "free",
			muted: false,
			solo: false,
			isConductor
		}
		this.seats.set(peerId, seat)
		this.emitChange()
		return { ...seat }
	}

	removePeer(peerId: string, now = 0): IAudioCommand[] {
		const releases = this.releasePeerNotes(peerId, now)
		if (this.seats.delete(peerId)) {
			this.emitChange()
		}
		return releases
	}

	setConductor(conductorId: string): void {
		let changed = false
		if (!this.seats.has(conductorId)) {
			this.ensurePeer(conductorId, true)
			changed = true
		}
		for (const seat of this.seats.values()) {
			const next = seat.peerId === conductorId
			if (seat.isConductor !== next) {
				seat.isConductor = next
				changed = true
			}
		}
		if (changed) {
			this.emitChange()
		}
	}

	setLockHarmony(locked: boolean): void {
		if (this.lockHarmony === locked) {
			return
		}
		this.lockHarmony = locked
		this.emitChange()
	}

	setHarmony(harmony: HarmonicState): void {
		const parsed = parseHarmony(harmony)
		if (sameHarmony(this.harmony, parsed)) {
			return
		}
		this.harmony = parsed
		this.emitChange()
	}

	setSeatName(peerId: string, name: string): void {
		const seat = this.seats.get(peerId)
		if (!seat) {
			return
		}
		const cleaned = name.trim().slice(0, 64) || seat.name
		if (seat.name !== cleaned) {
			seat.name = cleaned
			this.emitChange()
		}
	}

	setSeatRole(peerId: string, role: ClassroomRole): void {
		const seat = this.seats.get(peerId)
		if (!seat || !isClassroomRole(role) || seat.role === role) {
			return
		}
		seat.role = role
		this.emitChange()
	}

	setSeatMuted(peerId: string, muted: boolean, now = 0): IAudioCommand[] {
		const seat = this.seats.get(peerId)
		if (!seat || seat.muted === muted) {
			return []
		}
		seat.muted = muted
		const releases = muted ? this.releasePeerNotes(peerId, now) : []
		this.emitChange()
		return releases
	}

	setSeatSolo(peerId: string, solo: boolean, now = 0): IAudioCommand[] {
		const seat = this.seats.get(peerId)
		if (!seat || seat.solo === solo) {
			return []
		}
		seat.solo = solo
		const releases: IAudioCommand[] = []
		for (const candidate of this.seats.values()) {
			if (!this.canPeerPlay(candidate.peerId)) {
				releases.push(...this.releasePeerNotes(candidate.peerId, now))
			}
		}
		this.emitChange()
		return releases
	}

	applyRemoteState(value: unknown): ClassroomState {
		const parsed = parseClassroomState(value)
		this.lockHarmony = parsed.lockHarmony
		this.harmony = parsed.harmony
		this.seats.clear()
		for (const seat of parsed.seats) {
			this.seats.set(seat.peerId, { ...seat })
		}
		if (!this.seats.has(this.localPeerId)) {
			this.ensurePeer(this.localPeerId, false)
		}
		this.emitChange()
		return this.getState()
	}

	hasSoloedSeat(): boolean {
		for (const seat of this.seats.values()) {
			if (seat.solo) {
				return true
			}
		}
		return false
	}

	canPeerPlay(peerId: string): boolean {
		const seat = this.seats.get(peerId)
		if (!seat) {
			return !this.hasSoloedSeat()
		}
		if (this.hasSoloedSeat()) {
			return seat.solo && !seat.muted
		}
		return !seat.muted
	}

	/** Whether classroom rules actively alter incoming notes for this peer. */
	needsNoteTransform(peerId: string): boolean {
		const seat = this.seats.get(peerId)
		return this.lockHarmony || (seat !== undefined && seat.role !== "free")
	}

	releasePeerNotes(peerId: string, now = 0): IAudioCommand[] {
		const voices = this.activeVoices.get(peerId)
		if (!voices?.size) {
			return []
		}
		const commands: IAudioCommand[] = []
		for (const { notes, channel } of voices.values()) {
			for (const noteNumber of notes) {
				this.finishJamNote(peerId, channel, noteNumber, now)
				commands.push(
					Object.assign(new AudioCommand(), {
						type: NOTE_OFF,
						number: noteNumber,
						velocity: 0,
						channel,
						from: `classroom:${peerId}`,
						startAt: now,
						time: now
					}) as unknown as IAudioCommand
				)
			}
		}
		voices.clear()
		this.activeVoices.delete(peerId)
		return commands
	}

	private recordJamNoteOn(
		peerId: string,
		channel: number,
		noteNumber: number,
		velocity: number,
		now: number
	) {
		const safeNow = Number.isFinite(now) && now >= 0 ? now : 0
		if (this.jamOriginSeconds === undefined) {
			this.jamOriginSeconds = safeNow
		}
		const relative = Math.max(0, safeNow - this.jamOriginSeconds)
		const key = `${peerId}:${channel}:${noteNumber}`
		if (this.activeJamNotes.has(key)) {
			this.finishJamNote(peerId, channel, noteNumber, safeNow)
		}
		this.activeJamNotes.set(key, {
			peerId,
			number: noteNumber,
			velocity: Math.max(1, Math.min(127, Math.round(velocity || 100))),
			channel,
			start: relative
		})
	}

	private finishJamNote(peerId: string, channel: number, noteNumber: number, now: number) {
		const key = `${peerId}:${channel}:${noteNumber}`
		const active = this.activeJamNotes.get(key)
		if (!active) {
			return
		}
		this.activeJamNotes.delete(key)
		const safeNow = Number.isFinite(now) && now >= 0 ? now : 0
		const relativeEnd = Math.max(active.start, safeNow - (this.jamOriginSeconds ?? 0))
		const duration = Math.max(0.05, relativeEnd - active.start || DEFAULT_NOTE_DURATION)
		if (this.recordedNotes.length < MAX_JAM_NOTES) {
			this.recordedNotes.push({
				peerId: active.peerId,
				number: active.number,
				velocity: active.velocity,
				channel: active.channel,
				start: active.start,
				duration
			})
		}
	}

	/** Apply mute/solo gating, role/harmony mapping, and multi-track jam capture for a peer command. */
	processPeerCommand(peerId: string, command: IAudioCommand, now: number): IAudioCommand[] {
		const seat = this.seats.get(peerId) ?? this.ensurePeer(peerId, false)
		const isNoteOn = command.type === NOTE_ON && (command.velocity ?? 0) > 0
		const isNoteOff =
			command.type === NOTE_OFF || (command.type === NOTE_ON && (command.velocity ?? 0) === 0)

		if (isNoteOn) {
			if (!this.canPeerPlay(peerId)) {
				return []
			}
			const roleDef =
				CLASSROOM_ROLES.find((entry) => entry.id === seat.role) ?? CLASSROOM_ROLES[0]
			const channel =
				seat.role === "rhythm"
					? 10
					: command.channel && command.channel >= 1 && command.channel <= 16
						? command.channel
						: roleDef.channel
			const pitches = mapSeatPitches(
				command.number,
				seat.role,
				this.harmony,
				this.lockHarmony
			)
			let voices = this.activeVoices.get(peerId)
			if (!voices) {
				voices = new Map()
				this.activeVoices.set(peerId, voices)
			}
			voices.set(command.number, { notes: pitches, channel })
			const emitted = pitches.map((pitch) => {
				this.recordJamNoteOn(peerId, channel, pitch, command.velocity ?? 100, now)
				return cloneCommand(command, {
					type: NOTE_ON,
					number: pitch,
					channel,
					from: `classroom:${peerId}`
				})
			})
			return emitted
		}

		if (isNoteOff) {
			const voices = this.activeVoices.get(peerId)
			const active = voices?.get(command.number)
			if (active) {
				voices!.delete(command.number)
				return active.notes.map((pitch) => {
					this.finishJamNote(peerId, active.channel, pitch, now)
					return cloneCommand(command, {
						type: NOTE_OFF,
						number: pitch,
						velocity: 0,
						channel: active.channel,
						from: `classroom:${peerId}`
					})
				})
			}
			// If a note was never activated (e.g. muted), drop the release cleanly.
			if (!this.canPeerPlay(peerId)) {
				return []
			}
			return [command]
		}

		// Non-note controller messages respect mute/solo gating.
		return this.canPeerPlay(peerId) ? [command] : []
	}

	clearJam(): void {
		this.recordedNotes = []
		this.activeJamNotes.clear()
		this.jamOriginSeconds = undefined
		this.emitChange()
	}

	/** Build a validated multi-track SongSource with one named track per seat. */
	buildJamSong(options: {
		name?: string
		bpm?: number
		numerator?: number
		denominator?: number
		now?: number
	} = {}): SongSource {
		const bpm =
			Number.isFinite(options.bpm) && options.bpm! >= 10 && options.bpm! <= 303
				? options.bpm!
				: 120
		const numerator = options.numerator ?? 4
		const denominator = options.denominator ?? 4
		const allNotes: RecordedJamNote[] = [...this.recordedNotes]
		const fallbackEnd =
			options.now !== undefined && this.jamOriginSeconds !== undefined
				? Math.max(0, options.now - this.jamOriginSeconds)
				: undefined
		for (const active of this.activeJamNotes.values()) {
			const duration =
				fallbackEnd !== undefined
					? Math.max(0.05, fallbackEnd - active.start || DEFAULT_NOTE_DURATION)
					: DEFAULT_NOTE_DURATION
			allNotes.push({ ...active, duration })
		}
		if (!allNotes.length) {
			throw new Error("Play some notes in the room before exporting the jam.")
		}

		const byPeer = new Map<string, RecordedJamNote[]>()
		for (const note of allNotes) {
			const group = byPeer.get(note.peerId) ?? []
			group.push(note)
			byPeer.set(note.peerId, group)
		}

		const usedChannels = new Set<number>()
		const allocateChannel = (preferred: number, isRhythm: boolean) => {
			if (isRhythm) {
				return 10
			}
			if (preferred >= 1 && preferred <= 16 && preferred !== 10 && !usedChannels.has(preferred)) {
				usedChannels.add(preferred)
				return preferred
			}
			for (let channel = 1; channel <= 16; channel++) {
				if (channel !== 10 && !usedChannels.has(channel)) {
					usedChannels.add(channel)
					return channel
				}
			}
			return 1
		}

		const tracks: SongTrack[] = []
		for (const [peerId, peerNotes] of byPeer) {
			const seat = this.seats.get(peerId)
			const role = seat?.role ?? "free"
			const roleDef = CLASSROOM_ROLES.find((entry) => entry.id === role) ?? CLASSROOM_ROLES[0]
			const label = seat ? `${seat.name} (${roleDef.label})` : `Player ${tracks.length + 1}`
			const channel = allocateChannel(roleDef.channel, role === "rhythm")
			const notes: SequenceNote[] = peerNotes
				.map((note) => ({
					number: note.number,
					velocity: note.velocity,
					start: note.start,
					duration: note.duration,
					channel,
					patch: roleDef.patch,
					source: label
				}))
				.sort((a, b) => a.start - b.start)
			tracks.push({
				name: label,
				channel,
				patch: roleDef.patch,
				source: label,
				notes
			})
		}

		return normalizeSong({
			name: options.name?.trim() || "Harmoneasy Classroom Jam",
			tempos: [{ time: 0, bpm }],
			meters: [{ time: 0, numerator, denominator }],
			key: keySignatureFromHarmony(this.harmony),
			tracks
		})
	}

	async exportJam(
		formatId: "dawproject" | "musicxml",
		options: { name?: string; bpm?: number; now?: number; download?: boolean } = {}
	): Promise<{
		blob: Blob
		filename: string
		extension: string
		trackCount: number
		noteCount: number
	}> {
		const format = getExportFormat(formatId)
		if (!format) {
			throw new Error(`Export format unavailable: ${formatId}`)
		}
		const song = this.buildJamSong(options)
		const blob = await format.export(song)
		if (options.download !== false) {
			saveScoreToLocalFileSystem(blob, song.name, format.extension)
		}
		const noteCount = song.tracks.reduce((sum, track) => sum + track.notes.length, 0)
		return {
			blob,
			filename: `${song.name}.${format.extension}`,
			extension: format.extension,
			trackCount: song.tracks.length,
			noteCount
		}
	}
}
