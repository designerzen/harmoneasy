// Adapted from designerzen/InterFACE (PhotoSYNTH), AGPL-3.0-or-later.
import { createBlendshapeScoreReader, inferExpressionParameters } from "./expressions.js"
import type { Blendshape, FacePrediction, Landmark } from "./types.js"

export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))
const distance = (a?: Landmark, b?: Landmark) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0)

/** Preserves PhotoSYNTH's mouth geometry fallback, brow extents and head controls. */
export function enhanceFaceLandmarksModelPrediction(
	landmarks: Landmark[],
	categories: Blendshape[],
	time: number,
	mirrored = true
): FacePrediction {
	const score = createBlendshapeScoreReader(categories)
	const expressions = inferExpressionParameters(categories)
	const width = distance(landmarks[61], landmarks[291])
	const ratio = width > 0 ? distance(landmarks[13], landmarks[14]) / width : 0
	const opening = Math.max(
		clamp((ratio - 0.035) / 0.145),
		Math.min(score("jawOpen", 25), 1 - score("mouthClose", 27)) * 0.8
	)
	const remaining = Math.max(0, opening - 0.0105)
	const eased = Math.sin((remaining * Math.PI) / 2)
	const browUp = Math.max(
		score("browInnerUp", 3),
		score("browOuterUpLeft", 4),
		score("browOuterUpRight", 5)
	)
	const browDown = Math.max(score("browDownLeft", 1), score("browDownRight", 2))
	const leftWidth = distance(landmarks[362], landmarks[263])
	const rightWidth = distance(landmarks[133], landmarks[33])
	const divisor = mirrored ? rightWidth : leftWidth
	const rawYaw = divisor > 0 ? ((mirrored ? leftWidth : rightWidth) / divisor - 1) * 2 : 0
	const left = landmarks[362],
		right = landmarks[133]
	const roll = left && right ? Math.atan2(left.y - right.y, left.x - right.x) : 0
	const chin = landmarks[152],
		top = landmarks[10]
	const pitchRadians =
		chin && top ? (Math.atan2(chin.z - top.z, chin.y - top.y) + 0.12) * 3.88 : 1
	return {
		...expressions,
		time,
		keypoints: landmarks.map((point) => ({ ...point, x: mirrored ? 1 - point.x : point.x })),
		mouthRatio: eased === 0 ? 0 : clamp(1 - 2 ** (-10 * eased)),
		eyebrows: browDown > 0.01 ? -browDown : browUp,
		eyebrowExtents:
			browUp > 0.7
				? 1 + (browUp - 0.7) / 0.3
				: browDown > 0.7
					? 1 - (browDown - 0.7) / 0.3
					: 1,
		leftEyeClosedBy: score("eyeBlinkLeft", 9),
		rightEyeClosedBy: score("eyeBlinkRight", 10),
		mouthPucker: score("mouthPucker", 38),
		tongueOut: score("tongueOut", 52),
		yaw: clamp(rawYaw < 0 ? rawYaw * 2 : rawYaw, -1, 1),
		roll: clamp(roll * 1.3 * (mirrored ? 1 : -1), -1, 1),
		headRollRadians: roll * (mirrored ? 1 : -1),
		pitch: clamp(1 - 2 * pitchRadians, -1, 1)
	}
}