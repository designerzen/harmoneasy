import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EVENT_MESSAGE } from "../../../packages/audiobus/event-constants"

const vision = vi.hoisted(() => ({
	forVisionTasks: vi.fn(),
	createFromOptions: vi.fn(),
	detectForVideo: vi.fn()
}))
// Resolve from the package that owns the worker, rather than the app's dependencies.
vi.mock("../../../packages/audiobus/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs", () => ({
	FilesetResolver: { forVisionTasks: vision.forVisionTasks },
	HandLandmarker: { createFromOptions: vision.createFromOptions }
}))

describe("camera gestures module worker", () => {
	let receive: (event: MessageEvent) => Promise<void>
	const postMessage = vi.fn()
	beforeEach(async () => {
		vi.resetModules(); vi.clearAllMocks()
		vision.forVisionTasks.mockResolvedValue({ wasmLoaderPath: "vision_wasm_module_internal.js" })
		vision.createFromOptions.mockResolvedValue({ detectForVideo: vision.detectForVideo })
		vision.detectForVideo.mockReturnValue({ landmarks: [] })
		vi.stubGlobal("self", {
			postMessage,
			addEventListener: (type: string, listener: typeof receive) => {
				if (type === EVENT_MESSAGE) receive = listener
			}
		})
		await import("../../../packages/audiobus/io/inputs/camera-gestures.worker")
	})
	afterEach(() => { vi.unstubAllGlobals() })

	it("requests the module-compatible WASM loader before reporting ready", async () => {
		await receive({ data: { type: "init" } } as MessageEvent)
		expect(vision.forVisionTasks).toHaveBeenCalledWith(
			"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0/wasm", true
		)
		expect(vision.createFromOptions).toHaveBeenCalledWith(
			{ wasmLoaderPath: "vision_wasm_module_internal.js" },
			expect.objectContaining({ runningMode: "VIDEO", numHands: 1 })
		)
		expect(postMessage).toHaveBeenCalledWith({ type: "ready" })
	})
	it("processes a camera frame and releases the transferred bitmap", async () => {
		await receive({ data: { type: "init" } } as MessageEvent)
		const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
		vision.detectForVideo.mockReturnValue({ landmarks: [landmarks] })
		const bitmap = { close: vi.fn() }
		await receive({ data: { type: "frame", bitmap, timestamp: 123 } } as MessageEvent)
		expect(vision.detectForVideo).toHaveBeenCalledWith(bitmap, 123)
		expect(postMessage).toHaveBeenLastCalledWith({ type: "landmarks", landmarks })
		expect(bitmap.close).toHaveBeenCalledOnce()
	})
	it("reports failed inference and still releases its bitmap", async () => {
		await receive({ data: { type: "init" } } as MessageEvent)
		vision.detectForVideo.mockImplementationOnce(() => { throw new Error("Inference failed") })
		const bitmap = { close: vi.fn() }
		await receive({ data: { type: "frame", bitmap, timestamp: 123 } } as MessageEvent)
		expect(postMessage).toHaveBeenLastCalledWith({ type: "error", message: "Inference failed" })
		expect(bitmap.close).toHaveBeenCalledOnce()
	})
})
