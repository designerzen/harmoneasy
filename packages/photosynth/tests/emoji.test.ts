import { describe, expect, it } from "vitest"
import {
	EmojiDetector,
	containedVideoRect,
	enhanceFaceLandmarksModelPrediction,
	faceEmojiPlacement
} from "../src/index.js"
import type { FacePrediction } from "../src/index.js"

const face = (values: Partial<FacePrediction> = {}): FacePrediction => ({
	...enhanceFaceLandmarksModelPrediction([], [], 0),
	...values
})

describe("face-following emoji selection", () => {
	it.each([
		[{}, "neutral"],
		[{ happiness: 0.4 }, "grin"],
		[{ happiness: 0.8, mouthRatio: 0.8 }, "beam"],
		[{ leftEyeClosedBy: 0.9 }, "wink"],
		[{ rightEyeClosedBy: 0.9 }, "wink"],
		[{ leftEyeClosedBy: 0.9, rightEyeClosedBy: 0.9, happiness: 0.7 }, "squint"],
		[{ mouthPucker: 0.9 }, "kiss"],
		[{ mouthPucker: 0.9, rightEyeClosedBy: 0.9 }, "winkKiss"],
		[{ tongueOut: 0.9 }, "tongue"],
		[{ tongueOut: 0.9, leftEyeClosedBy: 0.9 }, "tongueWink"],
		[{ anger: 0.7 }, "angry"],
		[{ sadness: 0.6 }, "sad"],
		[{ sadness: 0.6, browInnerUp: 0.5 }, "worried"],
		[{ fear: 0.6 }, "fearful"],
		[{ disgust: 0.7 }, "grimace"],
		[{ surprise: 0.7, mouthRatio: 0.8 }, "astonished"],
		[{ mouthRatio: 0.5 }, "surprise"],
		[{ mouthSmileRight: 0.3 }, "asymmetric"]
	] as [Partial<FacePrediction>, string][])("selects %j as %s", (values, expression) => {
		expect(new EmojiDetector().detect(face(values))?.expression).toBe(expression)
	})
	it("filters brief signal dips, requires fresh neutral samples and resets on face loss", () => {
		const detector = new EmojiDetector()
		expect(detector.detect(face({ happiness: 0.8, time: 0 }))?.expression).toBe("grin")
		expect(detector.detect(face({ time: 1 }))?.expression).toBe("grin")
		// Cached observations do not vote towards a new expression.
		for (let i = 0; i < 10; i++) {
			expect(detector.detect(face({ time: 1 }))?.expression).toBe("grin")
		}
		detector.detect(face({ time: 2 }))
		detector.detect(face({ time: 3 }))
		expect(detector.detect(face({ time: 4 }))?.expression).toBe("neutral")
		expect(detector.detect(null)).toBeNull()
		expect(detector.detect(face({ time: 0 }))?.expression).toBe("neutral")
	})
	it("mirrors right winks and retains closed eyes through small blink-score jitter", () => {
		const detector = new EmojiDetector()
		expect(detector.detect(face({ rightEyeClosedBy: 0.9, time: 0 }))?.mirrored).toBe(true)
		expect(detector.detect(face({ rightEyeClosedBy: 0.5, time: 1 }))?.expression).toBe("wink")
		expect(new EmojiDetector().detect(face({ leftEyeClosedBy: 0.9 }))?.mirrored).toBe(false)
	})
	it("exposes the MediaPipe pucker and tongue signals used by emoji selection", () => {
		const prediction = enhanceFaceLandmarksModelPrediction(
			[],
			[
				{ categoryName: "mouthPucker", score: 0.9 },
				{ categoryName: "tongueOut", score: 0.8 }
			],
			1
		)
		expect(prediction).toMatchObject({ mouthPucker: 0.9, tongueOut: 0.8 })
	})
})

describe("overlay alignment", () => {
	it("keeps video and dots aligned with horizontal and vertical letterboxing", () => {
		const wide = containedVideoRect(800, 400, 640, 480)
		expect(wide.x).toBeCloseTo(800 / 6)
		expect(wide.width).toBeCloseTo(1600 / 3)
		expect(wide.y).toBe(0)
		expect(wide.height).toBe(400)
		expect(containedVideoRect(300, 400, 640, 480)).toEqual({
			x: 0,
			y: 87.5,
			width: 300,
			height: 225
		})
	})
	it("centres the emoji on the displayed face, scales with its bounds and clears an empty face", () => {
		const prediction = face({
			keypoints: [
				{ x: 0.2, y: 0.2, z: 0 },
				{ x: 0.6, y: 0.8, z: 0 }
			]
		})
		const placement = faceEmojiPlacement(prediction, { x: 100, y: 0, width: 600, height: 400 })!
		expect(placement.x).toBeCloseTo(340)
		expect(placement.y).toBeCloseTo(200)
		expect(placement.size).toBeCloseTo(312)
		expect(faceEmojiPlacement(face(), { x: 0, y: 0, width: 640, height: 480 })).toBeNull()
	})
	it("reverses the displayed emoji tilt when the camera is mirrored", () => {
		const keypoints = Array.from({ length: 264 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
		keypoints[33] = { x: 0.3, y: 0.4, z: 0 }
		keypoints[263] = { x: 0.7, y: 0.5, z: 0 }
		const rect = { x: 0, y: 0, width: 640, height: 480 }
		const regular = faceEmojiPlacement(face({ keypoints }), rect)!
		const mirrored = faceEmojiPlacement(
			face({ keypoints: keypoints.map((point) => ({ ...point, x: 1 - point.x })) }),
			rect
		)!
		expect(regular.rotation).toBeGreaterThan(0)
		expect(mirrored.rotation).toBeCloseTo(-regular.rotation)
	})
})