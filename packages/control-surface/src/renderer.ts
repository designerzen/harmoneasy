/// <reference types="@webgpu/types" />
import { EVENT_GPU_ERROR } from "./events"
import { formatValue, normalize, sameValue } from "./model"
import type { ControlDescriptor, ControlValue, WidgetType } from "./types"

export interface WidgetVisual {
	key: string
	x: number
	y: number
	width: number
	height: number
	descriptor: ControlDescriptor
	value: ControlValue | undefined
	widget: WidgetType
	sourceLabel: string
	active?: boolean
	unavailable?: boolean
}
export type SurfaceTheme = "neon" | "amber" | "ice"
const COLORS: Record<SurfaceTheme, number[]> = {
	neon: [0.18, 1, 0.7],
	amber: [1, 0.62, 0.12],
	ice: [0.3, 0.72, 1]
}
const STRIDE = 20
const DEFAULT_EFFECT =
	"fn surfaceEffect(color: vec4f, uv: vec2f, time: f32) -> vec4f { return color; }"
const POST_SHADER = `
@group(0) @binding(0) var surfaceTexture: texture_2d<f32>;
@group(0) @binding(1) var surfaceSampler: sampler;
@group(0) @binding(2) var<uniform> postFrame: vec4f;
struct PostVertex { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn postVertex(@builtin(vertex_index) index: u32)->PostVertex {
 let positions=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
 let p=positions[index]; var o:PostVertex;o.position=vec4f(p,0,1);o.uv=vec2f(p.x*0.5+0.5,0.5-p.y*0.5);return o;
}
/* POST_EFFECT */
@fragment fn postFragment(i:PostVertex)->@location(0) vec4f { return postEffect(i.uv,postFrame.x); }
`
const DEFAULT_POST_EFFECT = `
fn postEffect(uv:vec2f,time:f32)->vec4f {
 let original=textureSampleLevel(surfaceTexture,surfaceSampler,uv,0.0);
 let texel=1.0/vec2f(textureDimensions(surfaceTexture));
 var glow=vec3f(0);
 let offsets=array<vec2f,8>(vec2f(-2,-2),vec2f(0,-3),vec2f(2,-2),vec2f(-3,0),vec2f(3,0),vec2f(-2,2),vec2f(0,3),vec2f(2,2));
 for(var n=0;n<8;n++){let sample=textureSampleLevel(surfaceTexture,surfaceSampler,uv+offsets[n]*texel,0.0);glow+=max(sample.rgb-vec3f(0.25),vec3f(0));}
 return vec4f(original.rgb+glow*0.055,max(original.a,max(glow.r,max(glow.g,glow.b))*0.055));
}`
const SHADER = `
struct Frame { projection: mat4x4f, viewport: vec2f, time: f32, motion: f32 }
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var atlas: texture_2d<f32>;
@group(0) @binding(2) var atlasSampler: sampler;
struct VertexOutput {
 @builtin(position) position: vec4f,
 @location(0) uv: vec2f,
 @location(1) @interpolate(flat) rect: vec4f,
 @location(2) @interpolate(flat) params: vec4f,
 @location(3) @interpolate(flat) color: vec4f,
 @location(4) @interpolate(flat) extra: vec4f,
 @location(5) @interpolate(flat) textureRect: vec4f,
}
@vertex fn vertexMain(@builtin(vertex_index) index: u32,
 @location(0) rect: vec4f, @location(1) params: vec4f, @location(2) color: vec4f,
 @location(3) extra: vec4f, @location(4) textureRect: vec4f) -> VertexOutput {
 let corners = array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1));
 let uv = corners[index]; var o: VertexOutput;
 o.position = frame.projection * vec4f(rect.xy + uv * rect.zw, 0, 1);
 o.uv=uv; o.rect=rect; o.params=params; o.color=color; o.extra=extra; o.textureRect=textureRect; return o;
}
fn line(distance: f32, thickness: f32) -> f32 { return 1.0-smoothstep(thickness, thickness+1.0, abs(distance))+0.12*exp(-abs(distance)*0.32); }
fn box(p: vec2f, b: vec2f, r: f32) -> f32 { let q=abs(p)-b+vec2f(r); return min(max(q.x,q.y),0.0)+length(max(q,vec2f(0)))-r; }
/* EFFECT */
@fragment fn fragmentMain(i: VertexOutput) -> @location(0) vec4f {
 let kind=i.params.x; let value=i.params.y; let second=i.params.z; let engaged=i.params.w;
 let size=i.rect.zw; let p=(i.uv-0.5)*size; var light=0.0; var fill=0.0;
 if (kind>8.5) {
  let alpha=textureSampleLevel(atlas,atlasSampler,i.textureRect.xy+i.uv*i.textureRect.zw,0.0).a;
  return vec4f(i.color.rgb,alpha*i.color.a);
 }
 if (kind<0.5) {
  let edge=box(p,size*0.5-vec2f(2),10);
  let grid=max(line((i.uv.x*size.x)%16.0,0.25),line((i.uv.y*size.y)%16.0,0.25));
  let a=1.0-smoothstep(0.0,1.0,edge);
  let rgb=mix(vec3f(0.022,0.031,0.048),i.color.rgb,grid*0.018)+i.color.rgb*line(edge,0.6)*(0.15+engaged*0.55);
  return surfaceEffect(vec4f(rgb,a),i.uv,frame.time);
 } else if (kind<1.5) {
  let radius=min(size.x,size.y)*0.34; let dist=length(p)-radius;
  let angle=atan2(p.x,-p.y); let t=(angle+2.35619449)/4.71238898;
  let inArc=select(0.0,1.0,t>=0.0&&t<=1.0);
  light=line(dist,2.2)*inArc*select(0.12,1.0,t<=value);
  let needle=vec2f(sin(value*4.71238898-2.35619449),-cos(value*4.71238898-2.35619449));
  light=max(light,line(length(p-needle*radius),3.5));
  fill=(1.0-smoothstep(radius-7.0,radius-5.0,length(p)))*0.055;
  let tick=floor(t*20.0+0.5)/20.0; let tickAngle=tick*4.71238898-2.35619449;
  light=max(light,line(length(p-vec2f(sin(tickAngle),-cos(tickAngle))*(radius+10.0)),1.0)*inArc*0.35);
 } else if (kind<2.5 || (kind>6.5&&kind<7.5)) {
  let w=size.x*0.42; let x=-w+value*w*2.0;
  light=line(p.y,2.0)*step(abs(p.x),w)*select(0.1,0.8,p.x<=x);
  light=max(light,line(length(p-vec2f(x,0)),5.0));
  if (second>=0.0) { light=max(light,line(length(p-vec2f(-w+second*w*2.0,0)),5.0)); }
 } else if (kind<3.5) {
  let w=min(size.x*0.25,36.0); let d=box(p,vec2f(w,14),14);
  light=line(d,1.0)*0.45+line(length(p-vec2f(mix(-w+15.0,w-15.0,value),0))-9.0,2.5);
  fill=(1.0-smoothstep(-1.0,0.0,d))*(0.04+value*0.08);
 } else if (kind<4.5) {
  let extent=size*0.42; let d=box(p,extent,4);
  light=line(d,0.6)*0.25;
  let point=vec2f(mix(-extent.x,extent.x,value),mix(extent.y,-extent.y,second));
  light=max(light,max(line(p.x-point.x,0.4),line(p.y-point.y,0.4))*step(max(abs(p.x)/extent.x,abs(p.y)/extent.y),1.0)*0.25);
  light=max(light,line(length(p-point),5.0));
 } else if (kind<5.5) {
  let d=box(p,size*0.4,6); light=line(d,1.1)*(0.45+engaged*0.55); fill=(1.0-smoothstep(-1.0,0.0,d))*(0.04+engaged*0.18);
 } else if (kind<6.5) {
  let count=max(1.0,i.extra.x); let segment=floor(i.uv.x*count); let center=(segment+0.5)/count;
  let d=length(vec2f((i.uv.x-center)*size.x,p.y))-7.0;
  light=line(d,1.0)*select(0.2,1.0,abs(segment-value)<0.1);
  fill=(1.0-smoothstep(-1.0,0.0,d))*select(0.0,0.4,abs(segment-value)<0.1);
 } else {
  let d=box(p,size*0.43,4); light=line(d,0.6)*0.35;
 }
 let pulse=1.0+sin(frame.time*3.0)*engaged*0.12*frame.motion;
 let intensity=(light+fill)*pulse;
 let rgb=i.color.rgb*intensity;
 return surfaceEffect(vec4f(rgb,clamp(intensity,0.0,1.0)*i.color.a),i.uv,frame.time);
}`

/** One instanced pipeline for widget geometry and atlas text. No per-widget GPU objects. */
export class GpuSurfaceRenderer {
	private buffer: GPUBuffer
	private uniform: GPUBuffer
	private atlas: GPUTexture
	private pipeline!: GPURenderPipeline
	private binding!: GPUBindGroup
	private postPipeline!: GPURenderPipeline
	private postBinding?: GPUBindGroup
	private postUniform: GPUBuffer
	private sceneTexture?: GPUTexture
	private capacity = 4096
	private instances: number[] = []
	private disposed = false
	private color = COLORS.neon
	private smoothed = new Map<string, number[]>()
	format: GPUTextureFormat
	private effect = DEFAULT_EFFECT
	private postEffect = DEFAULT_POST_EFFECT
	private constructor(
		readonly canvas: HTMLCanvasElement,
		readonly device: GPUDevice,
		private context: GPUCanvasContext,
		private onError: (error: Error) => void
	) {
		this.format = navigator.gpu.getPreferredCanvasFormat()
		this.context.configure({ device, format: this.format, alphaMode: "premultiplied" })
		this.buffer = device.createBuffer({
			size: this.capacity * STRIDE * 4,
			usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
		})
		this.uniform = device.createBuffer({
			size: 80,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		})
		this.postUniform = device.createBuffer({
			size: 16,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		})
		const atlas = document.createElement("canvas")
		atlas.width = 512
		atlas.height = 192
		const ctx = atlas.getContext("2d")!
		ctx.font = "18px monospace"
		ctx.fillStyle = "white"
		ctx.textBaseline = "top"
		for (let code = 32; code < 128; code++) {
			const n = code - 32
			ctx.fillText(String.fromCharCode(code), (n % 16) * 32 + 2, Math.floor(n / 16) * 32 + 4)
		}
		this.atlas = device.createTexture({
			size: [atlas.width, atlas.height],
			format: "rgba8unorm",
			usage:
				GPUTextureUsage.TEXTURE_BINDING |
				GPUTextureUsage.COPY_DST |
				GPUTextureUsage.RENDER_ATTACHMENT
		})
		device.queue.copyExternalImageToTexture({ source: atlas }, { texture: this.atlas }, [
			atlas.width,
			atlas.height
		])
		device.lost.then((info) => {
			if (!this.disposed) {
				this.onError(new Error(`GPU device lost: ${info.message}`))
			}
		})
		device.addEventListener(EVENT_GPU_ERROR, (event: GPUUncapturedErrorEvent) => {
			if (!this.disposed) {
				this.onError(new Error(event.error.message))
			}
		})
	}
	static async create(
		canvas: HTMLCanvasElement,
		onError: (error: Error) => void
	): Promise<GpuSurfaceRenderer> {
		if (!navigator.gpu) {
			throw new Error(
				"WebGPU is unavailable. Use a WebGPU-capable browser or graphics device."
			)
		}
		const adapter =
			(await navigator.gpu.requestAdapter({
				xrCompatible: true
			} as GPURequestAdapterOptions)) ?? (await navigator.gpu.requestAdapter())
		if (!adapter) {
			throw new Error("No WebGPU adapter is available")
		}
		const device = await adapter.requestDevice(),
			context = canvas.getContext("webgpu")
		if (!context) {
			device.destroy()
			throw new Error("Cannot create WebGPU canvas")
		}
		const renderer = new GpuSurfaceRenderer(canvas, device, context, onError)
		try {
			await renderer.setEffect(DEFAULT_EFFECT)
			await renderer.setPostEffect(DEFAULT_POST_EFFECT)
			return renderer
		} catch (error) {
			renderer.destroy()
			throw error
		}
	}
	/** Supply a WGSL surfaceEffect(color, uv, time) function; a failed shader preserves the old pipeline. */
	async setEffect(effect: string): Promise<void> {
		const module = this.device.createShaderModule({
			code: SHADER.replace("/* EFFECT */", effect)
		})
		const info = await module.getCompilationInfo()
		const errors = info.messages.filter((m) => m.type === "error")
		if (errors.length) {
			throw new Error(errors.map((e) => e.message).join("\n"))
		}
		const pipeline = await this.device.createRenderPipelineAsync({
			layout: "auto",
			vertex: {
				module,
				entryPoint: "vertexMain",
				buffers: [
					{
						arrayStride: STRIDE * 4,
						stepMode: "instance",
						attributes: Array.from({ length: 5 }, (_, i) => ({
							shaderLocation: i,
							offset: i * 16,
							format: "float32x4" as GPUVertexFormat
						}))
					}
				]
			},
			fragment: {
				module,
				entryPoint: "fragmentMain",
				targets: [
					{
						format: this.format,
						blend: {
							color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
							alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" }
						}
					}
				]
			},
			primitive: { topology: "triangle-list" }
		})
		if (this.disposed) {
			return
		}
		this.effect = effect
		this.pipeline = pipeline
		this.binding = this.device.createBindGroup({
			layout: pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: this.uniform } },
				{ binding: 1, resource: this.atlas.createView() },
				{
					binding: 2,
					resource: this.device.createSampler({
						magFilter: "linear",
						minFilter: "linear"
					})
				}
			]
		})
	}
	async setFormat(format: GPUTextureFormat): Promise<void> {
		if (format === this.format) {
			return
		}
		this.format = format
		await this.setEffect(this.effect)
		await this.setPostEffect(this.postEffect)
		this.sceneTexture?.destroy()
		this.sceneTexture = undefined
		this.context.configure({ device: this.device, format, alphaMode: "premultiplied" })
	}
	/** A shared full-surface filter pass. The hook can sample surfaceTexture/surfaceSampler. */
	async setPostEffect(effect: string): Promise<void> {
		const module = this.device.createShaderModule({
			code: POST_SHADER.replace("/* POST_EFFECT */", effect)
		})
		const errors = (await module.getCompilationInfo()).messages.filter(
			(m) => m.type === "error"
		)
		if (errors.length) {
			throw new Error(errors.map((e) => e.message).join("\n"))
		}
		const pipeline = await this.device.createRenderPipelineAsync({
			layout: "auto",
			vertex: { module, entryPoint: "postVertex" },
			fragment: { module, entryPoint: "postFragment", targets: [{ format: this.format }] },
			primitive: { topology: "triangle-list" }
		})
		if (this.disposed) {
			return
		}
		this.postPipeline = pipeline
		this.postEffect = effect
		this.postBinding = undefined
	}
	setTheme(theme: SurfaceTheme): void {
		this.color = COLORS[theme]
	}
	private quad(
		x: number,
		y: number,
		w: number,
		h: number,
		kind: number,
		a = 0,
		b = -1,
		active = 0,
		extra = 0,
		alpha = 1,
		uv = [0, 0, 0, 0]
	): void {
		this.instances.push(
			x,
			y,
			w,
			h,
			kind,
			a,
			b,
			active,
			...this.color,
			alpha,
			extra,
			0,
			0,
			0,
			...uv
		)
	}
	private text(text: string, x: number, y: number, width: number, alpha = 1): void {
		const size = 24,
			advance = 9
		for (const [i, char] of Array.from(text.slice(0, Math.floor(width / advance))).entries()) {
			const code = char.charCodeAt(0),
				n = (code >= 32 && code < 128 ? code : 63) - 32
			this.quad(x + i * advance, y, size, size, 9, 0, 0, 0, 0, alpha, [
				((n % 16) * 32) / 512,
				(Math.floor(n / 16) * 32) / 192,
				32 / 512,
				32 / 192
			])
		}
	}
	prepare(
		widgets: WidgetVisual[],
		motion: boolean,
		cursors: { x: number; y: number }[] = []
	): void {
		this.instances = []
		const alive = new Set<string>()
		for (const w of widgets) {
			alive.add(w.key)
			const d = w.descriptor,
				v = w.value,
				active = w.active ? 1 : 0,
				alpha = w.unavailable || d.disabled ? 0.3 : 1
			const choice = d.choices?.findIndex((c) => sameValue(c.value, v)) ?? 0
			const target = Array.isArray(v)
				? v.map((n) => normalize(d, n))
				: [typeof v === "boolean" ? Number(v) : normalize(d, Number(v))]
			const old = this.smoothed.get(w.key) ?? target
			const eased = target.map((n, i) =>
				motion ? (old[i] ?? n) + (n - (old[i] ?? n)) * 0.32 : n
			)
			this.smoothed.set(w.key, eased)
			this.quad(w.x, w.y, w.width, w.height, 0, 0, 0, active, 0, alpha)
			this.text(w.sourceLabel, w.x + 12, w.y + 9, w.width - 24, 0.5 * alpha)
			this.text(d.label, w.x + 12, w.y + 27, w.width - 24, alpha)
			const x = w.x + 8,
				y = w.y + 48,
				width = w.width - 16,
				height = w.height - 76
			const kind = {
				dial: 1,
				slider: 2,
				range: 2,
				toggle: 3,
				xy: 4,
				button: 5,
				radio: 6,
				meter: 7,
				select: 8,
				number: 8,
				text: 8,
				color: 8,
				display: 8
			}[w.widget]
			this.quad(
				x,
				y,
				width,
				height,
				kind,
				w.widget === "radio" ? choice : eased[0],
				w.widget === "xy" || w.widget === "range" ? eased[1] : -1,
				active,
				d.choices?.length ?? 0,
				alpha
			)
			if (w.widget === "radio" && d.choices?.length) {
				const segment = width / d.choices.length
				for (const [index, option] of d.choices.entries()) {
					this.text(
						option.label,
						x + index * segment + 4,
						y + height / 2 + 12,
						segment - 8,
						alpha
					)
				}
			}
			this.text(
				w.unavailable ? "Unavailable" : formatValue(d, v),
				w.x + 12,
				w.y + w.height - 24,
				w.width - 24,
				alpha
			)
		}
		for (const key of this.smoothed.keys()) {
			if (!alive.has(key)) {
				this.smoothed.delete(key)
			}
		}
		for (const cursor of cursors) {
			this.quad(cursor.x - 12, cursor.y - 12, 24, 24, 1, 1, -1, 1)
		}
		const count = this.instances.length / STRIDE
		if (count > this.capacity) {
			this.buffer.destroy()
			this.capacity = 2 ** Math.ceil(Math.log2(count))
			this.buffer = this.device.createBuffer({
				size: this.capacity * STRIDE * 4,
				usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
			})
		}
		if (count) {
			this.device.queue.writeBuffer(this.buffer, 0, new Float32Array(this.instances))
		}
	}
	render(width: number, height: number, time: number, motion: boolean): void {
		if (this.disposed) {
			return
		}
		const ratio = Math.min(devicePixelRatio || 1, 2),
			w = Math.max(1, Math.round(width * ratio)),
			h = Math.max(1, Math.round(height * ratio))
		if (this.canvas.width !== w || this.canvas.height !== h) {
			this.canvas.width = w
			this.canvas.height = h
		}
		this.draw(
			this.context.getCurrentTexture().createView(),
			new Float32Array([2 / width, 0, 0, 0, 0, -2 / height, 0, 0, 0, 0, 1, 0, -1, 1, 0, 1]),
			width,
			height,
			time,
			motion
		)
	}
	/** External target and view projection permit the same widgets to live on an XR plane. */
	draw(
		view: GPUTextureView,
		projection: Float32Array,
		width: number,
		height: number,
		time: number,
		motion: boolean,
		viewport?: { x: number; y: number; width: number; height: number },
		targetSize?: { width: number; height: number }
	): void {
		const frame = new Float32Array(20)
		frame.set(projection)
		frame.set([width, height, time, motion ? 1 : 0], 16)
		this.device.queue.writeBuffer(this.uniform, 0, frame)
		const targetWidth =
				targetSize?.width ?? (viewport ? viewport.x + viewport.width : this.canvas.width),
			targetHeight =
				targetSize?.height ?? (viewport ? viewport.y + viewport.height : this.canvas.height)
		if (
			!this.sceneTexture ||
			this.sceneTexture.width !== targetWidth ||
			this.sceneTexture.height !== targetHeight
		) {
			this.sceneTexture?.destroy()
			this.sceneTexture = this.device.createTexture({
				size: [targetWidth, targetHeight],
				format: this.format,
				usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
			})
			this.postBinding = undefined
		}
		if (!this.postBinding) {
			this.postBinding = this.device.createBindGroup({
				layout: this.postPipeline.getBindGroupLayout(0),
				entries: [
					{ binding: 0, resource: this.sceneTexture.createView() },
					{
						binding: 1,
						resource: this.device.createSampler({
							magFilter: "linear",
							minFilter: "linear"
						})
					},
					{ binding: 2, resource: { buffer: this.postUniform } }
				]
			})
		}
		this.device.queue.writeBuffer(this.postUniform, 0, new Float32Array([time, 0, 0, 0]))
		const encoder = this.device.createCommandEncoder(),
			pass = encoder.beginRenderPass({
				colorAttachments: [
					{
						view: this.sceneTexture.createView(),
						loadOp: "clear",
						storeOp: "store",
						clearValue: { r: 0, g: 0, b: 0, a: 0 }
					}
				]
			})
		if (viewport) {
			pass.setViewport(viewport.x, viewport.y, viewport.width, viewport.height, 0, 1)
		}
		pass.setPipeline(this.pipeline)
		pass.setBindGroup(0, this.binding)
		pass.setVertexBuffer(0, this.buffer)
		pass.draw(6, this.instances.length / STRIDE)
		pass.end()
		const post = encoder.beginRenderPass({
			colorAttachments: [
				{ view, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } }
			]
		})
		post.setPipeline(this.postPipeline)
		post.setBindGroup(0, this.postBinding)
		post.draw(3)
		post.end()
		this.device.queue.submit([encoder.finish()])
	}
	destroy(): void {
		if (this.disposed) {
			return
		}
		this.disposed = true
		this.buffer.destroy()
		this.uniform.destroy()
		this.postUniform.destroy()
		this.sceneTexture?.destroy()
		this.atlas.destroy()
		this.context.unconfigure()
		this.device.destroy()
	}
}