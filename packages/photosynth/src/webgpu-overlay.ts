import { EXPRESSION_EMOJIS } from "./emoji.js"
import type { EmojiState } from "./emoji.js"
import { GPU_UNCAPTURED_ERROR } from "./events.js"
import { containedVideoRect, faceEmojiPlacement } from "./overlay-layout.js"
import type { FacePrediction } from "./types.js"

const CELL = 128,
	COLUMNS = 6,
	FLOATS_PER_INSTANCE = 12,
	MAX_INSTANCES = 513
const GLYPHS = Object.values(EXPRESSION_EMOJIS).map(([glyph]) => glyph)
const SHADER = `
struct Viewport { size: vec2f, padding: vec2f }
@group(0) @binding(0) var<uniform> viewport: Viewport;
@group(0) @binding(1) var atlas: texture_2d<f32>;
@group(0) @binding(2) var atlasSampler: sampler;
struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) local: vec2f,
    @location(2) @interpolate(flat) kind: f32,
}
@vertex fn vertexMain(@builtin(vertex_index) vertex: u32,
    @location(0) centre: vec2f, @location(1) size: vec2f,
    @location(2) uvOrigin: vec2f, @location(3) uvSize: vec2f,
    @location(4) rotation: f32, @location(5) kind: f32, @location(6) mirror: f32) -> VertexOutput {
    var corners = array<vec2f, 6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
    let corner = corners[vertex];
    let offset = corner * size * 0.5;
    let rotated = vec2f(offset.x*cos(rotation)-offset.y*sin(rotation), offset.x*sin(rotation)+offset.y*cos(rotation));
    let pixel = centre + rotated;
    var output: VertexOutput;
    output.position = vec4f(pixel.x / viewport.size.x * 2.0 - 1.0, 1.0 - pixel.y / viewport.size.y * 2.0, 0, 1);
    output.uv = uvOrigin + (vec2f(corner.x * mirror, corner.y) + 1.0) * 0.5 * uvSize;
    output.local = corner;
    output.kind = kind;
    return output;
}
@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    if (input.kind < 0.5) {
        let alpha = 1.0 - smoothstep(0.75, 1.0, length(input.local));
        return vec4f(vec3f(0.725,0.95,0.44) * alpha, alpha);
    }
    return textureSampleLevel(atlas, atlasSampler, input.uv, 0.0);
}`

/** Rasterize platform emoji glyphs once as an SVG image; all frame drawing happens in WebGPU. */
async function loadEmojiAtlas(): Promise<ImageBitmap> {
	const rows = Math.ceil(GLYPHS.length / COLUMNS)
	const texts = GLYPHS.map(
		(glyph, index) =>
			`<text x="${(index % COLUMNS) * CELL + CELL / 2}" y="${Math.floor(index / COLUMNS) * CELL + 104}" text-anchor="middle">${glyph}</text>`
	).join("")
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${COLUMNS * CELL}" height="${rows * CELL}"><g font-family="Segoe UI Emoji,Apple Color Emoji,Noto Color Emoji,sans-serif" font-size="100">${texts}</g></svg>`
	const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }))
	try {
		const image = new Image()
		image.src = url
		await image.decode()
		return await createImageBitmap(image, { premultiplyAlpha: "premultiply" })
	} finally {
		URL.revokeObjectURL(url)
	}
}

/** One instanced WebGPU draw for every dot and the face-following emoji sprite. No Canvas2D path. */
export class WebGPUFaceOverlay {
	private disposed = false
	private vertices: GPUBuffer
	private uniform: GPUBuffer
	private binding: GPUBindGroup
	private values = new Float32Array(MAX_INSTANCES * FLOATS_PER_INSTANCE)

	private constructor(
		private canvas: HTMLCanvasElement,
		private device: GPUDevice,
		private context: GPUCanvasContext,
		private pipeline: GPURenderPipeline,
		private texture: GPUTexture,
		onError: (error: Error) => void
	) {
		this.vertices = device.createBuffer({
			size: this.values.byteLength,
			usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
		})
		this.uniform = device.createBuffer({
			size: 16,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		})
		this.binding = device.createBindGroup({
			layout: pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: this.uniform } },
				{ binding: 1, resource: texture.createView() },
				{
					binding: 2,
					resource: device.createSampler({ magFilter: "linear", minFilter: "linear" })
				}
			]
		})
		void device.lost.then((info) => {
			if (!this.disposed) {
				this.destroy()
				onError(new Error(`WebGPU overlay lost: ${info.message || info.reason}`))
			}
		})
		device.addEventListener(GPU_UNCAPTURED_ERROR, (event) => {
			if (!this.disposed) {
				this.destroy()
				onError(new Error((event as GPUUncapturedErrorEvent).error.message))
			}
		})
	}

	static async create(
		canvas: HTMLCanvasElement,
		onError: (error: Error) => void
	): Promise<WebGPUFaceOverlay> {
		if (!navigator.gpu) {
			throw new Error(
				"WebGPU is unavailable. Landmark dots require a WebGPU-capable browser over HTTPS or localhost."
			)
		}
		const adapter = await navigator.gpu.requestAdapter()
		if (!adapter) {
			throw new Error("No WebGPU adapter is available. Landmark dots are disabled.")
		}
		const device = await adapter.requestDevice()
		let texture: GPUTexture | undefined
		let context: GPUCanvasContext | null = null
		try {
			context = canvas.getContext("webgpu") as GPUCanvasContext | null
			if (!context) {
				throw new Error("Unable to create a WebGPU canvas.")
			}
			const format = navigator.gpu.getPreferredCanvasFormat()
			context.configure({ device, format, alphaMode: "premultiplied" })
			const bitmap = await loadEmojiAtlas()
			try {
				texture = device.createTexture({
					size: [bitmap.width, bitmap.height],
					format: "rgba8unorm",
					usage:
						GPUTextureUsage.TEXTURE_BINDING |
						GPUTextureUsage.COPY_DST |
						GPUTextureUsage.RENDER_ATTACHMENT
				})
				device.queue.copyExternalImageToTexture(
					{ source: bitmap },
					{ texture, premultipliedAlpha: true },
					[bitmap.width, bitmap.height]
				)
			} finally {
				bitmap.close()
			}
			const module = device.createShaderModule({ code: SHADER })
			const pipeline = await device.createRenderPipelineAsync({
				layout: "auto",
				vertex: {
					module,
					entryPoint: "vertexMain",
					buffers: [
						{
							arrayStride: FLOATS_PER_INSTANCE * 4,
							stepMode: "instance",
							attributes: [
								{ shaderLocation: 0, offset: 0, format: "float32x2" },
								{ shaderLocation: 1, offset: 8, format: "float32x2" },
								{ shaderLocation: 2, offset: 16, format: "float32x2" },
								{ shaderLocation: 3, offset: 24, format: "float32x2" },
								{ shaderLocation: 4, offset: 32, format: "float32" },
								{ shaderLocation: 5, offset: 36, format: "float32" },
								{ shaderLocation: 6, offset: 40, format: "float32" }
							]
						}
					]
				},
				fragment: {
					module,
					entryPoint: "fragmentMain",
					targets: [
						{
							format,
							blend: {
								color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
								alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" }
							}
						}
					]
				},
				primitive: { topology: "triangle-list" }
			})
			return new WebGPUFaceOverlay(canvas, device, context, pipeline, texture, onError)
		} catch (error) {
			texture?.destroy()
			context?.unconfigure()
			device.destroy()
			throw error
		}
	}

	render(
		face: FacePrediction | null,
		emoji: EmojiState | null,
		videoWidth: number,
		videoHeight: number,
		dots = true
	): void {
		if (this.disposed) {
			return
		}
		const ratio = Math.min(2, globalThis.devicePixelRatio || 1)
		const max = this.device.limits.maxTextureDimension2D
		const width = Math.min(
			max,
			Math.max(1, Math.round((this.canvas.clientWidth || 640) * ratio))
		)
		const height = Math.min(
			max,
			Math.max(1, Math.round((this.canvas.clientHeight || 480) * ratio))
		)
		if (this.canvas.width !== width || this.canvas.height !== height) {
			this.canvas.width = width
			this.canvas.height = height
		}
		const rect = containedVideoRect(width, height, videoWidth || 640, videoHeight || 480)
		let count = 0
		if (face && dots) {
			for (const point of face.keypoints) {
				if (count >= MAX_INSTANCES - 1) {
					break
				}
				if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
					continue
				}
				this.values.set(
					[
						rect.x + point.x * rect.width,
						rect.y + point.y * rect.height,
						3.5 * ratio,
						3.5 * ratio,
						0,
						0,
						0,
						0,
						0,
						0,
						1,
						0
					],
					count++ * FLOATS_PER_INSTANCE
				)
			}
		}
		if (face && emoji) {
			const placement = faceEmojiPlacement(face, rect)
			if (placement) {
				const index = GLYPHS.indexOf(emoji.glyph as (typeof GLYPHS)[number])
				const rows = Math.ceil(GLYPHS.length / COLUMNS)
				const slot = Math.max(0, index)
				this.values.set(
					[
						placement.x,
						placement.y,
						placement.size,
						placement.size,
						(slot % COLUMNS) / COLUMNS,
						Math.floor(slot / COLUMNS) / rows,
						1 / COLUMNS,
						1 / rows,
						placement.rotation,
						1,
						emoji.mirrored ? -1 : 1,
						0
					],
					count++ * FLOATS_PER_INSTANCE
				)
			}
		}
		this.device.queue.writeBuffer(this.uniform, 0, new Float32Array([width, height, 0, 0]))
		if (count) {
			this.device.queue.writeBuffer(
				this.vertices,
				0,
				this.values.buffer,
				0,
				count * FLOATS_PER_INSTANCE * 4
			)
		}
		const encoder = this.device.createCommandEncoder()
		const pass = encoder.beginRenderPass({
			colorAttachments: [
				{
					view: this.context.getCurrentTexture().createView(),
					clearValue: { r: 0, g: 0, b: 0, a: 0 },
					loadOp: "clear",
					storeOp: "store"
				}
			]
		})
		if (count) {
			pass.setPipeline(this.pipeline)
			pass.setBindGroup(0, this.binding)
			pass.setVertexBuffer(0, this.vertices)
			pass.draw(6, count)
		}
		pass.end()
		this.device.queue.submit([encoder.finish()])
	}

	destroy(): void {
		if (this.disposed) {
			return
		}
		this.disposed = true
		this.vertices.destroy()
		this.uniform.destroy()
		this.texture.destroy()
		this.context.unconfigure()
		this.device.destroy()
	}
}