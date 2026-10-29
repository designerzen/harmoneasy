import type { FacePrediction } from "./types.js"

export interface VideoRect {
	x: number
	y: number
	width: number
	height: number
}
export interface EmojiPlacement {
	x: number
	y: number
	size: number
	rotation: number
}

/** Match the video's object-fit:contain letterboxing in the overlay's pixel space. */
export function containedVideoRect(
	width: number,
	height: number,
	videoWidth: number,
	videoHeight: number
): VideoRect {
	const scale = Math.min(width / Math.max(1, videoWidth), height / Math.max(1, videoHeight))
	const fittedWidth = videoWidth * scale,
		fittedHeight = videoHeight * scale
	return {
		x: (width - fittedWidth) / 2,
		y: (height - fittedHeight) / 2,
		width: fittedWidth,
		height: fittedHeight
	}
}

export function faceEmojiPlacement(face: FacePrediction, rect: VideoRect): EmojiPlacement | null {
	const points = face.keypoints.filter(
		(point) => Number.isFinite(point.x) && Number.isFinite(point.y)
	)
	if (!points.length) {
		return null
	}
	const xs = points.map((point) => point.x),
		ys = points.map((point) => point.y)
	const minX = Math.min(...xs),
		maxX = Math.max(...xs),
		minY = Math.min(...ys),
		maxY = Math.max(...ys)
	// Read the displayed landmark coordinates, so mirror changes never rotate the glyph the wrong way.
	const left = face.keypoints[33],
		right = face.keypoints[263]
	let rotation = 0
	if (left && right && [left.x, left.y, right.x, right.y].every(Number.isFinite)) {
		const dx = (right.x - left.x) * rect.width,
			dy = (right.y - left.y) * rect.height
		rotation = Math.atan2(dx < 0 ? -dy : dy, Math.abs(dx))
	}
	return {
		x: rect.x + ((minX + maxX) / 2) * rect.width,
		y: rect.y + ((minY + maxY) / 2) * rect.height,
		size: Math.max(40, (maxX - minX) * rect.width * 1.3, (maxY - minY) * rect.height * 1.05),
		rotation
	}
}