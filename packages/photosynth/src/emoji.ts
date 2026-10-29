// Expression rules and temporal filtering adapted from designerzen/InterFACE (AGPL-3.0-or-later).
import type { FacePrediction } from "./types.js"

export const EXPRESSION_EMOJIS = {
	neutral: ["😐", "Neutral"],
	quiet: ["😑", "Eyes closed"],
	wink: ["😉", "Wink"],
	smile: ["🙂", "Smile"],
	grin: ["😀", "Grin"],
	happy: ["😃", "Open smile"],
	beam: ["😁", "Beaming"],
	closedSmile: ["😊", "Smiling eyes"],
	squint: ["😆", "Laughing"],
	kiss: ["😗", "Kiss"],
	closedKiss: ["😙", "Closed-eye kiss"],
	winkKiss: ["😘", "Winking kiss"],
	tongue: ["😛", "Tongue out"],
	tongueWink: ["😜", "Winking tongue"],
	tongueSquint: ["😝", "Squinting tongue"],
	angry: ["😠", "Angry expression"],
	fearful: ["😨", "Fearful expression"],
	worried: ["😟", "Worried expression"],
	sad: ["☹️", "Frown"],
	closedSad: ["😞", "Closed-eye frown"],
	grimace: ["😬", "Grimace"],
	surprise: ["😯", "Open mouth"],
	astonished: ["😲", "Astonished"],
	asymmetric: ["🫤", "Asymmetric mouth"]
} as const
export type EmojiExpression = keyof typeof EXPRESSION_EMOJIS
export interface EmojiState {
	expression: EmojiExpression
	glyph: string
	label: string
	mirrored: boolean
}

const SMILES = new Set<EmojiExpression>(["smile", "grin", "happy", "beam", "closedSmile", "squint"])
const FILTER_FIELDS = [
	"happiness",
	"sadness",
	"anger",
	"fear",
	"surprise",
	"disgust",
	"mouthSmile",
	"mouthRatio",
	"mouthSmileLeft",
	"mouthSmileRight",
	"browInnerUp",
	"leftEyeClosedBy",
	"rightEyeClosedBy",
	"mouthPucker",
	"tongueOut"
] as const

function recognise(
	face: FacePrediction,
	leftClosed: boolean,
	rightClosed: boolean
): EmojiExpression {
	const happiness = Math.max(face.happiness, face.mouthSmile)
	const closed = leftClosed && rightClosed
	const mouthOpen = face.mouthRatio >= 0.2 || face.jawOpen >= 0.2
	if ((face.tongueOut ?? 0) > 0.55) {
		return closed ? "tongueSquint" : leftClosed || rightClosed ? "tongueWink" : "tongue"
	}
	if ((face.mouthPucker ?? 0) > 0.72) {
		return closed ? "closedKiss" : leftClosed || rightClosed ? "winkKiss" : "kiss"
	}
	if (leftClosed !== rightClosed) {
		return "wink"
	}
	if (closed) {
		if (happiness >= 0.12) {
			return happiness >= 0.55 ? "squint" : "closedSmile"
		}
		return face.sadness >= 0.28 ? "closedSad" : "quiet"
	}
	if (happiness >= 0.12) {
		if (mouthOpen && happiness >= 0.7) {
			return "beam"
		}
		if (mouthOpen && happiness >= 0.48) {
			return "happy"
		}
		return mouthOpen || happiness >= 0.3 ? "grin" : "smile"
	}
	if (face.anger >= 0.38) {
		return "angry"
	}
	if (face.fear >= 0.42 && face.fear > face.surprise + 0.04) {
		return "fearful"
	}
	if (face.sadness >= 0.28) {
		return face.browInnerUp >= 0.25 ? "worried" : "sad"
	}
	if (face.disgust >= 0.42) {
		return "grimace"
	}
	if (face.surprise >= 0.34 && mouthOpen) {
		return face.mouthRatio >= 0.55 ? "astonished" : "surprise"
	}
	if (Math.abs(face.mouthSmileLeft - face.mouthSmileRight) > 0.1) {
		return "asymmetric"
	}
	return mouthOpen ? "surprise" : "neutral"
}

/** State is per input. Cached camera frames never count as extra expression samples. */
export class EmojiDetector {
	private expression: EmojiExpression = "neutral"
	private candidate?: EmojiExpression
	private samples = 0
	private lastTime?: number
	private filtered?: FacePrediction
	private leftClosed = false
	private rightClosed = false
	private mirrored = false

	reset(): void {
		this.expression = "neutral"
		this.candidate = undefined
		this.samples = 0
		this.lastTime = undefined
		this.filtered = undefined
		this.leftClosed = false
		this.rightClosed = false
		this.mirrored = false
	}
	detect(face: FacePrediction | null): EmojiState | null {
		if (!face) {
			this.reset()
			return null
		}
		if (face.time === this.lastTime) {
			return this.state()
		}
		this.lastTime = face.time
		const filtered = { ...face }
		for (const field of FILTER_FIELDS) {
			const value = face[field],
				previous = this.filtered?.[field]
			if (typeof value !== "number" || !Number.isFinite(value)) {
				continue
			}
			filtered[field] =
				typeof previous === "number"
					? previous + (value - previous) * (value >= previous ? 0.85 : 0.75)
					: value
		}
		this.filtered = filtered
		this.leftClosed = filtered.leftEyeClosedBy >= (this.leftClosed ? 0.45 : 0.65)
		this.rightClosed = filtered.rightEyeClosedBy >= (this.rightClosed ? 0.45 : 0.65)
		let current = recognise(filtered, this.leftClosed, this.rightClosed)
		const smile = Math.max(filtered.happiness, filtered.mouthSmile)
		if (SMILES.has(this.expression) && current === "neutral" && smile >= 0.07) {
			current = this.expression
		}
		if (current !== this.candidate) {
			this.candidate = current
			this.samples = 1
		} else {
			this.samples++
		}
		const sameFamily = SMILES.has(current) && SMILES.has(this.expression)
		const required =
			current === "neutral" ||
			current === "quiet" ||
			sameFamily ||
			(SMILES.has(current) && smile < 0.24)
				? 2
				: 1
		if (current === this.expression || this.samples >= required) {
			this.expression = current
			this.mirrored =
				current === "wink" || current === "winkKiss" || current === "tongueWink"
					? this.rightClosed
					: current === "asymmetric" && filtered.mouthSmileRight > filtered.mouthSmileLeft
		}
		return this.state()
	}
	private state(): EmojiState {
		const [glyph, label] = EXPRESSION_EMOJIS[this.expression]
		return { expression: this.expression, glyph, label, mirrored: this.mirrored }
	}
}