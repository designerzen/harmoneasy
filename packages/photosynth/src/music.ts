import { clamp } from "./prediction.js"
import type { FacePrediction, MusicMessage } from "./types.js"
import { normaliseHeadPitchForRange, normaliseHeadRollForRange } from "./head-range.js"
import type { HeadAxis } from "./head-range.js"

export const SCALES = {
	major: [0, 2, 4, 5, 7, 9, 11],
	minor: [0, 2, 3, 5, 7, 8, 10],
	pentatonic: [0, 2, 4, 7, 9]
} as const
export interface MusicOptions {
	root: number
	octave: number
	scale: keyof typeof SCALES
	threshold: number
	smoothing: number
	channel: number
	precision: number
	headNoteRangeDegrees: number
	headVerticalRangeDegrees: number
	noteController: HeadAxis
	octaveController: HeadAxis
	octaveLow: number
	octaveHigh: number
}
const DEFAULTS: MusicOptions = {
	root: 0,
	octave: 4,
	scale: "pentatonic",
	threshold: 0.18,
	smoothing: 0.35,
	channel: 1,
	precision: 3,
	headNoteRangeDegrees: 90,
	headVerticalRangeDegrees: 90,
	noteController: "roll",
	octaveController: "pitch",
	octaveLow: 2,
	octaveHigh: 6
}

/** Mouth/smile gates volume, head roll selects notes, pitch shifts octaves, brows bend pitch. */
export class PhotosynthMusic {
	private settings = { ...DEFAULTS }
	private note: number | null = null
	private level = 0
	private position: number | null = null
	private controls = new Map<string, number>()
	get options(): Readonly<MusicOptions> {
		return { ...this.settings }
	}

	configure(options: Partial<MusicOptions>): MusicMessage[] {
		const next = { ...this.settings, ...options }
		for (const key of [
			"root",
			"octave",
			"threshold",
			"smoothing",
			"channel",
			"precision",
			"headNoteRangeDegrees",
			"headVerticalRangeDegrees",
			"octaveLow",
			"octaveHigh"
		] as const) {
			if (!Number.isFinite(next[key])) {
				throw new RangeError(`${key} must be finite`)
			}
		}
		if (!(next.scale in SCALES)) {
			throw new RangeError("Unknown scale")
		}
		if (
			![next.noteController, next.octaveController].every((axis) =>
				["roll", "pitch", "yaw"].includes(axis)
			)
		) {
			throw new RangeError("Unknown head axis")
		}
		next.root = Math.round(clamp(next.root, 0, 11))
		next.octave = Math.round(clamp(next.octave, 0, 8))
		next.channel = Math.round(clamp(next.channel, 1, 16))
		next.threshold = clamp(next.threshold, 0.01, 1)
		next.smoothing = clamp(next.smoothing, 0, 0.95)
		next.precision = Math.round(clamp(next.precision, 0, 6))
		next.headNoteRangeDegrees = Math.round(clamp(next.headNoteRangeDegrees, 20, 120))
		next.headVerticalRangeDegrees = Math.round(clamp(next.headVerticalRangeDegrees, 20, 120))
		next.octaveLow = Math.round(clamp(next.octaveLow, 0, 8))
		next.octaveHigh = Math.round(clamp(next.octaveHigh, 0, 8))
		if (next.octaveLow > next.octaveHigh) {
			throw new RangeError("Lower octave must not exceed upper octave")
		}
		// Retain the original centre-octave API for existing consumers.
		if (
			options.octave !== undefined &&
			options.octaveLow === undefined &&
			options.octaveHigh === undefined
		) {
			const shift = next.octave - this.settings.octave
			next.octaveLow = clamp(next.octaveLow + shift, 0, 8)
			next.octaveHigh = clamp(next.octaveHigh + shift, 0, 8)
		}
		next.octave = Math.round((next.octaveLow + next.octaveHigh) / 2)
		const messages = this.reset()
		this.settings = next
		return messages
	}

	reset(): MusicMessage[] {
		const channel = this.settings.channel
		const messages: MusicMessage[] =
			this.note === null ? [] : [{ type: "noteoff", note: this.note, velocity: 0, channel }]
		if (this.controls.size) {
			messages.push(
				{ type: "controlchange", controller: 11, value: 0, channel },
				{ type: "pitchbend", value: 8192, channel }
			)
		}
		this.note = null
		this.level = 0
		this.position = null
		this.controls.clear()
		return messages
	}

	update(face: FacePrediction | null): MusicMessage[] {
		if (!face) {
			return this.reset()
		}
		const { smoothing, threshold, scale, root, channel, precision, octaveLow, octaveHigh } =
			this.settings
		const factor = 10 ** precision
		const level = Math.round(Math.max(face.mouthRatio, face.happiness) * factor) / factor
		this.level = this.level * smoothing + level * (1 - smoothing)
		const control = (axis: HeadAxis) =>
			axis === "roll"
				? normaliseHeadRollForRange(face, this.settings.headNoteRangeDegrees)
				: axis === "pitch"
					? normaliseHeadPitchForRange(face, this.settings.headVerticalRangeDegrees)
					: face.yaw
		const position = control(this.settings.noteController)
		this.position =
			this.position === null
				? position
				: this.position * smoothing + position * (1 - smoothing)
		const notes = SCALES[scale]
		const index = Math.round((clamp(this.position, -1, 1) + 1) * 0.5 * (notes.length - 1))
		const octave = Math.round(
			octaveLow +
				(clamp(control(this.settings.octaveController), -1, 1) + 1) *
					0.5 *
					(octaveHigh - octaveLow)
		)
		const note = clamp((octave + 1) * 12 + root + notes[index]!, 0, 127)
		const active = this.level >= threshold * (this.note === null ? 1 : 0.75)
		const messages: MusicMessage[] = []
		if (this.note !== null && (!active || this.note !== note)) {
			messages.push({ type: "noteoff", note: this.note, velocity: 0, channel })
			this.note = null
		}
		if (active && this.note === null) {
			this.note = note
			messages.push({
				type: "noteon",
				note,
				velocity: Math.max(1, Math.round(clamp(this.level) * 127)),
				channel
			})
		}
		const emit = (key: string, value: number, message: MusicMessage) => {
			if (this.controls.get(key) !== value) {
				this.controls.set(key, value)
				messages.push(message)
			}
		}
		const volume = active ? Math.round(clamp(this.level) * 127) : 0
		emit("volume", volume, { type: "controlchange", controller: 11, value: volume, channel })
		const timbre = Math.round(clamp(face.happiness) * 127)
		emit("timbre", timbre, { type: "controlchange", controller: 74, value: timbre, channel })
		const bend = Math.round(clamp(face.eyebrowExtents / 2) * 16383)
		emit("bend", bend, { type: "pitchbend", value: bend, channel })
		return messages
	}
}