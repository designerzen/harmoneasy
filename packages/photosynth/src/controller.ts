import { PHOTOSYNTH_ERROR, PHOTOSYNTH_FRAME, PHOTOSYNTH_STATE } from "./events.js"
import { enhanceFaceLandmarksModelPrediction } from "./prediction.js"
import type { FaceDetector, PhotosynthFrame, PhotosynthState } from "./types.js"

export interface PhotosynthOptions {
	wasmPath?: string
	modelAssetPath?: string
	delegate?: "GPU" | "CPU"
	mirrored?: boolean
	framesPerSecond?: number
	/** Override for embedding or deterministic testing. */
	createDetector?: () => Promise<FaceDetector>
}
export const DEFAULT_WASM_PATH = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0/wasm"
export const DEFAULT_MODEL_PATH =
	"https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"

export class PhotosynthController extends EventTarget {
	private detector?: FaceDetector
	private stream?: MediaStream
	private video?: HTMLVideoElement
	private frameId?: number
	private generation = 0
	private currentState: PhotosynthState = "idle"
	private pending?: Promise<void>
	private cancelPlayback?: () => void
	readonly options: Readonly<PhotosynthOptions>

	constructor(options: PhotosynthOptions = {}) {
		super()
		if (
			options.framesPerSecond !== undefined &&
			(!Number.isFinite(options.framesPerSecond) || options.framesPerSecond <= 0)
		) {
			throw new RangeError("framesPerSecond must be positive")
		}
		this.options = { ...options }
	}
	get state(): PhotosynthState {
		return this.currentState
	}
	private setState(state: PhotosynthState) {
		this.currentState = state
		this.dispatchEvent(new CustomEvent(PHOTOSYNTH_STATE, { detail: state }))
	}
	private emitFrame(frame: PhotosynthFrame) {
		this.dispatchEvent(new CustomEvent(PHOTOSYNTH_FRAME, { detail: frame }))
	}

	start(video: HTMLVideoElement, deviceId?: string): Promise<void> {
		if (this.pending) {
			return this.pending
		}
		if (this.state === "running") {
			return Promise.resolve()
		}
		const generation = ++this.generation
		const pending = this.open(video, deviceId, generation).finally(() => {
			if (this.pending === pending) {
				this.pending = undefined
			}
		})
		this.pending = pending
		return pending
	}

	private async createDetector(): Promise<FaceDetector> {
		if (this.options.createDetector) {
			return this.options.createDetector()
		}
		const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision")
		const files = await FilesetResolver.forVisionTasks(
			this.options.wasmPath ?? DEFAULT_WASM_PATH
		)
		const create = (delegate: "GPU" | "CPU") =>
			FaceLandmarker.createFromOptions(files, {
				baseOptions: {
					modelAssetPath: this.options.modelAssetPath ?? DEFAULT_MODEL_PATH,
					delegate
				},
				runningMode: "VIDEO",
				numFaces: 1,
				outputFaceBlendshapes: true
			})
		try {
			return await create(this.options.delegate ?? "GPU")
		} catch (error) {
			if (this.options.delegate === "CPU") {
				throw error
			}
			return create("CPU")
		}
	}

	private async open(video: HTMLVideoElement, deviceId: string | undefined, generation: number) {
		this.setState("loading")
		try {
			if (!navigator.mediaDevices?.getUserMedia) {
				throw new Error(
					"Camera access requires HTTPS or localhost and a supported browser."
				)
			}
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: false,
				video: {
					width: { ideal: 640 },
					height: { ideal: 480 },
					...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "user" })
				}
			})
			if (generation !== this.generation) {
				stream.getTracks().forEach((track) => track.stop())
				return
			}
			this.stream = stream
			this.video = video
			for (const track of stream.getVideoTracks()) {
				track.addEventListener(
					"ended",
					() => {
						if (generation === this.generation) {
							this.stop()
						}
					},
					{ once: true }
				)
			}
			video.muted = true
			video.playsInline = true
			video.srcObject = stream
			// Race playback against cancellation: a detached video may never resolve play().
			const cancelled = new Promise<void>((resolve) => {
				this.cancelPlayback = resolve
			})
			await Promise.race([video.play(), cancelled])
			if (generation !== this.generation) {
				return
			}
			this.cancelPlayback = undefined
			const detector = await this.createDetector()
			if (generation !== this.generation) {
				detector.close()
				return
			}
			this.detector = detector
			this.setState("running")
			this.loop(generation)
		} catch (cause) {
			if (generation !== this.generation) {
				return
			}
			const error = cause instanceof Error ? cause : new Error(String(cause))
			this.stop()
			this.setState("error")
			this.dispatchEvent(new CustomEvent(PHOTOSYNTH_ERROR, { detail: error }))
			throw error
		}
	}

	private loop(generation: number) {
		let lastVideoTime = -1,
			lastTime = -Infinity,
			timestamp = -Infinity
		const interval = 1000 / Math.min(60, this.options.framesPerSecond ?? 20)
		const tick = (now: number) => {
			if (generation !== this.generation) {
				return
			}
			const video = this.video,
				detector = this.detector
			if (!video || !detector) {
				return
			}
			try {
				if (
					video.readyState >= 2 &&
					video.currentTime !== lastVideoTime &&
					now - lastTime >= interval
				) {
					lastVideoTime = video.currentTime
					lastTime = now
					timestamp = Math.max(now, timestamp + 0.001)
					const result = detector.detectForVideo(video, timestamp)
					const landmarks = result.faceLandmarks[0]
					this.emitFrame({
						time: timestamp,
						face: landmarks?.length
							? enhanceFaceLandmarksModelPrediction(
									landmarks,
									result.faceBlendshapes[0]?.categories ?? [],
									timestamp,
									this.options.mirrored ?? true
								)
							: null
					})
				}
			} catch (cause) {
				this.stop()
				this.setState("error")
				this.dispatchEvent(
					new CustomEvent(PHOTOSYNTH_ERROR, {
						detail: cause instanceof Error ? cause : new Error(String(cause))
					})
				)
				return
			}
			if (generation === this.generation) {
				this.frameId = requestAnimationFrame(tick)
			}
		}
		this.frameId = requestAnimationFrame(tick)
	}

	stop(): void {
		++this.generation
		this.pending = undefined
		this.cancelPlayback?.()
		this.cancelPlayback = undefined
		if (this.frameId !== undefined) {
			cancelAnimationFrame(this.frameId)
		}
		this.frameId = undefined
		this.stream?.getTracks().forEach((track) => track.stop())
		this.stream = undefined
		if (this.video) {
			this.video.pause()
			this.video.srcObject = null
			this.video = undefined
		}
		this.detector?.close()
		this.detector = undefined
		this.emitFrame({ time: performance.now(), face: null })
		this.setState("idle")
	}
}