import { createDomControl } from "./dom"
import { EVENT_ABORT, EVENT_BLUR, EVENT_CHANGE, EVENT_CLICK, EVENT_CLOSE, EVENT_KEY_DOWN, EVENT_LOST_POINTER_CAPTURE, EVENT_POINTER_CANCEL, EVENT_POINTER_DOWN, EVENT_POINTER_MOVE, EVENT_POINTER_UP, EVENT_VISIBILITY_CHANGE } from "./events"
import { bindingKey, clamp, denormalize, layoutWidgets, normalize, sameValue, validateValue, widgetChoices } from "./model"
import { GpuSurfaceRenderer, type WidgetVisual } from "./renderer"
import type { ControlBinding, ControlValue, SurfaceState, SurfaceWidget } from "./types"

interface Entry {
	config: SurfaceWidget
	binding: ControlBinding
	visual: WidgetVisual
	element: HTMLElement
	update(value: ControlValue | undefined): void
	version: number
	busy: boolean
	pending?: ControlValue
	actions: ControlValue[]
	missing: boolean
}
interface Gesture { entry: Entry; startY: number; startValue: number; axis: number }
export interface SurfaceOptions {
	state: SurfaceState
	bindings: ControlBinding[]
	change(state: SurfaceState): void
	configurationChanged?(): void
}

/** DOM owns semantics and input; a single WebGPU canvas draws all widget faces and text. */
export class ControlSurface {
	readonly element = document.createElement("section")
	readonly canvas = document.createElement("canvas")
	private stage = document.createElement("div")
	private status = document.createElement("p")
	private abort = new AbortController()
	private renderer?: GpuSurfaceRenderer
	private entries: Entry[] = []
	private unsubscribers: (() => void)[] = []
	private gestures = new Map<number, Gesture>()
	private resize: ResizeObserver
	private intersection: IntersectionObserver
	private visible = true
	private disposed = false
	private editing = false
	private frame = 0
	private poll = 0
	private reading = false
	private height = 120
	private motion = matchMedia("(prefers-reduced-motion: reduce)")
	private recovering = false
	private xr?: { end(): Promise<void> }
	private vrButton: HTMLButtonElement

	constructor(private options: SurfaceOptions) {
		this.element.className = "control-surface nodrag nopan nowheel"
		this.element.dataset.midiScope = `surface:${options.state.id}`
		this.element.dataset.midiLabel = options.state.name
		this.element.addEventListener(EVENT_KEY_DOWN,event=>event.stopPropagation(),{signal:this.abort.signal})
		this.stage.className = "cs-stage"
		this.canvas.setAttribute("aria-hidden", "true")
		this.stage.append(this.canvas)
		const toolbar = document.createElement("div"); toolbar.className = "cs-toolbar"
		const edit = this.button("Edit layout", () => { this.editing = !this.editing; edit.textContent = this.editing ? "Perform" : "Edit layout"; edit.setAttribute("aria-pressed", String(this.editing)); this.rebuild() })
		edit.setAttribute("aria-pressed", "false")
		const theme = document.createElement("select"); theme.setAttribute("aria-label", "Surface theme")
		for (const value of ["neon", "amber", "ice"] as const) { const option = document.createElement("option"); option.value=value; option.textContent=value; theme.append(option) }
		theme.value=options.state.theme ?? "neon"
		theme.addEventListener(EVENT_CHANGE, () => { options.state.theme=theme.value as SurfaceState["theme"]; this.renderer?.setTheme(options.state.theme!); this.save() }, { signal: this.abort.signal })
		this.vrButton=this.button("Enter VR", () => void this.enterXR())
		toolbar.append(edit,theme,this.button("Add XY pad", () => this.addXY()),this.vrButton)
		this.status.className="cs-status"; this.status.setAttribute("role","status")
		this.element.append(toolbar,this.stage,this.status)
		this.resize=new ResizeObserver(() => this.layout())
		this.resize.observe(this.element)
		this.intersection=new IntersectionObserver(entries => { this.visible=entries.some(e => e.isIntersecting) })
		this.intersection.observe(this.element)
		const listen = (type: string, listener: EventListener) => this.stage.addEventListener(type,listener,{ signal:this.abort.signal })
		listen(EVENT_POINTER_DOWN,event => {
			const e=event as PointerEvent
			if ((e.target as HTMLElement).closest("input,select,button,textarea")) return
			const rect=this.stage.getBoundingClientRect()
			if (this.pointerDown(e.pointerId,(e.clientX-rect.left)*this.stage.clientWidth/rect.width,(e.clientY-rect.top)*this.height/rect.height,e.shiftKey)) {
				e.preventDefault(); this.stage.setPointerCapture(e.pointerId)
			}
		})
		listen(EVENT_POINTER_MOVE,event => {
			const e=event as PointerEvent, rect=this.stage.getBoundingClientRect()
			this.pointerMove(e.pointerId,(e.clientX-rect.left)*this.stage.clientWidth/rect.width,(e.clientY-rect.top)*this.height/rect.height,e.shiftKey)
		})
		for (const type of [EVENT_POINTER_UP,EVENT_POINTER_CANCEL,EVENT_LOST_POINTER_CAPTURE]) listen(type,event => this.pointerUp((event as PointerEvent).pointerId))
		window.addEventListener(EVENT_BLUR,()=>this.releasePointers(),{signal:this.abort.signal})
		document.addEventListener(EVENT_VISIBILITY_CHANGE,()=> { if(document.hidden) this.releasePointers() },{signal:this.abort.signal})
		this.rebuild()
		void this.initialize()
		this.poll=window.setInterval(()=>void this.refresh(),160)
		const loop=(time:number) => {
			if(this.disposed) return
			if(this.renderer && this.visible && !document.hidden && !this.xr) {
				try { this.renderer.prepare(this.entries.map(e=>e.visual),!this.motion.matches); this.renderer.render(this.stage.clientWidth || 640,this.height,time/1000,!this.motion.matches) }
				catch(error) { void this.gpuError(error instanceof Error ? error : new Error(String(error))) }
			}
			this.frame=requestAnimationFrame(loop)
		}
		this.frame=requestAnimationFrame(loop)
	}
	private button(label:string,run:()=>void):HTMLButtonElement {
		const button=document.createElement("button"); button.type="button"; button.textContent=label
		button.addEventListener(EVENT_CLICK,run,{signal:this.abort.signal}); return button
	}
	private save() {
		const used=new Set(this.options.state.widgets.flatMap(w=>w.yKey?[w.key,w.yKey]:[w.key]))
		this.options.state.connections=this.options.state.connections.map(c=>({...c,controlIds:c.controlIds.filter(id=>used.has(bindingKey(c.componentId,id)))})).filter(c=>c.controlIds.length)
		this.options.change(structuredClone(this.options.state))
	}
	private async initialize():Promise<void> {
		try {
			const renderer=await GpuSurfaceRenderer.create(this.canvas,error=>void this.gpuError(error))
			if(this.disposed) {renderer.destroy();return}
			this.renderer=renderer; renderer.setTheme(this.options.state.theme??"neon");this.element.classList.add("cs-gpu-ready")
		} catch(error) { if(!this.disposed) {this.status.textContent=String(error);this.element.classList.remove("cs-gpu-ready")} }
	}
	private async gpuError(error:Error):Promise<void> {
		if(this.recovering || this.disposed) return
		this.recovering=true;this.status.textContent=error.message;this.element.classList.remove("cs-gpu-ready")
		await this.xr?.end().catch(()=>{})
		this.renderer?.destroy();this.renderer=undefined
		await this.initialize();this.recovering=false
	}
	private rebuild():void {
		this.releasePointers();this.unsubscribers.forEach(fn=>fn());this.unsubscribers=[]
		for(const entry of this.entries) entry.element.remove()
		this.entries=[]
		const bindings=new Map(this.options.bindings.map(b=>[b.key,b]))
		const configurations=this.options.state.widgets
		for(const config of configurations) {
			let binding=bindings.get(config.key)
			if(config.yKey && binding && bindings.has(config.yKey)) {
				const x=binding,y=bindings.get(config.yKey)!
				binding={key:bindingKey(x.key,y.key),sourceLabel:`${x.sourceLabel} / ${y.sourceLabel}`,descriptor:{id:"xy",label:`${x.descriptor.label} / ${y.descriptor.label}`,widget:"xy",min:0,max:1,step:0.001},
					async read(){return [normalize(x.descriptor,Number(await x.read())),normalize(y.descriptor,Number(await y.read()))]},
					async write(value){const v=value as number[];await x.write(denormalize(x.descriptor,v[0]));await y.write(denormalize(y.descriptor,v[1]))},
					subscribe(listener){const a=x.subscribe?.(listener),b=y.subscribe?.(listener);return()=>{a?.();b?.()}}
				}
			}
			const unavailable=!binding || !!config.yKey&&!bindings.has(config.yKey)
			binding??={key:config.key,sourceLabel:"Missing component",descriptor:{id:config.key,label:"Unavailable control",widget:"display",readOnly:true},read:()=>undefined,write:()=>{}}
			const widget=config.yKey ? "xy" : config.widget && widgetChoices(binding.descriptor).includes(config.widget) ? config.widget : binding.descriptor.widget
			const element=document.createElement("div");element.className="cs-widget"
			const entry:Entry={config,binding,element,visual:{key:binding.key,x:0,y:0,width:0,height:172,descriptor:binding.descriptor,widget,sourceLabel:binding.sourceLabel,value:binding.descriptor.defaultValue,unavailable},update:()=>{},version:0,busy:false,actions:[],missing:unavailable}
			const control=createDomControl({...binding,descriptor:{...binding.descriptor,widget,disabled:unavailable||binding.descriptor.disabled}},value=>void this.write(entry,value))
			control.element.className=`cs-semantic cs-${widget}`
			entry.update=value=>{control.update(value);for(const input of control.element.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLButtonElement>("input,select,button"))input.disabled=!!(entry.visual.unavailable||entry.binding.descriptor.disabled||entry.binding.descriptor.readOnly)};element.append(control.element)
			if(this.editing) {
				const tools=document.createElement("div");tools.className="cs-widget-tools"
				const kind=document.createElement("select");kind.setAttribute("aria-label",`${binding.descriptor.label} widget`)
				for(const type of config.yKey ? ["xy"] : widgetChoices(binding.descriptor)) {const option=document.createElement("option");option.value=type;option.textContent=type;kind.append(option)}
				kind.value=widget;kind.addEventListener(EVENT_CHANGE,()=>{config.widget=kind.value as SurfaceWidget["widget"];this.rebuild();this.save()})
				const move=(offset:number)=>{const i=configurations.indexOf(config),j=i+offset;if(j<0||j>=configurations.length)return;[configurations[i],configurations[j]]=[configurations[j],configurations[i]];this.rebuild();this.save()}
				tools.append(kind,this.button("←",()=>move(-1)),this.button("→",()=>move(1)),this.button("Size",()=>{config.span=(config.span??1)%3+1;this.layout();this.save()}),this.button("Remove",()=>{configurations.splice(configurations.indexOf(config),1);this.rebuild();this.save()}))
				for(const button of tools.querySelectorAll("button")) button.setAttribute("aria-label",`${button.textContent} ${binding.descriptor.label}`)
				element.append(tools)
			}
			this.entries.push(entry);this.stage.append(element)
			this.unsubscribers.push(binding.subscribe?.(()=>void this.refresh())??(()=>{}))
		}
		this.element.classList.toggle("cs-editing",this.editing)
		this.status.textContent=this.entries.length ? "" : "Drag a component’s Controls connector here to choose controls."
		this.layout();void this.refresh()
	}
	private layout():void {
		const layout=layoutWidgets(this.entries.map(e=>e.config),this.stage.clientWidth||640)
		this.height=layout.height;this.stage.style.height=`${this.height}px`
		for(const [index,entry] of this.entries.entries()) {
			Object.assign(entry.visual,layout.items[index]);const r=entry.visual
			entry.element.style.cssText=`left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px`
		}
	}
	private async refresh():Promise<void> {
		if(this.disposed||this.reading)return
		this.reading=true
		try{await Promise.all(this.entries.map(async entry=>{
			if(entry.busy||entry.missing)return
			const version=entry.version
			try{const value=await entry.binding.read();if(this.disposed||version!==entry.version||entry.busy)return
				entry.visual.unavailable=value===undefined&&entry.visual.widget!=="button"
				if(!sameValue(value,entry.visual.value)){entry.visual.value=value;entry.update(value)}
				else entry.update(value)
			}catch{entry.visual.unavailable=true;entry.update(undefined)}
		}))}finally{this.reading=false}
	}
	private async write(entry:Entry,value:ControlValue):Promise<void> {
		if(entry.visual.unavailable)return
		try{value=validateValue({...entry.binding.descriptor,widget:entry.visual.widget},value)}catch(error){this.status.textContent=String(error);return}
		entry.visual.value=value;entry.update(value);if(entry.visual.widget==="button")entry.actions.push(value);else entry.pending=value;entry.version++
		if(entry.busy)return
		entry.busy=true
		try{while((entry.pending!==undefined||entry.actions.length)&&!this.disposed){const next=entry.actions.length?entry.actions.shift()!:entry.pending!;entry.pending=undefined;await entry.binding.write(next)}this.status.textContent="";this.options.configurationChanged?.()}
		catch(error){this.status.textContent=String(error);entry.pending=undefined;entry.actions=[]}
		finally{entry.busy=false;void this.refresh()}
	}
	/** Local surface coordinates also accept projected XR rays/hand positions. */
	pointerDown(id:number,x:number,y:number,fine=false):boolean {
		const entry=this.entries.find(e=>x>=e.visual.x&&x<=e.visual.x+e.visual.width&&y>=e.visual.y+46&&y<=e.visual.y+e.visual.height-26)
		if(!entry||this.editing||entry.visual.unavailable||entry.binding.descriptor.disabled||entry.binding.descriptor.readOnly||["text","color","meter","display"].includes(entry.visual.widget))return false
		const value=entry.visual.value
		const axis=entry.visual.widget==="range"&&Array.isArray(value) ? Number(Math.abs(normalize(entry.binding.descriptor,value[0])-(x-entry.visual.x)/entry.visual.width)>Math.abs(normalize(entry.binding.descriptor,value[1])-(x-entry.visual.x)/entry.visual.width)) : 0
		this.gestures.set(id,{entry,startY:y,startValue:normalize(entry.binding.descriptor,Number(value)),axis})
		entry.visual.active=true
		if(entry.visual.widget==="button")void this.write(entry,entry.binding.descriptor.defaultValue??1)
		else if(entry.visual.widget==="toggle")void this.write(entry,!value)
		else if(entry.visual.widget==="select"&&entry.binding.descriptor.choices?.length){const choices=entry.binding.descriptor.choices,index=choices.findIndex(c=>sameValue(c.value,value));void this.write(entry,choices[(index+1)%choices.length].value)}
		else this.pointerMove(id,x,y,fine)
		return true
	}
	pointerMove(id:number,x:number,y:number,fine=false):void {
		const gesture=this.gestures.get(id);if(!gesture)return
		const {entry}=gesture,{visual:v,binding:{descriptor:d}}=entry
		const px=clamp((x-v.x-8-v.width*0.08)/(v.width*0.84-16)),py=clamp(1-(y-v.y-48-(v.height-76)*0.08)/((v.height-76)*0.84))
		if(v.widget==="dial"||v.widget==="number")void this.write(entry,denormalize(d,gesture.startValue+(gesture.startY-y)/(fine?1600:160)))
		else if(v.widget==="slider")void this.write(entry,denormalize(d,px))
		else if(v.widget==="xy")void this.write(entry,[denormalize(d,px),denormalize(d,py)])
		else if(v.widget==="range"){const values=Array.isArray(v.value)?[...v.value]:[d.min??0,d.max??1];values[gesture.axis]=denormalize(d,px);void this.write(entry,values)}
		else if(v.widget==="radio"&&d.choices?.length)void this.write(entry,d.choices[Math.min(d.choices.length-1,Math.floor(clamp((x-v.x-8)/(v.width-16))*d.choices.length))].value)
	}
	pointerUp(id:number):void {const gesture=this.gestures.get(id);this.gestures.delete(id);if(gesture)gesture.entry.visual.active=[...this.gestures.values()].some(g=>g.entry===gesture.entry)}
	private releasePointers():void {for(const id of this.gestures.keys())this.pointerUp(id)}
	private addXY():void {
		const numeric=this.options.bindings.filter(b=>["dial","slider","number"].includes(b.descriptor.widget)&&!b.descriptor.readOnly)
		const dialog=document.createElement("dialog"),form=document.createElement("form"),title=document.createElement("h2")
		title.textContent="Add an XY pad";form.method="dialog";form.append(title)
		const selects=["X parameter","Y parameter"].map(text=>{const label=document.createElement("label"),select=document.createElement("select");label.append(text,select);for(const b of numeric){const o=document.createElement("option");o.value=b.key;o.textContent=`${b.sourceLabel}: ${b.descriptor.label}`;select.append(o)}form.append(label);return select})
		const add=this.button("Add",()=>{const [x,y]=selects.map(s=>s.value);if(!x||!y||x===y)return;this.options.state.widgets.push({key:x,yKey:y,widget:"xy",span:2});this.rebuild();this.save();dialog.close()})
		add.disabled=numeric.length<2
		if(numeric.length>1)selects[1].selectedIndex=1
		form.append(add,this.button("Cancel",()=>dialog.close()));dialog.append(form);document.body.append(dialog)
		dialog.addEventListener(EVENT_CLOSE,()=>dialog.remove(),{once:true});this.abort.signal.addEventListener(EVENT_ABORT,()=>dialog.close(),{once:true});dialog.showModal()
	}
	private async enterXR():Promise<void> {
		if(this.xr){await this.xr.end();return}
		if(!this.renderer){this.status.textContent="WebGPU must be available before entering VR.";return}
		try{const {startSurfaceXR}=await import("./xr");this.xr=await startSurfaceXR(this.renderer,()=>({widgets:this.entries.map(e=>e.visual),width:this.stage.clientWidth,height:this.height}),this,()=>{this.xr=undefined;this.vrButton.textContent="Enter VR";this.releasePointers()});this.vrButton.textContent="Exit VR"}
		catch(error){this.status.textContent=String(error)}
	}
	async setEffect(wgsl:string):Promise<void>{if(!this.renderer)throw new Error("WebGPU is unavailable");await this.renderer.setEffect(wgsl)}
	async setPostEffect(wgsl:string):Promise<void>{if(!this.renderer)throw new Error("WebGPU is unavailable");await this.renderer.setPostEffect(wgsl)}
	destroy():void {
		if(this.disposed)return
		this.disposed=true;this.abort.abort();this.releasePointers();this.unsubscribers.forEach(fn=>fn());this.resize.disconnect();this.intersection.disconnect();clearInterval(this.poll);cancelAnimationFrame(this.frame)
		void this.xr?.end().catch(()=>{});this.renderer?.destroy();this.element.remove()
	}
}
