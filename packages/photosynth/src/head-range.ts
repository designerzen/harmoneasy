// Adapted from designerzen/InterFACE source/people/head-note-range.js (AGPL-3.0-or-later).
import { clamp } from "./prediction.js"
import type { FacePrediction } from "./types.js"

export const DEFAULT_HEAD_NOTE_RANGE_DEGREES = 90
export const DEFAULT_HEAD_VERTICAL_RANGE_DEGREES = 90
export const MIN_HEAD_RANGE_DEGREES = 20
export const MAX_HEAD_RANGE_DEGREES = 120
export type HeadAxis = "roll" | "pitch" | "yaw"

/** Range is the total sweep, e.g. 90° means 45° to either side of centre. */
export function normaliseHeadRollForRange(
	prediction: Pick<FacePrediction, "roll" | "headRollRadians">,
	rangeDegrees: number
): number {
	const range = clamp(rangeDegrees, MIN_HEAD_RANGE_DEGREES, MAX_HEAD_RANGE_DEGREES)
	const radians = prediction.headRollRadians
	return Number.isFinite(radians)
		? clamp(radians! / ((range * Math.PI) / 360), -1, 1)
		: clamp((prediction.roll * (((2 / 1.3) * 180) / Math.PI)) / range, -1, 1)
}

/** Preserves PhotoSYNTH's calibrated pitch control, scaled against its 90° default. */
export function normaliseHeadPitchForRange(
	prediction: Pick<FacePrediction, "pitch">,
	rangeDegrees: number
): number {
	return clamp(
		(prediction.pitch * DEFAULT_HEAD_VERTICAL_RANGE_DEGREES) /
			clamp(rangeDegrees, MIN_HEAD_RANGE_DEGREES, MAX_HEAD_RANGE_DEGREES),
		-1,
		1
	)
}