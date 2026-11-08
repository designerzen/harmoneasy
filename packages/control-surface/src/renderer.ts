/// <reference types="@webgpu/types" />
import { envelopeGeometry, envelopeText, envelopeCurve, ENVELOPE_STAGES } from "./envelope"
import type { ChoicePages } from "./choice-pages"
import { choiceGrid, waveformPoints } from "./choices"
import { CONTROL_ICONS, choiceIcon, controlIcon } from "./icons"
import { PadLight, noteColor } from "./pad"
import type { VisualiserFrame } from "./visualiser"
import { beatPulse } from "./beat"
import { EVENT_GPU_ERROR } from "./events"
import { sourceTheme } from "./themes"
import {
	isMusicGrid,
	musicOptions,
	musicRect,
	musicValues,
	noteName,
	type MusicView
} from "./music"
import { relativeRect, type RelativeKeys } from "./relative-keys"
import type { Strum } from "./strum"
import { dialOptions, formatValue, normalize, sameValue } from "./model"
import type {
	ControlDescriptor,
	ControlValue,
	DialOptions,
	SurfaceVisualEffects,
	WidgetType
} from "./types"

export interface WidgetVisual {
	key: string
	x: number
	y: number
	width: number
	height: number
	compact?: boolean
	rotation?: number
	descriptor: ControlDescriptor
	value: ControlValue | undefined
	widget: WidgetType
	sourceLabel: string
	sourceId?: string
	active?: boolean
	focused?: boolean
	dial?: DialOptions
	unavailable?: boolean
	relative?: RelativeKeys
	musicView?: MusicView
	visualiser?: VisualiserFrame
	background?: boolean
	pad?: PadLight
	strum?: Strum
	choices?: ChoicePages
	/** Seconds on the frame clock of the last committed press, for trigger flashes. */
	triggeredAt?: number
}
export type SurfaceTheme = "neon" | "amber" | "ice"
interface CachedWidget {
	data: Float32Array
	offset: number
	x: number
	y: number
	width: number
	height: number
	compact: boolean | undefined
	rotation: number | undefined
	visualiserRevision: number | undefined
	padRevision: number | undefined
	musicRevision: number | undefined
	choicesRevision: number | undefined
	strumRevision: number | undefined
	descriptor: ControlDescriptor
	widget: WidgetType
	sourceLabel: string
	sourceId: string | undefined
	value: ControlValue | undefined
	active: boolean | undefined
	focused: boolean | undefined
	dial: DialOptions | undefined
	unavailable: boolean | undefined
	disabled: boolean | undefined
	triggeredAt: number | undefined
	color: number[]
	epoch: number
}
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
@group(0) @binding(3) var bloomTexture: texture_2d<f32>;
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
 if(postFrame.y>0.0) {
  let step=vec2f(0,postFrame.w/4.0)/vec2f(textureDimensions(bloomTexture));
  let weights=array<f32,5>(0.06,0.24,0.4,0.24,0.06);
  for(var n=0;n<5;n++){
   glow+=textureSampleLevel(bloomTexture,surfaceSampler,uv+step*(f32(n)-2.0)*0.5,0.0).rgb*weights[n];
  }
 }
 glow*=postFrame.y*1.8;
 let scan=1.0-postFrame.z*(0.5+0.5*cos(uv.y/texel.y*2.0943951));
 return vec4f(original.rgb*scan+glow,max(original.a,max(glow.r,max(glow.g,glow.b))));
}`
const BLOOM_EXTRACT = `
fn postEffect(uv:vec2f,time:f32)->vec4f {
 let texel=1.0/vec2f(textureDimensions(surfaceTexture));
 let offsets=array<vec2f,4>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(1,1));
 var bright=vec3f(0);
 for(var n=0;n<4;n++){bright+=max(textureSampleLevel(surfaceTexture,surfaceSampler,uv+offsets[n]*texel,0.0).rgb-vec3f(0.3),vec3f(0))*0.25;}
 return vec4f(bright,1);
}`
const BLOOM_BLUR = `
fn postEffect(uv:vec2f,time:f32)->vec4f {
 let step=vec2f(postFrame.w/4.0,0)/vec2f(textureDimensions(surfaceTexture));
 let weights=array<f32,5>(0.06,0.24,0.4,0.24,0.06);var glow=vec3f(0);
 for(var n=0;n<5;n++){glow+=textureSampleLevel(surfaceTexture,surfaceSampler,uv+step*(f32(n)-2.0)*0.5,0.0).rgb*weights[n];}
 return vec4f(glow,1);
}`
const SHADER = `
struct Frame { projection: mat4x4f, viewport: vec2f, time: f32, motion: f32, effects: vec4f }
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
 let point=rect.xy+uv*rect.zw;let delta=point-extra.zw;let c=cos(extra.y);let s=sin(extra.y);
 let rotated=extra.zw+vec2f(delta.x*c-delta.y*s,delta.x*s+delta.y*c);
 o.position = frame.projection * vec4f(rotated, 0, 1);
 o.uv=uv; o.rect=rect; o.params=params; o.color=color; o.extra=extra; o.textureRect=textureRect; return o;
}
fn line(distance: f32, thickness: f32) -> f32 { return 1.0-smoothstep(thickness, thickness+1.0, abs(distance))+0.12*exp(-abs(distance)*0.32); }
fn box(p: vec2f, b: vec2f, r: f32) -> f32 { let q=abs(p)-b+vec2f(r); return min(max(q.x,q.y),0.0)+length(max(q,vec2f(0)))-r; }
fn settingColor(value:f32)->vec3f {
 let level=clamp(value,0.0,1.0);
 return vec3f(min(level*2.0,1.0),min((1.0-level)*2.0,1.0),0.08);
}
fn radialMark(p:vec2f,angle:f32,inner:f32,outer:f32,weight:f32)->f32 {
 let direction=vec2f(sin(angle),-cos(angle));
 let nearest=direction*clamp(dot(p,direction),inner,outer);
 return line(length(p-nearest),weight);
}
fn chassis(distance:f32,top:f32,pressed:f32)->vec4f {
 let mask=1.0-smoothstep(-0.5,0.5,distance);
 let bevel=1.0-smoothstep(0.0,2.0,abs(distance+2.0));
 let face=vec3f(0.028,0.041,0.058)*(0.7+top*0.5)*(1.0-pressed*0.22);
 let rim=vec3f(0.12,0.16,0.2)*bevel*(0.15+top*0.85);
 return vec4f((face+rim)*mask,mask)*frame.effects.x;
}
/* EFFECT */
@fragment fn fragmentMain(i: VertexOutput) -> @location(0) vec4f {
 let kind=i.params.x; let value=i.params.y; let second=i.params.z; let engaged=i.params.w;
 let size=i.rect.zw; let p=(i.uv-0.5)*size; var light=0.0; var fill=0.0; var color=i.color.rgb;var material=vec4f(0);
 let top=clamp(0.65-i.uv.y*0.6-i.uv.x*0.15,0.0,1.0);
 if (kind>8.5&&kind<9.5) {
  let alpha=textureSampleLevel(atlas,atlasSampler,i.textureRect.xy+i.uv*i.textureRect.zw,0.0).a;
  return vec4f(i.color.rgb,alpha*i.color.a);
 }
 if (kind>22.5) {
  let radius=min(size.x,size.y)*.38;let radial=length(p);
  let angle=atan2(p.x,-p.y);let t=((angle+2.35619449+12.56637061)%6.283185307)/4.71238898;
  let arc=line(radial-radius-5.0,1.8)*select(0.0,1.0,t<=1.0);
  let cap=1.0-smoothstep(radius-3.0,radius-1.0,radial);
  let bezel=1.0-smoothstep(radius-1.0,radius+2.0,radial);
  var rgb=mix(vec3f(.12),vec3f(.68+top*.38),cap);
  let needle=radialMark(p,-2.35619449+value*4.71238898,radius*.38,radius*.85,1.3);
  rgb=mix(rgb,vec3f(.08),needle);
  rgb=mix(rgb,mix(vec3f(.25),i.color.rgb,select(.15,1.0,t<=value)),arc);
  return vec4f(rgb,max(bezel,arc)*i.color.a);
 } else if (kind>21.5) {
  let mask=1.0-smoothstep(min(size.x,size.y)*.44,min(size.x,size.y)*.48,length(p));
  return vec4f(i.color.rgb,mask*i.color.a);
 } else if (kind>20.5) {
  let mask=1.0-smoothstep(0.0,1.0,box(p,size*.5,5.0));
  return vec4f(vec3f(.17),mask*i.color.a);
 } else if (kind>19.5) {
  let a=i.textureRect.xy;let b=i.textureRect.zw;let ab=b-a;let q=i.uv*size-a;let t=clamp(dot(q,ab)/max(.001,dot(ab,ab)),0.0,1.0);
  let stroke=1.0-smoothstep(.8,1.8,length(q-ab*t));
  return vec4f(i.color.rgb,stroke*i.color.a);
 } else if (kind>18.5) {
  let d=box(p,size*.5-vec2f(.5),1);let a=1.0-smoothstep(0.0,1.0,d);
  return vec4f(i.color.rgb*(.5+i.uv.y*.4),a*i.color.a);
 } else if (kind<0.5) {
  let pattern=i.extra.x;
  let edge=box(p,size*0.5-vec2f(2),select(10.0,3.0,pattern>0.5&&pattern<1.5));
  let grid=select(select(max(line((p.x)%16.0,0.25),line((p.y)%16.0,0.25)),line((p.x+p.y)%14.0,0.35),pattern>0.5),line(length(p)%18.0,0.3),pattern>1.5);
  let a=1.0-smoothstep(0.0,1.0,edge);
  let bevel=(1.0-smoothstep(0.0,2.0,abs(edge+3.0)))*top*frame.effects.x;
  let rgb=mix(vec3f(0.022,0.031,0.048)*(0.85+top*0.3),i.color.rgb,0.018+grid*0.004)+vec3f(0.07,0.1,0.13)*bevel+i.color.rgb*(line(edge,0.6)*(0.2+engaged*0.65+frame.effects.y));
  return surfaceEffect(vec4f(rgb,a*select(1.0,.86,frame.effects.z>0.5)),i.uv,frame.time);
 } else if (kind<1.5) {
  color=settingColor(value);
  let radius=min(size.x,size.y)*0.34; let dist=length(p)-radius;
  material=chassis(length(p)-(radius-5.0),top,engaged);
  material=vec4f(material.rgb+vec3f(0.07,0.09,0.12)*(1.0-smoothstep(0.0,1.5,abs(length(p+vec2f(0,2.0))-(radius-8.0))))*top*frame.effects.x,material.a);
  let start=i.textureRect.x; let sweep=max(0.001,i.textureRect.y);
  let position=select(value,1.0-value,i.textureRect.z>0.5);
  let angle=atan2(p.x,-p.y); let t=((angle-start+12.56637061)%6.283185307)/sweep;
  let inArc=select(0.0,1.0,t>=0.0&&t<=1.0);
  let filled=select(t<=position,t>=min(0.5,position)&&t<=max(0.5,position),second>0.5&&second<1.5);
  light=line(dist,2.2)*inArc*select(0.12,1.0,filled);
  let endpoint=max(radialMark(p,start,radius-2.0,radius+9.0,1.2),radialMark(p,start+sweep,radius-2.0,radius+9.0,1.2));
  light=max(light,endpoint*0.55);
  if (second>0.5&&second<1.5) { light=max(light,radialMark(p,start+sweep*0.5,radius-2.0,radius+9.0,1.0)*0.45); }
  if (i.extra.x>0.0) {
   let tick=round(clamp(t,0.0,1.0)*i.extra.x)/i.extra.x;
   let inner=select(radius-1.0,radius-5.0,i.textureRect.w<0.5||i.textureRect.w>1.5);
   let outer=select(radius+4.0,radius+1.0,i.textureRect.w<0.5);
   light=max(light,radialMark(p,start+tick*sweep,inner,outer,0.7)*inArc*0.3);
  }
  let current=radialMark(p,start+position*sweep,radius-5.0-engaged*4.0,radius+8.0+engaged*5.0,1.8);
  light=max(light,current);
  fill=(1.0-smoothstep(radius-7.0,radius-5.0,length(p)))*0.055;
 } else if (kind<2.5 || (kind>6.5&&kind<7.5)) {
  let w=size.x*0.42; let x=-w+value*w*2.0;
  material=chassis(box(p,vec2f(w+6.0,8.0),7.0),1.0-top,0.0);
  light=line(p.y,2.0)*step(abs(p.x),w)*select(0.1,0.8,p.x<=x);
  if (kind<2.5) {
   color=settingColor(value);
   let knob=length(p-vec2f(x,0));
   let cap=chassis(knob-9.0,top,engaged);material=mix(material,cap,cap.a);
   light=max(light,line(knob-10.0,1.8));
   fill=max(fill,(1.0-smoothstep(8.0,10.0,knob))*0.5);
   if (second>=0.0) {
    let upper=length(p-vec2f(-w+second*w*2.0,0));
    let upperCap=chassis(upper-9.0,top,engaged);material=mix(material,upperCap,upperCap.a);
    light=max(light,line(upper-10.0,1.8));
    fill=max(fill,(1.0-smoothstep(8.0,10.0,upper))*0.5);
   }
  } else { light=max(light,line(length(p-vec2f(x,0)),5.0)); }
 } else if (kind<3.5) {
  let w=min(size.x*0.25,36.0); let d=box(p,vec2f(w,14),14);
  material=chassis(d-3.0,1.0-top,0.0);
  light=line(d,1.0)*0.45+line(length(p-vec2f(mix(-w+15.0,w-15.0,value),0))-9.0,2.5);
  fill=(1.0-smoothstep(-1.0,0.0,d))*(0.04+value*0.08);
 } else if (kind<4.5) {
  let extent=size*0.42; let d=box(p,extent,4);
  material=chassis(d,1.0-top,0.0);
  light=line(d,0.6)*0.25;
  let point=vec2f(mix(-extent.x,extent.x,value),mix(extent.y,-extent.y,second));
  light=max(light,max(line(p.x-point.x,0.4),line(p.y-point.y,0.4))*step(max(abs(p.x)/extent.x,abs(p.y)/extent.y),1.0)*0.25);
  light=max(light,line(length(p-point),5.0));
 } else if (kind<5.5) {
  let d=box(p,size*0.4,6); material=chassis(d,top,engaged);light=line(d,1.1)*(0.45+engaged*0.55); fill=(1.0-smoothstep(-1.0,0.0,d))*(0.04+engaged*0.18);
 } else if (kind<6.5) {
  let count=max(1.0,i.extra.x); let segment=floor(i.uv.x*count); let center=(segment+0.5)/count;
  let d=length(vec2f((i.uv.x-center)*size.x,p.y))-7.0;
  light=line(d,1.0)*select(0.2,1.0,abs(segment-value)<0.1);
  fill=(1.0-smoothstep(-1.0,0.0,d))*select(0.0,0.4,abs(segment-value)<0.1);
 } else if (kind>16.5) {
  let a=i.textureRect.xy; let b=i.textureRect.zw; let ab=b-a;
  let q=i.uv*size-a; let t=clamp(dot(q,ab)/max(0.001,dot(ab,ab)),0.0,1.0);
  light=line(length(q-ab*t),1.2);
 } else if (kind>15.5) {
  let flash=exp(-max(0.0,frame.time-second)*10.0)*frame.motion;
  light=line(p.y,0.7+flash*1.5)*(0.2+flash*1.6);
 } else if (kind>14.5) {
  let a=i.textureRect.xy;let b=i.textureRect.zw;let ab=b-a;let len=max(1.0,length(ab));let direction=ab/len;
  let q=i.uv*size-a;let along=dot(q,direction);let across=abs(q.x*direction.y-q.y*direction.x);
  let dash=1.0-smoothstep(6.0,7.0,((along+frame.time*55.0*frame.motion)%12.0));
  light=line(across,0.8)*dash*step(0.0,along)*step(along,len)*0.5;
 } else if (kind>13.5) {
  if(i.uv.x<i.textureRect.x||i.uv.y<i.textureRect.y||i.uv.x>i.textureRect.z||i.uv.y>i.textureRect.w){discard;}
  let radius=min(size.x,size.y)*0.42;let d=length(p)-radius;
  let age=max(0.0,frame.time-second);let flash=exp(-age*14.0)*frame.motion;
  light=line(d,1.8)*(0.7+flash*1.5);
  fill=(1.0-smoothstep(-1.0,0.0,d))*(0.1+value*0.35+flash*0.5);
 } else if (kind>10.5) {
  let d=box(p,size*0.5-vec2f(1),2);
  material=chassis(d,top,0.0);
  light=line(d,0.5)*(0.12+value*0.55);
  fill=(1.0-smoothstep(-1.0,0.0,d))*(0.015+value*0.65);
  if(kind>11.5){light=max(light,line(p.y,0.5)*0.2);}
 } else if (kind>9.5) {
  let d=box(p,size*0.4,10);
  material=chassis(d,top,engaged);
  let tail=select(0.0,pow(max(0.0,1.0-max(0.0,frame.time-second)/max(0.001,i.extra.x)),2.0)*frame.motion,second>=0.0);
  let pressure=clamp(value*select(tail,1.0,engaged>0.5),0.0,1.0);
  light=line(d,1.8)*(0.14+pressure*1.6);
  fill=(1.0-smoothstep(-1.0,0.0,d))*(0.015+pressure*0.8);
 } else {
  let d=box(p,size*0.43,4); light=line(d,0.6)*0.35;
  material=chassis(d,1.0-top,0.0);
 }
 let pulse=1.0+sin(frame.time*3.0)*engaged*0.12*frame.motion;
 // Buttons, toggles and choice cells flash on each committed press; others use second differently.
 let triggerable=(kind>2.5&&kind<3.5)||(kind>4.5&&kind<5.5)||(kind>10.5&&kind<11.5);
 let trig=select(0.0,exp(-max(0.0,frame.time-second)*9.0)*frame.motion,triggerable&&second>=0.0);
 let intensity=(light*(1.0+trig*1.8)+fill*(1.0+trig*3.0))*pulse*(1.0+frame.effects.y*0.6);
 let rgb=color*intensity+material.rgb*(vec3f(0.75)+i.color.rgb*0.5);
 return surfaceEffect(vec4f(rgb,max(clamp(intensity,0.0,1.0),material.a)*i.color.a),i.uv,frame.time);
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
	private bloomTextures?: [GPUTexture, GPUTexture]
	private bloomPipelines?: [GPURenderPipeline, GPURenderPipeline]
	private bloomBindings?: [GPUBindGroup, GPUBindGroup]
	private capacity = 4096
	private instances = new Float32Array(this.capacity * STRIDE)
	private instanceCount = 0
	private building: number[] = []
	private cache = new Map<WidgetVisual, CachedWidget>()
	private advances = new Float32Array(96)
	private epoch = 0
	private frameData = new Float32Array(24)
	private postData = new Float32Array(4)
	private projection = new Float32Array(16)
	private disposed = false
	private hasBackground = false
	private beatPosition?: number
	private dirty = true
	private active = false
	private screenSignature = ""
	private color = COLORS.neon
	private drawingColor = COLORS.neon
	private drawingRotation = 0
	private drawingPivot = [0, 0]
	private visualEffects = { bloom: 0.6, bloomRadius: 6, depth: 0.9, scanlines: 0.025 }
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
			size: 96,
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
		ctx.font = `700 24px ${getComputedStyle(canvas).fontFamily}`
		ctx.fillStyle = "white"
		ctx.textBaseline = "top"
		for (let code = 32; code < 128; code++) {
			const n = code - 32
			const glyph = String.fromCharCode(code)
			this.advances[n] = ctx.measureText(glyph).width * 0.75
			ctx.fillText(glyph, (n % 16) * 32 + 2, Math.floor(n / 16) * 32 + 2)
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
		await document.fonts.load(`700 24px ${getComputedStyle(canvas).fontFamily}`)
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
		this.dirty = true
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
		const pipeline = await this.createPostPipeline(effect)
		const bloom =
			effect === DEFAULT_POST_EFFECT
				? await Promise.all([
						this.createPostPipeline(BLOOM_EXTRACT),
						this.createPostPipeline(BLOOM_BLUR)
					])
				: undefined
		if (this.disposed) {
			return
		}
		this.postPipeline = pipeline
		this.postEffect = effect
		this.bloomPipelines = bloom
		this.bloomBindings = undefined
		this.dirty = true
		this.postBinding = undefined
	}
	private async createPostPipeline(effect: string): Promise<GPURenderPipeline> {
		const module = this.device.createShaderModule({
			code: POST_SHADER.replace("/* POST_EFFECT */", effect)
		})
		const errors = (await module.getCompilationInfo()).messages.filter(
			(m) => m.type === "error"
		)
		if (errors.length) {
			throw new Error(errors.map((e) => e.message).join("\n"))
		}
		return this.device.createRenderPipelineAsync({
			layout: "auto",
			vertex: { module, entryPoint: "postVertex" },
			fragment: { module, entryPoint: "postFragment", targets: [{ format: this.format }] },
			primitive: { topology: "triangle-list" }
		})
	}
	setTheme(theme: SurfaceTheme): void {
		this.color = COLORS[theme]
	}
	setVisualEffects(options: SurfaceVisualEffects): void {
		const next = { ...this.visualEffects }
		for (const name of ["bloom", "bloomRadius", "depth", "scanlines"] as const) {
			const value = options[name]
			if (value === undefined) {
				continue
			}
			if (!Number.isFinite(value)) {
				throw new RangeError(`${name} must be finite`)
			}
			next[name] = Math.max(
				0,
				Math.min(name === "bloomRadius" ? 16 : name === "scanlines" ? 0.2 : 1, value)
			)
		}
		this.visualEffects = next
		this.dirty = true
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
		this.building.push(
			x,
			y,
			w,
			h,
			kind,
			a,
			b,
			active,
			...this.drawingColor,
			alpha,
			extra,
			this.drawingRotation,
			...this.drawingPivot,
			...uv
		)
	}
	private text(
		text: string,
		x: number,
		y: number,
		width: number,
		alpha = 1,
		reserve = false,
		scale = 1
	): void {
		const size = 24 * scale
		const count = reserve ? Math.max(text.length, Math.floor(width / (4 * scale))) : text.length
		let advance = 0
		for (let i = 0; i < count; i++) {
			const char = text[i] ?? " "
			const code = char.charCodeAt(0),
				n = (code >= 32 && code < 128 ? code : 63) - 32
			const step = this.advances[n] * scale
			const visible = i < text.length && advance + step <= width + 0.01
			this.quad(x + advance, y, size, size, 9, 0, 0, 0, 0, visible ? alpha : 0, [
				((n % 16) * 32) / 512,
				(Math.floor(n / 16) * 32) / 192,
				32 / 512,
				32 / 192
			])
			if (i < text.length) {
				advance += step
			}
		}
	}
	private textWidth(text: string): number {
		let width = 0
		for (const character of text) {
			const code = character.charCodeAt(0)
			width += this.advances[(code >= 32 && code < 128 ? code : 63) - 32]
		}
		return width
	}
	/** Strokes reuse the segment primitive so icons share the face's glow, rotation and theme. */
	private icon(name: string, x: number, y: number, size: number, alpha: number): void {
		const unit = size / 24
		for (const stroke of CONTROL_ICONS[name] ?? CONTROL_ICONS.control) {
			for (let i = 2; i < stroke.length; i += 2) {
				this.quad(x, y, size, size, 17, 0, 0, 0, 0, alpha, [
					stroke[i - 2] * unit,
					stroke[i - 1] * unit,
					stroke[i] * unit,
					stroke[i + 1] * unit
				])
			}
		}
	}
	/** Glyph and text centred as one group, sharing the label's fitted scale. */
	private iconLabel(
		name: string,
		text: string,
		x: number,
		y: number,
		width: number,
		alpha: number,
		scale: number
	): void {
		const size = Math.round(Math.max(12, 15 * scale)),
			gap = 5 * scale
		const fitted = Math.min(scale, (width - size - gap) / Math.max(1, this.textWidth(text)))
		const length = this.textWidth(text) * fitted
		const left = x + (width - size - gap - length) / 2
		this.icon(name, left, y + 11 * fitted - size / 2, size, alpha * 0.9)
		this.text(text, left + size + gap, y, length, alpha, false, fitted)
	}
	private centeredText(
		text: string,
		x: number,
		y: number,
		width: number,
		alpha: number,
		reserve = false,
		scale = 1
	): void {
		const fitted = Math.min(scale, width / Math.max(1, this.textWidth(text)))
		const length = this.textWidth(text) * fitted
		this.text(
			text,
			x + (width - length) / 2,
			y,
			reserve ? Math.max(length, width) : length,
			alpha,
			reserve,
			fitted
		)
	}

	private contact(
		w: WidgetVisual,
		x: number,
		y: number,
		diameter: number,
		pressure: number,
		triggered: number,
		alpha: number
	): void {
		const left = x - diameter / 2,
			top = y - diameter / 2
		this.quad(left, top, diameter, diameter, 14, pressure, triggered, 1, 0, alpha, [
			Math.max(0, (w.x - left) / diameter),
			Math.max(0, (w.y - top) / diameter),
			Math.min(1, (w.x + w.width - left) / diameter),
			Math.min(1, (w.y + w.height - top) / diameter)
		])
	}
	private relativeKeys(w: WidgetVisual, alpha: number): void {
		const controller = w.relative
		if (!controller) {
			return
		}
		const rect = relativeRect(w.width, w.height),
			size = controller.keySize
		const ax = controller.anchor.x * rect.width,
			ay = controller.anchor.y * rect.height
		const baseX = w.x + rect.x,
			baseY = w.y + rect.y
		for (let row = Math.ceil((ay - rect.height) / size); row <= Math.floor(ay / size); row++) {
			for (
				let column = Math.ceil(-ax / size);
				column <= Math.floor((rect.width - ax) / size);
				column++
			) {
				const cx = ax + column * size,
					cy = ay - row * size
				const note =
					controller.options.rootNote +
					column * controller.options.horizontalInterval +
					row * controller.options.verticalInterval
				if (note < 0 || note > 127) {
					continue
				}
				const left = Math.max(0, cx - (size - controller.minimumKeySize / 5) / 2),
					top = Math.max(0, cy - (size - controller.minimumKeySize / 5) / 2)
				const width =
						Math.min(rect.width, cx + (size - controller.minimumKeySize / 5) / 2) -
						left,
					height =
						Math.min(rect.height, cy + (size - controller.minimumKeySize / 5) / 2) - top
				if (
					width < controller.minimumKeySize * 0.8 ||
					height < controller.minimumKeySize * 0.8
				) {
					continue
				}
				this.quad(baseX + left, baseY + top, width, height, 11, 0, -1, 0, 0, alpha * 0.65)
				if (width > 25 && height > 20) {
					this.text(
						noteName(note),
						baseX + left + 4,
						baseY + top + height / 2 - 8,
						width - 5,
						alpha * 0.9,
						false,
						0.65
					)
				}
			}
		}
		for (const contact of controller.contacts.values()) {
			const x = contact.x * rect.width,
				y = contact.y * rect.height
			if (Math.hypot(x - ax, y - ay) < 2) {
				continue
			}
			const left = Math.min(ax, x) - 3,
				top = Math.min(ay, y) - 3
			this.quad(
				baseX + left,
				baseY + top,
				Math.abs(x - ax) + 6,
				Math.abs(y - ay) + 6,
				15,
				0,
				-1,
				0,
				0,
				alpha,
				[ax - left, ay - top, x - left, y - top]
			)
		}
		if (controller.contacts.size) {
			this.contact(w, baseX + ax, baseY + ay, 18, 0, -1000, alpha * 0.5)
		}
		for (const contact of controller.contacts.values()) {
			const diameter = 18 + contact.pressure * 34
			const x = baseX + contact.x * rect.width,
				y = baseY + contact.y * rect.height
			this.contact(w, x, y, diameter, contact.pressure, contact.triggered, alpha)
			this.text(noteName(contact.note), x - 14, y - 9, 35, alpha, false, 0.75)
		}
	}
	private strum(w: WidgetVisual, alpha: number): void {
		const controller = w.strum
		if (!controller) {
			return
		}
		const rect = relativeRect(w.width, w.height),
			rows = controller.options.tuning.length,
			height = rect.height / rows
		controller.options.tuning.forEach((pitch, row) => {
			const y = w.y + rect.y + row * height
			this.quad(
				w.x + rect.x + 36,
				y,
				Math.max(1, rect.width - 36),
				height,
				16,
				0,
				controller.triggered[row],
				0,
				0,
				alpha * (controller.options.frets[row] < 0 ? 0.25 : 1)
			)
			this.text(
				noteName(Math.min(127, pitch + Math.max(0, controller.options.frets[row]))),
				w.x + rect.x,
				y + height / 2 - 9,
				34,
				alpha * 0.8,
				false,
				0.75
			)
		})
		for (const contact of controller.contacts.values()) {
			const diameter = 18 + contact.pressure * 24,
				x = w.x + rect.x + contact.x * rect.width,
				y = w.y + rect.y + contact.y * rect.height
			this.contact(
				w,
				x,
				y,
				diameter,
				contact.pressure,
				controller.triggered[contact.row],
				alpha
			)
		}
	}
	private drawEnvelope(w: WidgetVisual, alpha: number): void {
		const { points, rect, values, maxima, knobs } = envelopeGeometry(
			w.descriptor,
			w.value,
			w.width,
			w.height
		)
		const accent = this.drawingColor
		this.quad(w.x, w.y, w.width, w.height, 21, 0, -1, 0, 0, alpha)
		const segment = (a: number[], b: number[], opacity: number) => {
			const left = Math.min(a[0], b[0]) - 3,
				top = Math.min(a[1], b[1]) - 3
			this.quad(
				w.x + left,
				w.y + top,
				Math.abs(b[0] - a[0]) + 6,
				Math.abs(b[1] - a[1]) + 6,
				20,
				0,
				-1,
				0,
				0,
				opacity,
				[a[0] - left, a[1] - top, b[0] - left, b[1] - top]
			)
		}
		this.drawingColor = [0.65, 0.65, 0.65]
		for (let row = 0; row <= 4; row++) {
			const y = rect.y + (rect.height * row) / 4
			segment([8, y], [w.width - 8, y], alpha * 0.18)
		}
		this.drawingColor = accent
		const curve = envelopeCurve(points)
		for (let i = 1; i < curve.length; i++) {
			segment(curve[i - 1], curve[i], alpha)
		}
		for (let i = 0; i < 4; i++) {
			const [x, y] = points[i + 1],
				letter = ENVELOPE_STAGES[i][0],
				knob = knobs[i]
			this.quad(w.x + x - 12, w.y + y - 12, 24, 24, 22, 0, -1, 0, 0, alpha)
			this.drawingColor = [0.08, 0.08, 0.08]
			this.centeredText(letter, w.x + x - 10, w.y + y - 9, 20, alpha, false, 0.85)
			this.drawingColor = accent
			this.quad(
				w.x + knob.x - knob.radius - 7,
				w.y + knob.y - knob.radius - 7,
				(knob.radius + 7) * 2,
				(knob.radius + 7) * 2,
				23,
				values[i] / maxima[i],
				-1,
				Number(w.active),
				0,
				alpha
			)
			this.centeredText(
				letter,
				w.x + knob.x - 20,
				w.y + w.height - 40,
				40,
				alpha * 0.8,
				false,
				0.85
			)
			this.centeredText(
				envelopeText(values[i], i),
				w.x + 12 + (i * (w.width - 24)) / 4,
				w.y + w.height - 20,
				(w.width - 24) / 4,
				alpha * 0.65,
				false,
				0.65
			)
		}
	}
	private drawVisualiser(w: WidgetVisual, alpha: number): void {
		const frame = w.visualiser,
			options = w.descriptor.visualiser
		if (!frame?.available || !options) {
			return
		}
		const x = w.x + 12,
			y = w.y + (w.background ? 12 : 36),
			width = w.width - 24,
			height = Math.max(1, w.height - (w.background ? 24 : 48))
		const opacity = alpha * (options.opacity ?? (w.background ? 0.22 : 0.85))
		if (options.kind === "notes") {
			const cell = width / 128,
				original = this.drawingColor
			for (let note = 0; note < 128; note++) {
				const value = frame.samples[note]
				if (value <= 0.0001) {
					continue
				}
				this.drawingColor = noteColor(note)
				this.quad(
					x + note * cell,
					y + height * (1 - value),
					Math.max(1, cell - 0.5),
					Math.max(1, height * value),
					19,
					0,
					-1,
					0,
					0,
					opacity
				)
			}
			this.drawingColor = original
		} else if (options.kind === "level") {
			this.quad(
				x,
				y + height * (1 - frame.level),
				width,
				Math.max(1, height * frame.level),
				19,
				0,
				-1,
				0,
				0,
				opacity
			)
		} else if (options.kind === "spectrum") {
			const count = 64,
				cell = width / count
			for (let i = 0; i < count; i++) {
				const value = Math.max(frame.samples[i * 2], frame.samples[i * 2 + 1])
				this.quad(
					x + i * cell,
					y + height * (1 - value),
					Math.max(1, cell - 2),
					Math.max(1, height * value),
					19,
					0,
					-1,
					0,
					0,
					opacity
				)
			}
		} else {
			for (let i = 1; i < frame.samples.length; i++) {
				const point = (index: number) => ({
					x: x + (index / (frame.samples.length - 1)) * width,
					y:
						y +
						height *
							(options.kind === "waveform"
								? 0.5 - frame.samples[index] * 0.46
								: 1 - frame.samples[index])
				})
				const a = point(i - 1),
					b = point(i),
					left = Math.min(a.x, b.x) - 2,
					top = Math.min(a.y, b.y) - 2
				this.quad(
					left,
					top,
					Math.abs(b.x - a.x) + 4,
					Math.abs(b.y - a.y) + 4,
					20,
					0,
					-1,
					0,
					0,
					opacity,
					[a.x - left, a.y - top, b.x - left, b.y - top]
				)
			}
		}
	}
	prepare(
		widgets: WidgetVisual[],
		_motion: boolean,
		cursors: { x: number; y: number }[] = []
	): void {
		let offset = 0,
			dirtyStart = Infinity,
			dirtyEnd = 0,
			grown = false
		const epoch = ++this.epoch
		this.hasBackground = widgets.some((w) => w.background)
		const wasActive = this.active
		this.active = widgets.some(
			(widget) =>
				!!widget.active ||
				(!!widget.pad && _motion && widget.pad.intensity(performance.now() / 1000) > 0) ||
				(!!widget.strum &&
					_motion &&
					performance.now() / 1000 - widget.strum.lastTriggered < 0.75) ||
				(widget.triggeredAt !== undefined &&
					_motion &&
					performance.now() / 1000 - widget.triggeredAt < 0.6)
		)
		if (wasActive && !this.active) {
			this.dirty = true
		}
		const reserve = (required: number) => {
			if (required <= this.instances.length) {
				return
			}
			const next = new Float32Array(2 ** Math.ceil(Math.log2(required)))
			next.set(this.instances)
			this.instances = next
			this.buffer.destroy()
			this.buffer = this.device.createBuffer({
				size: next.byteLength,
				usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
			})
			grown = true
		}
		for (const w of widgets) {
			let cached = this.cache.get(w)
			const changed =
				!cached ||
				cached.x !== w.x ||
				cached.y !== w.y ||
				cached.width !== w.width ||
				cached.height !== w.height ||
				cached.compact !== w.compact ||
				cached.rotation !== w.rotation ||
				cached.strumRevision !== w.strum?.revision ||
				cached.choicesRevision !== w.choices?.revision ||
				cached.musicRevision !== w.musicView?.revision ||
				cached.padRevision !== w.pad?.revision ||
				cached.visualiserRevision !== w.visualiser?.revision ||
				cached.descriptor !== w.descriptor ||
				cached.widget !== w.widget ||
				cached.sourceLabel !== w.sourceLabel ||
				cached.sourceId !== w.sourceId ||
				cached.active !== w.active ||
				cached.focused !== w.focused ||
				cached.dial !== w.dial ||
				cached.unavailable !== w.unavailable ||
				cached.disabled !== w.descriptor.disabled ||
				cached.triggeredAt !== w.triggeredAt ||
				cached.color !== this.color ||
				!sameValue(cached.value, w.value)
			if (changed) {
				this.building = []
				const theme = sourceTheme(w.sourceId ?? w.sourceLabel)
				this.drawingColor = theme.accent
				this.drawingRotation = ((w.rotation ?? 0) * Math.PI) / 180
				this.drawingPivot = [w.x + w.width / 2, w.y + w.height / 2]
				const d = w.descriptor,
					v = w.value,
					active = w.active || w.focused ? 1 : 0,
					alpha = w.unavailable || d.disabled ? 0.3 : 1
				const choice = d.choices?.findIndex((c) => sameValue(c.value, v)) ?? 0
				const target = Array.isArray(v)
					? v.map((n) => normalize(d, n))
					: [typeof v === "boolean" ? Number(v) : normalize(d, Number(v))]
				if (!w.background) {
					this.quad(w.x, w.y, w.width, w.height, 0, 0, 0, active, theme.pattern, alpha)
				}
				const rotary = w.widget === "dial" || w.widget === "rotation"
				const musical = isMusicGrid(w.widget)
				const compact = !!w.compact
				const compactFace = rotary ? Math.min(w.height, w.width * 0.45) : w.width * 0.55
				const sideLabel =
					compact && (rotary || ["slider", "meter", "toggle"].includes(w.widget))
				const labelX = sideLabel ? (rotary ? w.x + compactFace : w.x + 4) : w.x + 12
				const labelWidth = sideLabel ? w.width - compactFace - 8 : w.width - 24
				const centerY = w.y + w.height / 2 + (compact ? 0 : 10)
				const x = compact
						? sideLabel && !rotary
							? w.x + w.width - compactFace
							: w.x
						: w.x + 8,
					y = compact ? w.y : w.y + 22,
					width = compact ? (sideLabel ? compactFace : w.width) : w.width - 16,
					height = compact ? w.height : w.height - 24
				const kind = {
					dial: 1,
					rotation: 1,
					"guitar-tab": 12,
					"piano-roll": 11,
					"relative-keys": 13,
					strum: 16,
					visualiser: 19,
					slider: 2,
					range: 2,
					toggle: 3,
					xy: 4,
					envelope: 8,
					button: 5,
					pad: 10,
					radio: 6,
					meter: 7,
					select: 8,
					number: 8,
					text: 8,
					color: 8,
					display: 8
				}[w.widget]
				const dial = dialOptions(
					w.widget === "rotation" ? { ...w.dial, mode: "rotation" } : (w.dial ?? d.dial)
				)
				if (w.widget === "envelope") {
					this.drawEnvelope(w, alpha)
				} else if (w.widget === "visualiser") {
					this.drawVisualiser(w, alpha)
				} else if (w.widget === "strum") {
					this.strum(w, alpha)
				} else if (w.widget === "relative-keys") {
					this.relativeKeys(w, alpha)
				} else if (musical) {
					const options = musicOptions(w.widget, d.music),
						values = musicValues(d, v)
					const rect = musicRect(w.width, w.height, 11 / (w.musicView?.gap ?? 11))
					const view = w.musicView ?? {
						row: 0,
						column: 0,
						rows: options.pitches.length,
						columns: options.steps,
						gap: 11
					}
					const rows = Math.min(view.rows, options.pitches.length - view.row),
						columns = Math.min(view.columns, options.steps - view.column)
					const cw = (rect.width + view.gap) / columns,
						ch = (rect.height + view.gap) / rows
					for (let row = view.row; row < view.row + rows; row++) {
						this.text(
							noteName(options.pitches[row]),
							w.x + 8,
							w.y + rect.y + (row - view.row) * ch + ch / 2 - 8,
							30,
							alpha * 0.8,
							false,
							0.7
						)
						for (let col = view.column; col < view.column + columns; col++) {
							const value = values[row * options.steps + col],
								tab = w.widget === "guitar-tab"
							this.quad(
								w.x + rect.x + (col - view.column) * cw,
								w.y + rect.y + (row - view.row) * ch,
								cw - view.gap,
								ch - view.gap,
								kind,
								tab ? Number(value >= 0) * 0.4 : value,
								-1,
								0,
								0,
								alpha
							)
							if (tab && value >= 0) {
								this.text(
									String(value),
									w.x + rect.x + (col - view.column) * cw + cw / 2 - 6,
									w.y + rect.y + (row - view.row) * ch + ch / 2 - 10,
									cw,
									alpha,
									false,
									0.8
								)
							}
						}
					}
				} else if (
					!["select", "radio", "number", "text", "color", "display"].includes(w.widget)
				) {
					if (w.widget === "pad") {
						this.drawingColor = noteColor(d.pad?.note ?? 60)
					}
					this.quad(
						x,
						y,
						width,
						height,
						kind,
						w.widget === "pad"
							? (w.pad?.velocity ?? target[0])
							: w.widget === "radio"
								? choice
								: target[0],
						rotary
							? ["level", "pan", "rotation"].indexOf(dial.mode)
							: w.widget === "xy" || w.widget === "range"
								? target[1]
								: w.widget === "pad"
									? (w.pad?.releasedAt ?? -1)
									: w.widget === "button" || w.widget === "toggle"
										? (w.triggeredAt ?? -1)
										: -1,
						w.widget === "pad" ? Number(w.pad?.held ?? w.active) : active,
						rotary
							? dial.ticks
							: w.widget === "pad"
								? (w.pad?.duration ?? 0.8)
								: (d.choices?.length ?? 0),
						alpha,
						rotary
							? [
									(dial.startAngle * Math.PI) / 180,
									(dial.sweepAngle * Math.PI) / 180,
									Number(dial.reverse),
									["inward", "outward", "both"].indexOf(dial.tickDirection)
								]
							: undefined
					)
				}
				this.drawingColor = theme.accent
				const icon = w.background ? undefined : controlIcon(d)
				// Full-size buttons and pads carry the glyph on their face; elsewhere it leads the label.
				const faceIcon =
					icon && !compact && (w.widget === "button" || w.widget === "pad")
						? icon
						: undefined
				if (
					!w.background &&
					!(compact && ["text", "number", "select", "color"].includes(w.widget))
				) {
					const labelY = compact
						? w.y + (sideLabel || w.widget === "display" ? 3 : (w.height - 18) / 2)
						: w.y + 7
					const labelScale = compact ? 0.7 : 1.1
					if (icon && !faceIcon && labelWidth >= 64) {
						this.iconLabel(
							icon,
							d.label.toUpperCase(),
							labelX,
							labelY,
							labelWidth,
							alpha,
							labelScale
						)
					} else {
						this.centeredText(
							d.label.toUpperCase(),
							labelX,
							labelY,
							labelWidth,
							alpha,
							false,
							labelScale
						)
					}
				}
				if (faceIcon) {
					const size = Math.min(44, width * 0.4, height * 0.45)
					if (size >= 12) {
						this.icon(
							faceIcon,
							x + (width - size) / 2,
							y + (height - size) / 2,
							size,
							alpha * (w.active ? 1 : 0.85)
						)
					}
				}
				if (w.widget === "radio" && d.choices?.length) {
					const page = w.choices?.layout
					const options = page?.choices ?? d.choices
					const { columns, rows } = page ?? choiceGrid(options.length)
					const gap = page?.gap ?? 11
					const cw = (width - gap * (columns - 1)) / columns
					const ch = ((page?.height ?? w.height - 40) - gap * (rows - 1)) / rows
					for (const [index, option] of options.entries()) {
						const left = x + (index % columns) * (cw + gap)
						const top = w.y + 32 + Math.floor(index / columns) * (ch + gap)
						this.quad(
							left,
							top,
							cw,
							ch,
							11,
							sameValue(option.value, v) ? 0.7 : 0.04,
							sameValue(option.value, v) ? (w.triggeredAt ?? -1) : -1,
							0,
							0,
							alpha
						)
						const glyph = waveformPoints(option) ? undefined : choiceIcon(option)
						if (glyph && ch >= 52) {
							const size = Math.min(24, ch - 34, cw - 16)
							this.icon(
								glyph,
								left + (cw - 6 - size) / 2,
								top + (ch - 28 - size) / 2,
								size,
								alpha
							)
						}
						const points = waveformPoints(option)
						if (points) {
							const iw = Math.min(64, cw - 22),
								ih = Math.min(28, ch - 32)
							for (let i = 1; i < points.length; i++) {
								this.quad(
									left + (cw - 6 - iw) / 2,
									top + (ch - 28 - ih) / 2,
									iw,
									ih,
									17,
									0,
									0,
									0,
									0,
									alpha,
									[
										points[i - 1][0] * iw,
										points[i - 1][1] * ih,
										points[i][0] * iw,
										points[i][1] * ih
									]
								)
							}
						}
						this.centeredText(
							option.label,
							left + 4,
							points || (glyph && ch >= 52) ? top + ch - 28 : top + (ch - 24) / 2,
							cw - 14,
							alpha,
							false,
							0.75
						)
					}
				}
				if (
					!musical &&
					![
						"button",
						"pad",
						"select",
						"number",
						"text",
						"color",
						"radio",
						"relative-keys",
						"strum",
						"envelope",
						"visualiser"
					].includes(w.widget)
				) {
					const valueY = compact
						? w.y + w.height - 19
						: rotary || w.widget === "display"
							? centerY - 12
							: ["slider", "range", "meter", "toggle"].includes(w.widget)
								? centerY + 18
								: w.y + w.height - 30
					this.centeredText(
						w.unavailable ? "Unavailable" : formatValue(d, v),
						compact ? labelX : w.x + 12,
						valueY,
						compact ? labelWidth : w.width - 24,
						alpha,
						true,
						compact ? 0.7 : 1.1
					)
				}
				cached = {
					data: new Float32Array(this.building),
					offset: -1,
					x: w.x,
					y: w.y,
					width: w.width,
					height: w.height,
					compact: w.compact,
					rotation: w.rotation,
					strumRevision: w.strum?.revision,
					choicesRevision: w.choices?.revision,
					musicRevision: w.musicView?.revision,
					padRevision: w.pad?.revision,
					visualiserRevision: w.visualiser?.revision,
					descriptor: d,
					widget: w.widget,
					sourceLabel: w.sourceLabel,
					sourceId: w.sourceId,
					value: Array.isArray(v) ? [...v] : v,
					active: w.active,
					focused: w.focused,
					dial: w.dial,
					unavailable: w.unavailable,
					disabled: d.disabled,
					triggeredAt: w.triggeredAt,
					color: this.color,
					epoch
				}
				this.cache.set(w, cached)
			}
			cached!.epoch = epoch
			reserve(offset + cached!.data.length)
			if (changed || cached!.offset !== offset) {
				this.instances.set(cached!.data, offset)
				cached!.offset = offset
				dirtyStart = Math.min(dirtyStart, offset)
				dirtyEnd = offset + cached!.data.length
			}
			offset += cached!.data.length
		}
		if (this.cache.size !== widgets.length) {
			for (const [widget, cached] of this.cache) {
				if (cached.epoch !== epoch) {
					this.cache.delete(widget)
				}
			}
		}
		this.building = []
		this.drawingColor = this.color
		this.drawingRotation = 0
		this.drawingPivot = [0, 0]
		for (const cursor of cursors) {
			this.quad(cursor.x - 12, cursor.y - 12, 24, 24, 1, 1, -1, 1)
		}
		if (this.building.length) {
			reserve(offset + this.building.length)
			this.instances.set(this.building, offset)
			dirtyStart = Math.min(dirtyStart, offset)
			offset += this.building.length
			dirtyEnd = offset
		}
		if (this.instanceCount !== offset / STRIDE || dirtyStart < dirtyEnd) {
			this.dirty = true
		}
		this.instanceCount = offset / STRIDE
		if (grown) {
			dirtyStart = 0
			dirtyEnd = offset
		}
		if (dirtyStart < dirtyEnd) {
			this.device.queue.writeBuffer(
				this.buffer,
				dirtyStart * 4,
				this.instances.buffer,
				dirtyStart * 4,
				(dirtyEnd - dirtyStart) * 4
			)
		}
	}
	setBeatPosition(position: number | undefined): void {
		const next =
			position !== undefined && Number.isFinite(position) && position >= 0
				? position
				: undefined
		if (next !== this.beatPosition) {
			this.beatPosition = next
			this.dirty = true
		}
	}
	render(
		width: number,
		height: number,
		time: number,
		motion: boolean,
		visible?: { x: number; y: number; width: number; height: number; scale: number }
	): void {
		if (this.disposed) {
			return
		}
		const ratio = Math.min(
				(devicePixelRatio || 1) * (visible?.scale ?? 1),
				2,
				this.device.limits.maxTextureDimension2D / Math.max(1, width, height)
			),
			w = Math.max(1, Math.round(width * ratio)),
			h = Math.max(1, Math.round(height * ratio))
		const signature = [
			w,
			h,
			width,
			height,
			visible?.x,
			visible?.y,
			visible?.width,
			visible?.height
		].join(":")
		if (
			!this.dirty &&
			signature === this.screenSignature &&
			!(motion && this.active) &&
			this.effect === DEFAULT_EFFECT &&
			this.postEffect === DEFAULT_POST_EFFECT
		) {
			return
		}
		this.screenSignature = signature
		if (this.canvas.width !== w || this.canvas.height !== h) {
			this.canvas.width = w
			this.canvas.height = h
		}
		this.projection.set([2 / width, 0, 0, 0, 0, -2 / height, 0, 0, 0, 0, 1, 0, -1, 1, 0, 1])
		this.draw(
			this.context.getCurrentTexture().createView(),
			this.projection,
			width,
			height,
			time,
			motion,
			undefined,
			undefined,
			visible
				? {
						x: Math.max(0, Math.floor(visible.x * ratio)),
						y: Math.max(0, Math.floor(visible.y * ratio)),
						width: Math.min(w, Math.ceil((visible.x + visible.width) * ratio)),
						height: Math.min(h, Math.ceil((visible.y + visible.height) * ratio))
					}
				: undefined
		)
		this.dirty = false
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
		targetSize?: { width: number; height: number },
		clip?: { x: number; y: number; width: number; height: number }
	): void {
		if (clip && (clip.width <= clip.x || clip.height <= clip.y)) {
			return
		}
		const frame = this.frameData
		frame.set(projection)
		frame.set([width, height, time, motion ? 1 : 0], 16)
		frame.set(
			[
				this.visualEffects.depth,
				beatPulse(this.beatPosition, motion),
				Number(this.hasBackground),
				0
			],
			20
		)
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
			this.bloomTextures?.forEach((texture) => texture.destroy())
			const createBloom = () =>
				this.device.createTexture({
					size: [
						Math.max(1, Math.ceil(targetWidth / 4)),
						Math.max(1, Math.ceil(targetHeight / 4))
					],
					format: this.format,
					usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
				})
			this.bloomTextures = [createBloom(), createBloom()]
			this.bloomBindings = undefined
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
					{ binding: 2, resource: { buffer: this.postUniform } },
					...(this.postEffect === DEFAULT_POST_EFFECT
						? [{ binding: 3, resource: this.bloomTextures![1].createView() }]
						: [])
				]
			})
		}
		this.postData[0] = time
		this.postData[1] = this.visualEffects.bloom
		this.postData[2] = this.visualEffects.scanlines
		const bloomRadius =
			this.visualEffects.bloomRadius * ((viewport?.width ?? targetWidth) / Math.max(1, width))
		this.postData[3] = bloomRadius
		this.device.queue.writeBuffer(this.postUniform, 0, this.postData)
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
		if (clip && this.postEffect === DEFAULT_POST_EFFECT) {
			// Include the bloom kernel's neighbouring texels in the scene pass.
			const padding = Math.ceil(bloomRadius) + 1
			const x = Math.max(0, clip.x - padding),
				y = Math.max(0, clip.y - padding)
			pass.setScissorRect(
				x,
				y,
				Math.min(targetWidth, clip.width + padding) - x,
				Math.min(targetHeight, clip.height + padding) - y
			)
		}
		pass.setPipeline(this.pipeline)
		pass.setBindGroup(0, this.binding)
		pass.setVertexBuffer(0, this.buffer)
		pass.draw(6, this.instanceCount)
		pass.end()
		if (this.bloomPipelines && this.bloomTextures && this.visualEffects.bloom > 0) {
			if (!this.bloomBindings) {
				const sampler = this.device.createSampler({
					magFilter: "linear",
					minFilter: "linear"
				})
				const bind = (pipeline: GPURenderPipeline, texture: GPUTexture) =>
					this.device.createBindGroup({
						layout: pipeline.getBindGroupLayout(0),
						entries: [
							{ binding: 0, resource: texture.createView() },
							{ binding: 1, resource: sampler },
							{ binding: 2, resource: { buffer: this.postUniform } }
						]
					})
				this.bloomBindings = [
					bind(this.bloomPipelines[0], this.sceneTexture),
					bind(this.bloomPipelines[1], this.bloomTextures[0])
				]
			}
			for (let i = 0; i < 2; i++) {
				const bloom = encoder.beginRenderPass({
					colorAttachments: [
						{
							view: this.bloomTextures[i].createView(),
							loadOp: "clear",
							storeOp: "store",
							clearValue: { r: 0, g: 0, b: 0, a: 0 }
						}
					]
				})
				if (clip) {
					const padding = Math.ceil(bloomRadius * 2) + 8
					const x = Math.max(0, Math.floor((clip.x - padding) / 4)),
						y = Math.max(0, Math.floor((clip.y - padding) / 4))
					bloom.setScissorRect(
						x,
						y,
						Math.min(
							this.bloomTextures[i].width,
							Math.ceil((clip.width + padding) / 4)
						) - x,
						Math.min(
							this.bloomTextures[i].height,
							Math.ceil((clip.height + padding) / 4)
						) - y
					)
				}
				bloom.setPipeline(this.bloomPipelines[i])
				bloom.setBindGroup(0, this.bloomBindings[i])
				bloom.draw(3)
				bloom.end()
			}
		}
		const post = encoder.beginRenderPass({
			colorAttachments: [
				{ view, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } }
			]
		})
		post.setPipeline(this.postPipeline)
		if (clip) {
			post.setScissorRect(clip.x, clip.y, clip.width - clip.x, clip.height - clip.y)
		}
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
		this.bloomTextures?.forEach((texture) => texture.destroy())
		this.atlas.destroy()
		this.context.unconfigure()
		this.device.destroy()
	}
}