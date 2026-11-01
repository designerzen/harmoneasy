import { ControlSurface } from "../src/surface"
import { GpuSurfaceRenderer } from "../src/renderer"
import type { ControlBinding, ControlDescriptor, ControlValue, WidgetType } from "../src/types"
import "../src/style.css"
import { componentBindings } from "../../audiobus/io/component-ui"
import { EVENT_CONFIGURATION_CHANGED } from "../../audiobus/event-constants"
import PolySynth from "../../audiobus/instruments/polyphonic"
import SynthOscillator from "../../audiobus/instruments/oscillators/synth-oscillator"
import { normalize } from "../src/model"

const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve))
const percentile = (values: number[], p: number) => {
	const sorted = [...values].sort((a, b) => a - b)
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
}
let measure:
	| {
			prepare: number[]
			render: number[]
			settled?: number
			stepAt: number
			target: number
			kind: number
			gpuQueue: number[]
	  }
	| undefined
const prepare = GpuSurfaceRenderer.prototype.prepare,
	render = GpuSurfaceRenderer.prototype.render
GpuSurfaceRenderer.prototype.prepare = function (...args) {
	const start = performance.now()
	prepare.apply(this, args)
	if (measure) {
		measure.prepare.push(performance.now() - start)
		const data = (this as any).instances as ArrayLike<number>
		for (let n = 0; n < data.length; n += 20) {
			if (data[n + 4] === measure.kind) {
				if (
					measure.stepAt &&
					!measure.settled &&
					Math.abs(data[n + 5] - measure.target) < 0.005
				) {
					measure.settled = performance.now() - measure.stepAt
				}
				break
			}
		}
	}
}
GpuSurfaceRenderer.prototype.render = function (...args) {
	const start = performance.now()
	render.apply(this, args)
	if (measure) {
		const current = measure
		current.render.push(performance.now() - start)
		// Queue completion includes scheduling/queue delay; it is not a GPU timestamp duration.
		if (current.gpuQueue.length < 8) {
			void this.device.queue.onSubmittedWorkDone().then(() => {
				if (measure === current) {
					current.gpuQueue.push(performance.now() - start)
				}
			})
		}
	}
}
function descriptor(widget: WidgetType, id: string): ControlDescriptor {
	return {
		id,
		label: `${widget} control`,
		widget,
		min: 0,
		max: 1,
		step: 0.001,
		...(["radio", "select"].includes(widget)
			? {
					choices: [
						{ label: "Low", value: 0 },
						{ label: "Mid", value: 0.5 },
						{ label: "High", value: 1 }
					]
				}
			: {}),
		...(["meter", "display"].includes(widget) ? { readOnly: true } : {})
	}
}
function value(widget: WidgetType, n: number): ControlValue {
	if (widget === "toggle") {
		return n > 0.5
	}
	if (widget === "xy" || widget === "range") {
		return [n, 1 - n]
	}
	if (widget === "radio" || widget === "select") {
		return n < 0.33 ? 0 : n < 0.66 ? 0.5 : 1
	}
	if (widget === "text" || widget === "display") {
		return `Value ${Math.round(n * 100)}`
	}
	if (widget === "color") {
		return `#${Math.round(n * 0xffffff)
			.toString(16)
			.padStart(6, "0")}`
	}
	return n
}
async function run(
	widget: WidgetType,
	count = 1,
	animateAll = false,
	iterations = 180,
	eventsPerFrame = 1,
	bindingCostMs = 0
) {
	const audio = new AudioContext({ latencyHint: "interactive" })
	const worklet = `class Probe extends AudioWorkletProcessor {static get parameterDescriptors(){return [{name:'sequence',defaultValue:0,minValue:0,maxValue:1000000,automationRate:'a-rate'}]}; last=0;process(inputs,outputs,params){for(let i=0;i<params.sequence.length;i++){const seq=params.sequence[i];if(seq!==this.last){this.last=seq;this.port.postMessage({seq,at:currentTime+i/sampleRate})}}return true}}registerProcessor('probe',Probe)`
	const url = URL.createObjectURL(new Blob([worklet], { type: "text/javascript" }))
	await audio.audioWorklet.addModule(url)
	URL.revokeObjectURL(url)
	const node = new AudioWorkletNode(audio, "probe"),
		mute = audio.createGain()
	mute.gain.value = 0
	node.connect(mute).connect(audio.destination)
	await audio.resume()
	let inputAt = 0,
		sequence = 0,
		reads = 0,
		writes = 0
	const inputToWrite: number[] = [],
		audioDelays: number[] = [],
		scheduled = new Map<number, number>()
	node.port.onmessage = (event) => {
		const time = scheduled.get(event.data.seq)
		if (time !== undefined) {
			audioDelays.push(Math.max(0, (event.data.at - time) * 1000))
			scheduled.delete(event.data.seq)
		}
	}
	const listeners = new Set<() => void>(),
		values = new Map<string, ControlValue>()
	const bindings: ControlBinding[] = Array.from({ length: count }, (_, index) => {
		const d = descriptor(widget, `${widget}-${index}`)
		values.set(d.id, value(widget, 0.15))
		return {
			key: d.id,
			descriptor: d,
			sourceLabel: "Live audio engine",
			read() {
				reads++
				return values.get(d.id)
			},
			write(v) {
				const end = performance.now() + bindingCostMs
				while (performance.now() < end) {
					/* Simulate synchronous engine/GUI work. */
				}
				writes++
				inputToWrite.push(performance.now() - inputAt)
				values.set(d.id, v)
				const seq = ++sequence
				scheduled.set(seq, audio.currentTime)
				node.parameters.get("sequence")!.setValueAtTime(seq, audio.currentTime)
				for (const listener of listeners) {
					listener()
				}
			},
			subscribe(listener) {
				listeners.add(listener)
				return () => listeners.delete(listener)
			}
		}
	})
	// Exercise the application's component adapter and configuration events,
	// rather than a direct, lightweight binding that bypasses integration work.
	const original = new Map(
		bindings.map((binding) => [
			binding.descriptor.id,
			{ read: binding.read, write: binding.write }
		])
	)
	const component = Object.assign(new EventTarget(), {
		name: "Profile engine",
		getUiDescriptor: () => ({ controls: bindings.map((binding) => binding.descriptor) }),
		getControlValue: (id: string) => original.get(id)!.read(),
		setControlValue(id: string, next: ControlValue) {
			original.get(id)!.write(next)
			this.dispatchEvent(new Event(EVENT_CONFIGURATION_CHANGED))
		}
	})
	const connected = await componentBindings(component, "profile")
	for (let i = 0; i < bindings.length; i++) {
		bindings[i].read = connected[i].read
		bindings[i].write = connected[i].write
		bindings[i].subscribe = connected[i].subscribe
	}
	const surface = new ControlSurface({
		state: {
			id: "profile",
			name: "Profile",
			connections: [],
			widgets: bindings.map((b) => ({ key: b.key })),
			theme: "neon"
		},
		bindings,
		change: () => {}
	})
	document.body.replaceChildren(surface.element)
	document.body.style.cssText = "margin:0;background:#080d18;padding:8px"
	const deadline = performance.now() + 15000
	while (!surface.element.classList.contains("cs-gpu-ready")) {
		if (performance.now() > deadline) {
			throw new Error(surface.element.textContent ?? "GPU initialization timed out")
		}
		await frame()
	}
	for (let n = 0; n < 10; n++) {
		await frame()
	}
	const kinds: Partial<Record<WidgetType, number>> = {
		dial: 1,
		slider: 2,
		range: 2,
		toggle: 3,
		xy: 4,
		button: 5,
		pad: 10,
		radio: 6,
		meter: 7
	}
	const stats = {
		prepare: [] as number[],
		render: [] as number[],
		stepAt: 0,
		target: 0.85,
		kind: kinds[widget] ?? 8,
		gpuQueue: [] as number[],
		settled: undefined as number | undefined
	}
	measure = stats
	const stage = surface.element.querySelector<HTMLElement>(".cs-stage")!,
		rect = stage.getBoundingClientRect(),
		first = (surface as any).entries[0].visual
	const move = (n: number) => {
		if (animateAll) {
			for (const binding of bindings.slice(1)) {
				values.set(binding.key, value(widget, n))
			}
			for (const listener of listeners) {
				listener()
			}
		}
		inputAt = performance.now()
		if (["dial", "slider", "xy", "range", "radio", "number"].includes(widget)) {
			const x =
				widget === "dial" || widget === "number"
					? 100
					: 8 + first.width * 0.08 + n * (first.width * 0.84 - 16)
			const y = widget === "dial" || widget === "number" ? 100 - (n - 0.15) * 160 : 90
			stage.dispatchEvent(
				new PointerEvent("pointermove", {
					pointerId: 1,
					clientX: rect.left + x,
					clientY: rect.top + y,
					bubbles: true
				})
			)
		} else if (widget === "pad") {
			surface.pointerMove(1, 90, 90, false, n)
		} else if (widget === "toggle" || widget === "button") {
			surface.pointerDown(2, 90, 90)
			surface.pointerUp(2)
		} else if (["text", "color", "select"].includes(widget)) {
			const input = stage.querySelector<HTMLInputElement | HTMLSelectElement>("input,select")!
			input.value =
				widget === "select" ? String(Math.floor(n * 2.999)) : String(value(widget, n))
			input.dispatchEvent(
				new Event(widget === "select" || widget === "text" ? "change" : "input", {
					bubbles: true
				})
			)
		} else {
			values.set(bindings[0].key, value(widget, n))
			for (const listener of listeners) {
				listener()
			}
		}
	}
	if (["dial", "slider", "xy", "range", "radio", "number"].includes(widget)) {
		surface.pointerDown(1, 100, 100)
	}
	if (widget === "pad") {
		surface.pointerDown(1, 90, 90)
	}
	reads = 0
	writes = 0
	inputToWrite.length = 0
	const intervals: number[] = []
	let previous = await frame()
	for (let n = 0; n < iterations; n++) {
		const now = await frame()
		intervals.push(now - previous)
		previous = now
		for (let event = 0; event < eventsPerFrame; event++) {
			move(0.5 + Math.sin((n + event / eventsPerFrame) * 0.3) * 0.35)
			await Promise.resolve()
		}
	}
	stats.stepAt = performance.now()
	move(0.85)
	for (let n = 0; n < 18; n++) {
		await frame()
	}
	surface.pointerUp(1)
	const result = {
		widget,
		count,
		animateAll,
		eventsPerFrame,
		bindingCostMs,
		frames: intervals.length,
		fps: 1000 / (intervals.reduce((a, b) => a + b, 0) / intervals.length),
		frameP95: percentile(intervals, 0.95),
		frameP99: percentile(intervals, 0.99),
		longestFrame: Math.max(...intervals),
		droppedFrames: intervals.filter((interval) => interval > 25).length,
		prepareP95: percentile(stats.prepare, 0.95),
		renderSubmitP95: percentile(stats.render, 0.95),
		inputToWriteP95: percentile(inputToWrite, 0.95),
		audioApplyP95: percentile(audioDelays, 0.95),
		audioAppliedSamples: audioDelays.length,
		queueCompletionP95: percentile(stats.gpuQueue, 0.95),
		settleMs: stats.settled ?? null,
		reads,
		writes
	}
	measure = undefined
	surface.destroy()
	node.disconnect()
	mute.disconnect()
	await audio.close()
	return result
}
Object.assign(window, { profileSurface: run })

async function profilePolySynth(
	zoom = 1,
	iterations = 300,
	mode: "level" | "pan" | "rotation" = "level"
) {
	const audio = new AudioContext({ latencyHint: "interactive" })
	const synth = new PolySynth(audio, { class: SynthOscillator })
	const mute = audio.createGain()
	mute.gain.value = 0
	synth.output.connect(mute).connect(audio.destination)
	await audio.resume()
	await Promise.resolve()
	for (let note = 48; note < 56; note++) {
		await synth.noteOn(note, 100)
	}
	const bindings = (await componentBindings(synth, "polysynth")).filter((binding) =>
		["dial", "slider", "number"].includes(binding.descriptor.widget)
	)
	bindings.sort(
		(a, b) => Number(b.descriptor.id === "attack") - Number(a.descriptor.id === "attack")
	)
	let writes = 0
	for (const binding of bindings) {
		const write = binding.write
		binding.write = (value) => {
			writes++
			return write(value)
		}
	}
	const surface = new ControlSurface({
		state: {
			id: "poly",
			name: "PolySynth",
			connections: [],
			widgets: bindings.map((binding) => ({
				key: binding.key,
				widget: "dial",
				dial: { mode, ticks: 12 }
			})),
			theme: "ice"
		},
		bindings,
		change: () => {}
	})
	const nativeGui = await synth.createGui()
	surface.element.style.transform = `scale(${zoom})`
	surface.element.style.transformOrigin = "top left"
	document.body.replaceChildren(surface.element, nativeGui)
	while (!surface.element.classList.contains("cs-gpu-ready")) {
		await frame()
	}
	const entries = (surface as any).entries,
		renderer = (surface as any).renderer
	for (let i = 0; i < entries.length; i++) {
		const visual = entries[i].visual
		surface.pointerDown(100 + i, visual.x + 90, visual.y + 100)
	}
	const stats = {
		prepare: [] as number[],
		render: [] as number[],
		stepAt: 0,
		target: 0.85,
		kind: 1,
		gpuQueue: [] as number[]
	}
	measure = stats
	const intervals: number[] = []
	let previous = await frame(),
		trackingError = 0
	const stage = surface.element.querySelector<HTMLElement>(".cs-stage")!
	for (let n = 0; n < iterations; n++) {
		const now = await frame()
		intervals.push(now - previous)
		previous = now
		for (let i = 0; i < entries.length; i++) {
			const visual = entries[i].visual,
				batch = renderer.cache.get(visual).data
			for (let offset = 0; offset < batch.length; offset += 20) {
				if (batch[offset + 4] === 1) {
					trackingError = Math.max(
						trackingError,
						Math.abs(batch[offset + 5] - normalize(visual.descriptor, visual.value))
					)
					break
				}
			}
			const gesture = (surface as any).gestures.get(100 + i)
			const position = 0.5 + Math.sin(n * 0.15 + i) * 0.35
			const rect = stage.getBoundingClientRect()
			const y = visual.y + 100 - (position - gesture.startValue) * 160
			stage.dispatchEvent(
				new PointerEvent("pointermove", {
					pointerId: 100 + i,
					clientX: rect.left + (visual.x + 90) * zoom,
					clientY: rect.top + y * zoom,
					bubbles: true
				})
			)
		}
	}
	for (let i = 0; i < entries.length; i++) {
		surface.pointerUp(100 + i)
	}
	const result = {
		engine: "PolySynth",
		mode,
		zoom,
		dials: entries.length,
		activeVoices: synth.activeVoices,
		nativeGuiOpen: true,
		frames: iterations,
		fps: 1000 / (intervals.reduce((a, b) => a + b, 0) / intervals.length),
		frameP99: percentile(intervals, 0.99),
		longestFrame: Math.max(...intervals),
		droppedFrames: intervals.filter((interval) => interval > 25).length,
		prepareP95: percentile(stats.prepare, 0.95),
		trackingError,
		writes
	}
	measure = undefined
	surface.destroy()
	synth.allNotesOff()
	await synth.destroyGui()
	synth.output.disconnect()
	mute.disconnect()
	await audio.close()
	return result
}
Object.assign(window, { profilePolySynth })