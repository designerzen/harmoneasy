import { EVENT_SELECT_START, EVENT_SELECT_END, EVENT_SESSION_END } from "./events"
import type { GpuSurfaceRenderer, WidgetVisual } from "./renderer"

// Structural types isolate the experimental WebGPU binding from the standard DOM library.
interface XRInput {
	targetRaySpace: object
	gamepad?: { buttons: { pressed: boolean }[] }
}
interface XRView {
	projectionMatrix: Float32Array
	transform: { inverse: { matrix: Float32Array } }
}
interface XRFrame {
	getViewerPose(space: object): { views: XRView[] } | null
	getPose(space: object, reference: object): { transform: { matrix: Float32Array } } | null
}
interface XRSession extends EventTarget {
	inputSources: Iterable<XRInput>
	requestReferenceSpace(type: string): Promise<object>
	updateRenderState(state: { layers: object[] }): void
	requestAnimationFrame(callback: (time: number, frame: XRFrame) => void): number
	end(): Promise<void>
}
interface XRBinding {
	getPreferredColorFormat(): GPUTextureFormat
	createProjectionLayer(options: { colorFormat: GPUTextureFormat }): object
	getViewSubImage(
		layer: object,
		view: XRView
	): {
		colorTexture: GPUTexture
		getViewDescriptor(): GPUTextureViewDescriptor
		viewport: { x: number; y: number; width: number; height: number }
	}
}
interface PointerTarget {
	pointerDown(id: number, x: number, y: number): boolean
	pointerMove(id: number, x: number, y: number): void
	pointerUp(id: number): void
}

export function multiplyMatrices(a: Float32Array, b: Float32Array): Float32Array {
	const out = new Float32Array(16)
	for (let col = 0; col < 4; col++) {
		for (let row = 0; row < 4; row++) {
			for (let i = 0; i < 4; i++) {
				out[col * 4 + row] += a[i * 4 + row] * b[col * 4 + i]
			}
		}
	}
	return out
}
export function intersectPanel(
	matrix: Float32Array,
	width: number,
	height: number
): { x: number; y: number } | undefined {
	const dz = -matrix[10]
	if (Math.abs(dz) < 0.00001) {
		return
	}
	const t = (-1.3 - matrix[14]) / dz
	if (t < 0) {
		return
	}
	const worldX = matrix[12] - matrix[8] * t,
		worldY = matrix[13] - matrix[9] * t
	const physicalWidth = 1.2,
		physicalHeight = (physicalWidth * height) / width
	const x = (worldX / physicalWidth + 0.5) * width,
		y = (0.5 - worldY / physicalHeight) * height
	if (x < 0 || x > width || y < 0 || y > height) {
		return
	}
	return { x, y }
}

/** Floating panel with stereo rendering, controller rays, and hand-select input. */
export async function startSurfaceXR(
	renderer: GpuSurfaceRenderer,
	scene: () => { widgets: WidgetVisual[]; width: number; height: number },
	pointer: PointerTarget,
	ended: () => void,
	failed: (error: unknown) => void = () => {}
): Promise<{ end(): Promise<void> }> {
	const xr = (
		navigator as unknown as {
			xr?: { requestSession(mode: string, options: object): Promise<XRSession> }
		}
	).xr
	const Binding = (
		globalThis as unknown as {
			XRGPUBinding?: new (session: XRSession, device: GPUDevice) => XRBinding
		}
	).XRGPUBinding
	if (!xr || !Binding) {
		throw new Error("This browser does not expose WebXR with WebGPU")
	}
	const session = await xr.requestSession("immersive-vr", {
		requiredFeatures: ["webgpu"],
		optionalFeatures: ["hand-tracking"]
	})
	const pressed = new Map<XRInput, { id: number; down: boolean }>(),
		selected = new WeakSet<object>()
	let nextId = -1,
		stopped = false
	const cleanup = () => {
		if (stopped) {
			return
		}
		stopped = true
		for (const { id } of pressed.values()) {
			pointer.pointerUp(id)
		}
		ended()
	}
	session.addEventListener(EVENT_SESSION_END, cleanup, { once: true })
	session.addEventListener(EVENT_SELECT_START, (event) =>
		selected.add((event as Event & { inputSource: XRInput }).inputSource)
	)
	session.addEventListener(EVENT_SELECT_END, (event) =>
		selected.delete((event as Event & { inputSource: XRInput }).inputSource)
	)
	try {
		const binding = new Binding(session, renderer.device)
		await renderer.setFormat(binding.getPreferredColorFormat())
		const layer = binding.createProjectionLayer({ colorFormat: renderer.format }),
			space = await session.requestReferenceSpace("local")
		session.updateRenderState({ layers: [layer] })
		const renderFrame = (time: number, frame: XRFrame) => {
			if (stopped) {
				return
			}
			const { width, height, widgets } = scene(),
				pose = frame.getViewerPose(space)
			if (pose && width > 0 && height > 0) {
				const cursors: { x: number; y: number }[] = []
				const present = new Set(session.inputSources)
				for (const [source, state] of pressed) {
					if (!present.has(source)) {
						pointer.pointerUp(state.id)
						pressed.delete(source)
					}
				}
				for (const source of present) {
					let state = pressed.get(source)
					if (!state) {
						state = { id: nextId--, down: false }
						pressed.set(source, state)
					}
					const ray = frame.getPose(source.targetRaySpace, space),
						hit = ray ? intersectPanel(ray.transform.matrix, width, height) : undefined
					if (hit) {
						cursors.push(hit)
					}
					const down = !!source.gamepad?.buttons[0]?.pressed || selected.has(source)
					if (hit) {
						if (down && !state.down) {
							pointer.pointerDown(state.id, hit.x, hit.y)
						}
						if (down) {
							pointer.pointerMove(state.id, hit.x, hit.y)
						}
					}
					if (!down || !hit) {
						pointer.pointerUp(state.id)
					}
					state.down = down
				}
				renderer.prepare(
					widgets,
					!matchMedia("(prefers-reduced-motion: reduce)").matches,
					cursors
				)
				const scale = 1.2 / width
				const model = new Float32Array([
					scale,
					0,
					0,
					0,
					0,
					-scale,
					0,
					0,
					0,
					0,
					1,
					0,
					-0.6,
					(height * scale) / 2,
					-1.3,
					1
				])
				for (const view of pose.views) {
					const sub = binding.getViewSubImage(layer, view)
					renderer.draw(
						sub.colorTexture.createView(sub.getViewDescriptor()),
						multiplyMatrices(
							view.projectionMatrix,
							multiplyMatrices(view.transform.inverse.matrix, model)
						),
						width,
						height,
						time / 1000,
						true,
						sub.viewport,
						{ width: sub.colorTexture.width, height: sub.colorTexture.height }
					)
				}
			}
		}
		const loop = (time: number, frame: XRFrame) => {
			try {
				renderFrame(time, frame)
				if (!stopped) {
					session.requestAnimationFrame(loop)
				}
			} catch (error) {
				failed(error)
				cleanup()
				void session.end().catch(() => {})
			}
		}
		session.requestAnimationFrame(loop)
		return {
			async end() {
				await session.end()
				cleanup()
			}
		}
	} catch (error) {
		await session.end().catch(() => {})
		cleanup()
		throw error
	}
}