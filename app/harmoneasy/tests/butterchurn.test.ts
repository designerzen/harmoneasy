// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import OutputButterchurn from "../../../packages/audiobus/io/outputs/output-butterchurn"

const require = createRequire(
	resolve(import.meta.dirname, "../../../packages/audiobus/package.json")
)

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

it.each([1, 2, 3])(
	"initializes and resizes Butterchurn at %sx display density",
	async (pixelRatio) => {
		vi.useFakeTimers()
		vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(pixelRatio)
		let resize: ResizeObserverCallback = () => {}
		const observe = vi.fn()
		const disconnect = vi.fn()
		vi.stubGlobal(
			"ResizeObserver",
			class {
				constructor(callback: ResizeObserverCallback) {
					resize = callback
				}
				observe = observe
				disconnect = disconnect
			}
		)
		// Keep the real package exports; only replace the WebGL factory.
		const butterchurn = require("butterchurn").default
		const visualizer = {
			connectAudio: vi.fn(),
			disconnectAudio: vi.fn(),
			loadPreset: vi.fn(),
			render: vi.fn(),
			setRendererSize: vi.fn()
		}
		const createVisualizer = vi
			.spyOn(butterchurn, "createVisualizer")
			.mockReturnValue(visualizer)
		const analyser = { fftSize: 0 }
		const audioContext = { createAnalyser: () => analyser } as unknown as AudioContext
		const gainNode = { connect: vi.fn() } as unknown as GainNode
		const output = new OutputButterchurn(gainNode, audioContext)

		try {
			const canvas = await output.createGui()
			expect(createVisualizer).toHaveBeenCalledExactlyOnceWith(audioContext, canvas, {
				width: 404,
				height: 256,
				pixelRatio: 1
			})
			expect(visualizer.connectAudio).toHaveBeenCalledWith(analyser)
			expect(visualizer.loadPreset).toHaveBeenCalledWith(expect.any(Object), 0.5)
			expect(visualizer.render).toHaveBeenCalledOnce()
			expect(observe).toHaveBeenCalledWith(canvas)
			for (const [width, height] of [
				[1600, 1200],
				[404, 256]
			]) {
				vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
					width,
					height
				} as DOMRect)
				resize([], {} as ResizeObserver)
				expect(canvas.width).toBe(Math.round(width * window.devicePixelRatio))
				expect(canvas.height).toBe(Math.round(height * window.devicePixelRatio))
				expect(visualizer.setRendererSize).toHaveBeenLastCalledWith(
					canvas.width,
					canvas.height,
					{
						pixelRatio: 1
					}
				)
			}
		} finally {
			await output.destroyGui()
			expect(disconnect).toHaveBeenCalledOnce()
		}
	}
)

it("steers preset parameters with mouse, pen and touch gestures and cleans up on recreation", async () => {
	vi.useFakeTimers()
	const preset = {
		baseVals: {},
		shapes: [],
		waves: [],
		init_eqs_str: "a.q1 = 0.1;",
		frame_eqs_str: "a.rot = 0.1; a.zoom = 1.02; a.warp = 2; a.dx = 0; a.dy = 0;",
		pixel_eqs_str: ""
	}
	vi.spyOn(require("butterchurn-presets"), "getPresets").mockReturnValue({ test: preset })
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		}
	)
	const visualizer = {
		connectAudio: vi.fn(),
		disconnectAudio: vi.fn(),
		loadPreset: vi.fn(),
		render: vi.fn(),
		setRendererSize: vi.fn()
	}
	vi.spyOn(require("butterchurn").default, "createVisualizer").mockReturnValue(visualizer)
	const output = new OutputButterchurn(
		{ connect: vi.fn() } as unknown as GainNode,
		{
			createAnalyser: () => ({ fftSize: 0 })
		} as unknown as AudioContext
	)
	const canvas = await output.createGui()
	vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
		left: 10,
		top: 20,
		width: 400,
		height: 200
	} as DOMRect)
	canvas.setPointerCapture = vi.fn()
	canvas.hasPointerCapture = vi.fn(() => true)
	canvas.releasePointerCapture = vi.fn()
	const send = (type: string, x: number, y: number, pointerType = "mouse") =>
		canvas.dispatchEvent(
			new PointerEvent(type, {
				clientX: x,
				clientY: y,
				pointerId: 1,
				isPrimary: true,
				button: 0,
				pointerType
			})
		)
	const frame = visualizer.loadPreset.mock.calls[0][0].frame_eqs
	const variables = () => ({
		rot: 0,
		zoom: 1,
		warp: 1,
		dx: 0,
		dy: 0,
		bass: 1,
		mid: 1,
		treb: 1,
		time: 1,
		fps: 60,
		frame: 1
	})
	const idle = frame(variables())
	expect(idle.rot).toBe(0.1)
	expect(idle.zoom).toBe(1.02)
	expect(preset).not.toHaveProperty("frame_eqs")
	try {
		send("pointermove", 410, 20)
		const moved = frame(variables())
		expect(moved.rot - idle.rot).toBeCloseTo(0.025)
		expect(moved.zoom / idle.zoom).toBeCloseTo(1.025)
		send("pointerleave", 410, 20)
		expect(frame(variables()).rot).toBeCloseTo(idle.rot)
		send("pointerdown", 210, 120, "pen")
		expect(frame(variables()).warp - idle.warp).toBeCloseTo(1.5)
		expect(canvas.setPointerCapture).toHaveBeenCalledWith(1)
		send("pointerup", 210, 120, "pen")
		vi.advanceTimersByTime(100)
		send("pointerdown", 210, 120, "touch")
		send("pointerup", 210, 120, "touch")
		expect(visualizer.loadPreset).toHaveBeenCalledTimes(2)
		vi.advanceTimersByTime(400)
		send("pointerdown", 210, 120, "touch")
		send("pointermove", 410, 120, "touch")
		send("pointerup", 410, 120, "touch")
		expect(frame(variables()).dx - idle.dx).toBeCloseTo(0.0125)
		expect(visualizer.loadPreset).toHaveBeenCalledTimes(2)
		vi.advanceTimersByTime(1500)
		expect(frame(variables()).dx - idle.dx).toBeLessThan(0.001)
		send("pointerdown", 210, 120, "touch")
		send("pointercancel", 210, 120, "touch")
		send("pointerup", 210, 120, "touch")
		expect(visualizer.loadPreset).toHaveBeenCalledTimes(2)
	} finally {
		await output.destroyGui()
	}
	const calls = visualizer.loadPreset.mock.calls.length
	send("pointerdown", 210, 120)
	send("pointerup", 210, 120)
	send("pointerdown", 210, 120)
	send("pointerup", 210, 120)
	expect(visualizer.loadPreset).toHaveBeenCalledTimes(calls)
	expect(visualizer.disconnectAudio).toHaveBeenCalledOnce()
	await output.createGui()
	expect(visualizer.connectAudio).toHaveBeenCalledTimes(2)
	await output.destroyGui()
})