export interface Blendshape {
	categoryName?: string
	score: number
}
export interface Landmark {
	x: number
	y: number
	z: number
}
export interface FaceResult {
	faceLandmarks: Landmark[][]
	faceBlendshapes: { categories: Blendshape[] }[]
}
export interface FaceDetector {
	detectForVideo(video: HTMLVideoElement, timestamp: number): FaceResult
	close(): void
}
export interface ExpressionParameters {
	happiness: number
	sadness: number
	anger: number
	fear: number
	surprise: number
	disgust: number
	neutral: number
	mouthSmile: number
	mouthSmileLeft: number
	mouthSmileRight: number
	cheekSquint: number
	mouthFrown: number
	browDown: number
	browInnerUp: number
	browOuterUp: number
	eyeSquint: number
	eyeWide: number
	jawOpen: number
	mouthPress: number
	mouthStretch: number
	noseSneer: number
}
export interface FacePrediction extends ExpressionParameters {
	time: number
	keypoints: Landmark[]
	mouthRatio: number
	eyebrows: number
	eyebrowExtents: number
	leftEyeClosedBy: number
	rightEyeClosedBy: number
	pitch: number
	yaw: number
	roll: number
	headRollRadians?: number
	mouthPucker?: number
	tongueOut?: number
}
export interface PhotosynthFrame {
	time: number
	face: FacePrediction | null
}
export type PhotosynthState = "idle" | "loading" | "running" | "error"
/** Values use MIDI ranges; channel is 1–16. */
export type MusicMessage =
	| { type: "noteon" | "noteoff"; note: number; velocity: number; channel: number }
	| { type: "controlchange"; controller: number; value: number; channel: number }
	| { type: "pitchbend"; value: number; channel: number }