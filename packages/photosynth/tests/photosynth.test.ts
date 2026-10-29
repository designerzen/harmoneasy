// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	createBlendshapeScoreReader,
	enhanceFaceLandmarksModelPrediction,
	inferExpressionParameters,
	PhotosynthController,
	PhotosynthMusic,
	PHOTOSYNTH_FRAME,
	PHOTOSYNTH_MUSIC,
	normaliseHeadPitchForRange,
	normaliseHeadRollForRange,
	WebGPUFaceOverlay,
	PHOTOSYNTH_EMOJI
} from "../src/index.js"
import type {
	FaceDetector,
	FacePrediction,
	Landmark,
	MusicMessage,
	PhotosynthFrame
} from "../src/index.js"
import { PhotosynthElement, definePhotosynthElement } from "../src/element.js"

const face = (values: Partial<FacePrediction> = {}): FacePrediction => ({
	...enhanceFaceLandmarksModelPrediction([], [], 0),
	pitch: 0,
	...values,
	headRollRadians: values.headRollRadians ?? (values.roll ?? 0) / 1.3
})
const categories = (values: Record<string, number>) =>
	Object.entries(values).map(([categoryName, score]) => ({ categoryName, score }))
const deferred = <T>() => {
	let resolve!: (value: T) => void
	let reject!: (reason: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

describe("PhotoSYNTH expression port", () => {
	it("preserves the source happiness and sadness formulas regardless of category order", () => {
		const input = categories({
			mouthSmileLeft: 0.8,
			mouthSmileRight: 0.6,
			cheekSquintLeft: 0.4,
			cheekSquintRight: 0.2,
			mouthFrownLeft: 0.1,
			mouthFrownRight: 0.3
		})
		const result = inferExpressionParameters(input)
		expect(result.happiness).toBeCloseTo(0.65 * 0.7 + 0.2 * 0.6 + 0.15 * 0.3 - 0.45 * 0.2)
		expect(result).toEqual(inferExpressionParameters(input.reverse()))
		expect(result.sadness).toBe(0)
	})
	it("handles sparse, invalid and legacy categories without cross-wiring facial actions", () => {
		expect(
			createBlendshapeScoreReader(categories({ mouthSmileLeft: 0.8, mouthSmileRight: 0.8 }))(
				"browDownLeft",
				1
			)
		).toBe(0)
		expect(createBlendshapeScoreReader([{ score: 0.6 }])("jawOpen", 0)).toBe(0.6)
		expect(
			inferExpressionParameters(categories({ jawOpen: NaN, noseSneerLeft: Infinity }))
				.surprise
		).toBe(0)
		expect(inferExpressionParameters([]).neutral).toBe(1)
	})
	it("uses mouth geometry when blendshapes miss a smile, without mutating landmarks", () => {
		const points: Landmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
		points[61] = { x: 0.4, y: 0.6, z: 0 }
		points[291] = { x: 0.6, y: 0.6, z: 0 }
		points[13] = { x: 0.5, y: 0.58, z: 0 }
		points[14] = { x: 0.5, y: 0.62, z: 0 }
		const original = structuredClone(points)
		const result = enhanceFaceLandmarksModelPrediction(points, [], 123)
		expect(result.mouthRatio).toBeGreaterThan(0.9)
		expect(result.keypoints[61]!.x).toBe(0.6)
		expect(points).toEqual(original)
	})
})

describe("musical control lifecycle", () => {
	it("matches PhotoSYNTH roll and vertical range reference values", () => {
		// Reference outputs from source/people/head-note-range.js, independent of the MIDI mapper.
		for (const [range, expectedRoll, expectedPitch] of [
			[20, 1, 1],
			[90, 2 / 3, 0.4],
			[120, 0.5, 0.3]
		]) {
			expect(
				normaliseHeadRollForRange(face({ headRollRadians: Math.PI / 6 }), range!)
			).toBeCloseTo(expectedRoll!)
			expect(normaliseHeadPitchForRange(face({ pitch: 0.4 }), range!)).toBeCloseTo(
				expectedPitch!
			)
		}
		expect(normaliseHeadRollForRange({ roll: 0.65 }, 90)).toBeCloseTo(1 / (Math.PI / 2))
	})
	it("uses configured precision before smoothing and MIDI conversion", () => {
		const music = new PhotosynthMusic()
		music.configure({ smoothing: 0, precision: 2 })
		expect(music.update(face({ mouthRatio: 0.23456 }))).toContainEqual({
			type: "controlchange",
			controller: 11,
			value: 29,
			channel: 1
		})
		music.configure({ precision: 3 })
		expect(music.update(face({ mouthRatio: 0.23456 }))).toContainEqual({
			type: "controlchange",
			controller: 11,
			value: 30,
			channel: 1
		})
	})
	it("maps configured total tilt range, octave limits and swapped axes", () => {
		const music = new PhotosynthMusic()
		music.configure({ smoothing: 0, headNoteRangeDegrees: 120, octaveLow: 3, octaveHigh: 3 })
		const prediction = face({ mouthRatio: 0.8, headRollRadians: Math.PI / 9 })
		expect(music.update(prediction)).toContainEqual(
			expect.objectContaining({ type: "noteon", note: 55 })
		)
		music.configure({ headNoteRangeDegrees: 20 })
		expect(music.update(prediction)).toContainEqual(
			expect.objectContaining({ type: "noteon", note: 57 })
		)
		music.configure({
			noteController: "pitch",
			octaveController: "roll",
			octaveLow: 2,
			octaveHigh: 6
		})
		expect(
			music.update(face({ mouthRatio: 0.8, pitch: 1, headRollRadians: -Math.PI / 4 }))
		).toContainEqual(expect.objectContaining({ type: "noteon", note: 45 }))
		expect(() => music.configure({ octaveLow: 7, octaveHigh: 2 })).toThrow(RangeError)
		expect(() => music.configure({ headNoteRangeDegrees: NaN })).toThrow(RangeError)
	})
	it("gates notes with mouth or smile and releases them immediately on face loss", () => {
		const music = new PhotosynthMusic()
		music.configure({ smoothing: 0 })
		expect(music.update(face()).some((message) => message.type === "noteon")).toBe(false)
		const messages = music.update(face({ happiness: 0.8 }))
		expect(messages).toContainEqual({ type: "noteon", note: 64, velocity: 102, channel: 1 })
		expect(music.update(face({ happiness: 0.8 }))).toEqual([])
		expect(music.update(null)).toContainEqual({
			type: "noteoff",
			note: 64,
			velocity: 0,
			channel: 1
		})
		expect(music.update(null)).toEqual([])
	})
	it("releases the previous pitch before head movement triggers a new note", () => {
		const music = new PhotosynthMusic()
		music.configure({ smoothing: 0 })
		music.update(face({ mouthRatio: 0.8, roll: -1 }))
		const messages = music.update(face({ mouthRatio: 0.8, roll: 1 }))
		expect(messages.slice(0, 2).map((message) => message.type)).toEqual(["noteoff", "noteon"])
		const reset = music.configure({ channel: 4 })
		expect(reset[0]).toMatchObject({ type: "noteoff", channel: 1 })
		expect(music.update(face({ happiness: 0.9 }))[0]).toMatchObject({
			type: "noteon",
			channel: 4
		})
		expect(() => music.configure({ threshold: NaN })).toThrow(RangeError)
	})
	it("uses hysteresis around the gate and resets expression and pitch bend", () => {
		const music = new PhotosynthMusic()
		music.configure({ smoothing: 0, threshold: 0.2 })
		music.update(face({ mouthRatio: 0.3, eyebrowExtents: 2 }))
		expect(
			music.update(face({ mouthRatio: 0.17 })).some((message) => message.type === "noteoff")
		).toBe(false)
		expect(music.reset()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "noteoff" }),
				{ type: "controlchange", controller: 11, value: 0, channel: 1 },
				{ type: "pitchbend", value: 8192, channel: 1 }
			])
		)
	})
})

describe("camera and web component lifecycle", () => {
	let stop: ReturnType<typeof vi.fn>, detector: FaceDetector, video: HTMLVideoElement
	let getUserMedia: ReturnType<typeof vi.fn>
	let callbacks: Map<number, FrameRequestCallback>
	const controllers: PhotosynthController[] = []
	beforeEach(() => {
		stop = vi.fn()
		callbacks = new Map()
		const track = { stop, addEventListener: vi.fn() }
		const stream = new MediaStream()
		Object.defineProperties(stream, {
			getTracks: { value: () => [track] },
			getVideoTracks: { value: () => [track] }
		})
		getUserMedia = vi.fn().mockResolvedValue(stream)
		Object.defineProperty(navigator, "mediaDevices", {
			configurable: true,
			value: {
				getUserMedia,
				enumerateDevices: vi.fn().mockResolvedValue([]),
				addEventListener: vi.fn()
			}
		})
		vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue()
		vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {})
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)
		let id = 0
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			callbacks.set(++id, callback)
			return id
		})
		vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id))
		detector = {
			detectForVideo: vi.fn().mockReturnValue({ faceLandmarks: [], faceBlendshapes: [] }),
			close: vi.fn()
		}
		video = document.createElement("video")
	})
	afterEach(() => {
		document.body.replaceChildren()
		controllers.forEach((controller) => controller.stop())
		controllers.length = 0
		vi.restoreAllMocks()
		vi.unstubAllGlobals()
	})
	function controller(createDetector = async () => detector) {
		const result = new PhotosynthController({ createDetector })
		controllers.push(result)
		return result
	}
	it("single-flights start, requests video only and releases tracks and detector on stop", async () => {
		const camera = controller()
		const first = camera.start(video, "camera-2")
		expect(camera.start(video)).toBe(first)
		await first
		expect(camera.state).toBe("running")
		expect(getUserMedia).toHaveBeenCalledWith(
			expect.objectContaining({
				audio: false,
				video: expect.objectContaining({ deviceId: { exact: "camera-2" } })
			})
		)
		camera.stop()
		expect(stop).toHaveBeenCalledOnce()
		expect(detector.close).toHaveBeenCalledOnce()
		expect(video.srcObject).toBeNull()
		expect(callbacks.size).toBe(0)
	})
	it("stops a camera that resolves after cancellation and closes a late model", async () => {
		const permission = deferred<MediaStream>()
		getUserMedia.mockReturnValueOnce(permission.promise)
		const camera = controller(),
			first = camera.start(video)
		camera.stop()
		permission.resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream)
		await first
		expect(stop).toHaveBeenCalledOnce()
		expect(camera.state).toBe("idle")
		const model = deferred<FaceDetector>()
		const another = controller(() => model.promise),
			loading = another.start(video)
		await vi.waitFor(() => expect(video.srcObject).not.toBeNull())
		await Promise.resolve()
		await Promise.resolve()
		another.stop()
		model.resolve(detector)
		await loading
		expect(detector.close).toHaveBeenCalledOnce()
		expect(another.state).toBe("idle")
	})
	it("cleans up failed initialization and supports retry after permission denial", async () => {
		const camera = controller()
		getUserMedia.mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError"))
		await expect(camera.start(video)).rejects.toThrow("Denied")
		expect(camera.state).toBe("error")
		await camera.start(video)
		expect(camera.state).toBe("running")
		camera.stop()
		const broken = controller(async () => {
			throw new Error("Bad model")
		})
		await expect(broken.start(video)).rejects.toThrow("Bad model")
		expect(broken.state).toBe("error")
		expect(video.srcObject).toBeNull()
	})
	it("allows a fresh start while an earlier camera permission request is still pending", async () => {
		const permission = deferred<MediaStream>()
		getUserMedia.mockReturnValueOnce(permission.promise)
		const camera = controller(),
			old = camera.start(video)
		camera.stop()
		await camera.start(video)
		expect(camera.state).toBe("running")
		const oldStop = vi.fn()
		permission.resolve({ getTracks: () => [{ stop: oldStop }] } as unknown as MediaStream)
		await old
		expect(oldStop).toHaveBeenCalledOnce()
		expect(camera.state).toBe("running")
	})
	it("skips duplicate video frames and reports no-face frames", async () => {
		const camera = controller(),
			frames: PhotosynthFrame[] = []
		camera.addEventListener(PHOTOSYNTH_FRAME, (event) =>
			frames.push((event as CustomEvent).detail)
		)
		Object.defineProperty(video, "readyState", { value: 2 })
		await camera.start(video)
		const tick = (time: number) => {
			const entry = [...callbacks.entries()][0]!
			callbacks.delete(entry[0])
			entry[1](time)
		}
		tick(10)
		tick(100)
		video.currentTime = 1
		tick(150)
		expect(detector.detectForVideo).toHaveBeenCalledTimes(2)
		expect(frames).toEqual([
			{ time: 10, face: null },
			{ time: 150, face: null }
		])
	})
	it("provides labelled GUI controls and releases musical notes and camera on removal", async () => {
		const audio = vi.fn(() => {
			throw new Error("An input must not create audio")
		})
		vi.stubGlobal("AudioContext", audio)
		definePhotosynthElement()
		const element = document.createElement("photosynth-controller") as PhotosynthElement
		element.cameraOptions = { createDetector: async () => detector }
		const music: MusicMessage[] = []
		element.addEventListener(PHOTOSYNTH_MUSIC, (event) =>
			music.push((event as CustomEvent).detail)
		)
		document.body.append(element)
		expect(getUserMedia).not.toHaveBeenCalled()
		expect(element.shadowRoot!.querySelectorAll("label").length).toBeGreaterThan(8)
		const preview = element.shadowRoot!.querySelector("video")!
		Object.defineProperty(preview, "readyState", { value: 2 })
		vi.mocked(detector.detectForVideo).mockReturnValue({
			faceLandmarks: [[{ x: 0.5, y: 0.5, z: 0 }]],
			faceBlendshapes: [
				{ categories: categories({ mouthSmileLeft: 0.9, mouthSmileRight: 0.9 }) }
			]
		})
		await element.start()
		const tick = [...callbacks.entries()][0]!
		callbacks.delete(tick[0])
		tick[1](100)
		expect(music.some((message) => message.type === "noteon")).toBe(true)
		expect(element.shadowRoot!.querySelector(".expression")!.textContent).toContain("😀")
		expect(element.shadowRoot!.querySelector<HTMLElement>(".emoji-fallback")!.hidden).toBe(
			false
		)
		expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalledWith("2d")
		expect(audio).not.toHaveBeenCalled()
		expect(element.shadowRoot!.querySelector("#sound")).toBeNull()
		expect(element.shadowRoot!.querySelector<HTMLButtonElement>("#start")!.disabled).toBe(true)
		element.remove()
		expect(music.some((message) => message.type === "noteoff")).toBe(true)
		expect(stop).toHaveBeenCalledOnce()
		expect(detector.close).toHaveBeenCalledOnce()
		expect(element.shadowRoot!.querySelector<HTMLButtonElement>("#start")!.disabled).toBe(false)
		document.body.append(element)
		await element.start()
		expect(getUserMedia).toHaveBeenCalledTimes(2)
	})
	it("displays denied camera permission and leaves Start available for retry", async () => {
		const element = document.createElement("photosynth-controller")
		document.body.append(element)
		getUserMedia.mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError"))
		await expect(element.start()).rejects.toThrow("Denied")
		expect(element.shadowRoot!.querySelector(".status")!.textContent).toContain(
			"permission was denied"
		)
		expect(element.shadowRoot!.querySelector<HTMLButtonElement>("#start")!.disabled).toBe(false)
	})
	it("applies GUI precision, range, axis and octave settings and selects the requested camera", async () => {
		const element = document.createElement("photosynth-controller")
		element.cameraOptions = { createDetector: async () => detector }
		document.body.append(element)
		const set = (id: string, value: string) => {
			const input = element.shadowRoot!.querySelector<HTMLInputElement | HTMLSelectElement>(
				`#${id}`
			)!
			input.value = value
			input.dispatchEvent(new Event("input"))
		}
		set("precision", "2")
		set("headNoteRangeDegrees", "45")
		set("headVerticalRangeDegrees", "60")
		set("noteController", "pitch")
		set("octaveController", "roll")
		set("octaveLow", "3")
		set("octaveHigh", "5")
		expect(element.musicOptions).toMatchObject({
			precision: 2,
			headNoteRangeDegrees: 45,
			headVerticalRangeDegrees: 60,
			noteController: "pitch",
			octaveController: "roll",
			octaveLow: 3,
			octaveHigh: 5
		})
		expect(element.shadowRoot!.querySelector("#headNoteRangeDegrees-value")!.textContent).toBe(
			"45°"
		)
		const select = element.shadowRoot!.querySelector<HTMLSelectElement>("#camera")!
		vi.mocked(navigator.mediaDevices.enumerateDevices).mockResolvedValue([
			{
				kind: "videoinput",
				deviceId: "external",
				label: "External camera",
				groupId: "test",
				toJSON: () => ({})
			}
		])
		// Reconnection refreshes the device list without requesting camera access.
		element.remove()
		document.body.append(element)
		await vi.waitFor(() => expect(select.options.length).toBe(2))
		select.value = "external"
		await element.start()
		expect(getUserMedia).toHaveBeenCalledWith(
			expect.objectContaining({
				video: expect.objectContaining({ deviceId: { exact: "external" } })
			})
		)
	})
	it("renders through WebGPU, preserves emoji on GPU loss and disposes resources on removal", async () => {
		const render = vi.fn(),
			destroy = vi.fn()
		let loseGPU!: (error: Error) => void
		const create = vi
			.spyOn(WebGPUFaceOverlay, "create")
			.mockImplementation(async (_canvas, onError) => {
				loseGPU = onError
				return { render, destroy } as unknown as WebGPUFaceOverlay
			})
		const element = document.createElement("photosynth-controller")
		element.cameraOptions = { createDetector: async () => detector }
		const emojis: unknown[] = []
		element.addEventListener(PHOTOSYNTH_EMOJI, (event) =>
			emojis.push((event as CustomEvent).detail)
		)
		document.body.append(element)
		await vi.waitFor(() =>
			expect(element.shadowRoot!.querySelector(".renderer-status")!.textContent).toContain(
				"active"
			)
		)
		const preview = element.shadowRoot!.querySelector("video")!
		Object.defineProperty(preview, "readyState", { value: 2 })
		Object.defineProperties(preview, {
			videoWidth: { value: 640 },
			videoHeight: { value: 480 }
		})
		vi.mocked(detector.detectForVideo).mockReturnValue({
			faceLandmarks: [[{ x: 0.5, y: 0.5, z: 0 }]],
			faceBlendshapes: [
				{ categories: categories({ mouthSmileLeft: 0.9, mouthSmileRight: 0.9 }) }
			]
		})
		await element.start()
		const tick = [...callbacks.entries()][0]!
		callbacks.delete(tick[0])
		tick[1](100)
		expect(render).toHaveBeenLastCalledWith(
			expect.objectContaining({ keypoints: expect.any(Array) }),
			expect.objectContaining({ glyph: "😀" }),
			640,
			480,
			true
		)
		expect(element.shadowRoot!.querySelector<HTMLElement>(".emoji-fallback")!.hidden).toBe(true)
		expect(emojis).toContainEqual(expect.objectContaining({ expression: "grin", glyph: "😀" }))
		loseGPU(new Error("Test device loss"))
		expect(destroy).toHaveBeenCalledOnce()
		expect(element.shadowRoot!.querySelector<HTMLElement>(".emoji-fallback")!.hidden).toBe(
			false
		)
		expect(element.shadowRoot!.querySelector(".renderer-status")!.textContent).toContain(
			"Test device loss"
		)
		expect(element.shadowRoot!.querySelector<HTMLButtonElement>("#stop")!.disabled).toBe(false)
		element.remove()
		expect(emojis.at(-1)).toBeNull()
		document.body.append(element)
		await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2))
		await vi.waitFor(() =>
			expect(element.shadowRoot!.querySelector(".renderer-status")!.textContent).toContain(
				"active"
			)
		)
		element.remove()
		expect(destroy).toHaveBeenCalledTimes(2)
	})
})