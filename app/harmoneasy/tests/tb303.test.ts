// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import registerTB303Processor from "../../../packages/audiobus/wam/tb303/processor.js"
import { TB303_ID, TB303_PARAMETERS } from "../../../packages/audiobus/wam/tb303/parameters"
import { createTB303Gui, destroyTB303Gui } from "../../../packages/audiobus/wam/tb303/gui"
import { WAM_AUTOMATION_EVENT, WAM_MIDI_EVENT } from "../../../packages/audiobus/wam/host"
import { restoreDevice } from "../../../packages/audiobus/io/workspace-devices"
import { createContextSetup, START_CONTEXTS } from "../source/services/start-contexts"

afterEach(() => vi.unstubAllGlobals())

function processor(rate = 48000, parameters: Record<string, number> = {}) {
	let Processor: any
	vi.stubGlobal("sampleRate", rate)
	vi.stubGlobal("webAudioModules", {
		getModuleScope: () => ({
			WamProcessor: class {},
			WamParameterInfo: class {
				constructor(id: string, config: object) {
					Object.assign(this, { id }, config)
				}
			}
		})
	})
	vi.stubGlobal("registerProcessor", (id: string, ctor: any) => {
		expect(id).toBe(TB303_ID)
		Processor = ctor
	})
	new Function(`return (${registerTB303Processor.toString()})`)()(TB303_ID, TB303_PARAMETERS)
	const node = new Processor({})
	node._parameterInterpolators = Object.fromEntries(
		Object.entries(TB303_PARAMETERS).map(([id, config]) => [
			id,
			{ values: new Float32Array(128).fill(parameters[id] ?? config.defaultValue) }
		])
	)
	Object.assign(node.controls, parameters)
	return node
}
function render(node: any, frames = 128) {
	const result = new Float32Array(frames)
	for (let offset = 0; offset < frames; offset += 128) {
		const size = Math.min(128, frames - offset)
		const channels = [new Float32Array(size), new Float32Array(size)]
		node._process(0, size, [], [channels])
		expect(channels[0]).toEqual(channels[1])
		result.set(channels[0], offset)
	}
	return result
}
const rms = (audio: Float32Array) =>
	Math.sqrt(audio.reduce((sum, s) => sum + s * s, 0) / audio.length)
const midi = (node: any, ...bytes: number[]) => node._onMidi({ bytes })

describe("TB-303 phrasing", () => {
	it("slides in pitch-CV space with the C35 time constant without retriggering or resetting phase", () => {
		const node = processor()
		midi(node, 0x90, 48, 80)
		render(node, 2400)
		const envelope = node.mainEnvelope,
			phase = node.phase
		midi(node, 0x90, 72, 80)
		expect(node.mainEnvelope).toBe(envelope)
		expect(node.phase).toBe(phase)
		expect(node.pitch).toBe(48)
		render(node, 1056) // 22 ms = one RC time constant at 48 kHz
		expect(node.pitch).toBeCloseTo(72 - 24 / Math.E, 7)
		expect(node.mainEnvelope).toBeLessThan(envelope)
		midi(node, 0x80, 48, 0)
		expect(node.active.note).toBe(72)
		expect(node.gate).toBe(true)
		midi(node, 0x80, 72, 0)
		expect(node.gate).toBe(false)
	})
	it("uses one voice across channels and returns to the last held note", () => {
		const node = processor()
		midi(node, 0x90, 36, 80)
		midi(node, 0x91, 43, 80)
		midi(node, 0x92, 48, 80)
		expect(node.active.note).toBe(48)
		midi(node, 0x82, 48, 0)
		expect(node.active.note).toBe(43)
		midi(node, 0xb1, 120, 0)
		expect(node.active.note).toBe(36)
		midi(node, 0xb0, 120, 0)
		expect(node.active).toBeNull()
		expect(rms(render(node))).toBe(0)
	})
	it("implements binary accent rather than velocity-dependent volume", () => {
		const a = processor(),
			b = processor()
		midi(a, 0x90, 45, 30)
		midi(b, 0x90, 45, 99)
		expect(render(a, 4096)).toEqual(render(b, 4096))
		const accented = processor()
		midi(accented, 0x90, 45, 100)
		render(accented, 4096)
		expect(accented.accented).toBe(true)
		expect(accented.accentCapacitor).toBeGreaterThan(0)
		expect(accented.mainEnvelope).toBeLessThan(a.mainEnvelope)
	})
	it("measures normal decay to 10% and fixes accented decay at the minimum regardless of the knob", () => {
		for (const velocity of [80, 120]) {
			const node = processor(48000, { decay: 1 })
			midi(node, 0x90, 40, velocity)
			render(node, 96) // 2 ms trigger charge
			render(node, velocity >= 100 ? 9600 : 48000)
			expect(node.mainEnvelope).toBeCloseTo(0.1, 7)
		}
	})
	it("models the accent capacitor charge and retains it across triggers", () => {
		const node = processor()
		for (let i = 0; i < 3840; i++) {
			node._accentSweep(1, 1)
		} // 20 ms
		const target = 100000 / 247000
		const tau = ((147000 * 100000) / 247000) * 1e-6
		expect(node.accentCapacitor).toBeCloseTo(target * (1 - Math.exp(-0.02 / tau)), 10)
		const first = node.accentCapacitor
		for (let i = 0; i < 1920; i++) {
			node._accentSweep(0, 1)
		}
		midi(node, 0x90, 36, 120)
		expect(node.accentCapacitor).toBeGreaterThan(0)
		for (let i = 0; i < 3840; i++) {
			node._accentSweep(1, 1)
		}
		expect(node.accentCapacitor).toBeGreaterThan(first)
	})
	it("handles sustain, bend, controller reset and panic after releasing an accented note", () => {
		const node = processor()
		midi(node, 0x91, 45, 120)
		render(node, 1024)
		midi(node, 0xb1, 64, 127)
		midi(node, 0x81, 45, 0)
		expect(node.gate).toBe(true)
		midi(node, 0xe1, 127, 127)
		expect(node.targetPitch).toBeGreaterThan(46.99)
		midi(node, 0xb1, 121, 0)
		expect(node.gate).toBe(false)
		expect(node.held).toHaveLength(0)
		midi(node, 0xb1, 120, 0)
		expect(rms(render(node, 512))).toBe(0)
	})
})

// Independent complex-frequency reference for the published analogue circuit,
// rather than reproducing the processor's state update equations.
type Complex = [number, number]
const mul = (a: Complex, b: Complex): Complex => [
	a[0] * b[0] - a[1] * b[1],
	a[0] * b[1] + a[1] * b[0]
]
const div = (a: Complex, b: Complex): Complex => {
	const d = b[0] ** 2 + b[1] ** 2
	return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]
}
function reference(hz: number, cutoff: number, resonance: number): Complex {
	const w = hz / cutoff
	const denominator: Complex = [
		w ** 4 - 10 * Math.SQRT2 * w * w + 1,
		2 ** 3.25 * w - 2 ** 2.75 * w ** 3
	]
	const forwardPoles = [97.5, 38.5, 4.45, 578.1, 20, 7.41]
	const forwardZeros = [0, 109.9, 34, 0, 0, 7.41]
	const feedbackZeros = [0, 0, 46.5, 0, 0, 4.4]
	let forward: Complex = [1.06, 0],
		feedback: Complex = [18.7 * resonance, 0]
	for (let i = 0; i < forwardPoles.length; i++) {
		forward = mul(
			forward,
			div([forwardZeros[i], 2 * Math.PI * hz], [forwardPoles[i], 2 * Math.PI * hz])
		)
		feedback = mul(
			feedback,
			div([feedbackZeros[i], 2 * Math.PI * hz], [forwardPoles[i], 2 * Math.PI * hz])
		)
	}
	return div(forward, [denominator[0] + feedback[0], denominator[1] + feedback[1]])
}

describe("TB-303 circuit and rendering", () => {
	it.each([44100, 48000, 96000])("renders audible short Acid House gates at %i Hz", (rate) => {
		// The preset lowers A3 an octave and emits 1/32 gates at 120 BPM.
		// Include the application's 50% master volume and 85% dry mix.
		for (const note of [45, 48, 52, 57, 60, 64]) {
			const node = processor(rate)
			midi(node, 0x90, note, 80)
			const audio = render(node, Math.round(rate / 16)).map((value) => value * 0.5 * 0.85)
			expect(rms(audio)).toBeGreaterThan(0.025)
			expect(Math.max(...audio.map(Math.abs))).toBeLessThan(0.5)
			midi(node, 0x80, note, 0)
			render(node, Math.round(rate * 0.3))
			expect(rms(render(node))).toBeLessThan(1e-5)
		}
	})
	it("preserves oscillator pitch across sample rates and varies pulse width with pitch", () => {
		for (const rate of [44100, 48000, 96000]) {
			const node = processor(rate)
			let crossings = 0,
				previous = 0
			const length = (rate * 4) / 10
			for (let i = 0; i < length; i++) {
				const sample = node._oscillatorSample(440, 1)
				if (previous < 0 && sample >= 0) {
					crossings++
				}
				previous = sample
			}
			expect(crossings).toBe(43) // 44 cycles; first cycle starts high
		}
		const duty = (hz: number) => {
			const node = processor(),
				length = Math.round((192000 / hz) * 20)
			let high = 0
			for (let i = 0; i < length; i++) {
				if (node._oscillatorSample(hz, 1) > 0) {
					high++
				}
			}
			return high / length
		}
		expect(duty(32.7032)).toBeCloseTo(0.71, 2)
		expect(duty(1046.5)).toBeCloseTo(0.45, 2)
	})
	it.each([200, 1000, 4000])(
		"matches the published small-signal ladder AND coupling-network response at %i Hz",
		(hz) => {
			const node = processor(),
				rate = 192000,
				amplitude = 1e-5
			let re = 0,
				im = 0
			const settle = rate,
				length = rate / 4
			for (let i = 0; i < settle + length; i++) {
				const angle = (2 * Math.PI * hz * i) / rate
				const output = node._filterSample(amplitude * Math.cos(angle), 1000, 0.7)
				if (i >= settle) {
					re += output * Math.cos(angle)
					im -= output * Math.sin(angle)
				}
			}
			const actual: Complex = [(re * 2) / length / amplitude, (im * 2) / length / amplitude]
			const expected = reference(hz, 1000, 0.7)
			const error =
				Math.hypot(actual[0] - expected[0], actual[1] - expected[1]) /
				Math.hypot(...expected)
			expect(error).toBeLessThan(0.005)
		}
	)
	it.each([22050, 44100, 48000, 96000])(
		"stays finite, bounded and releases to silence at %i Hz",
		(rate) => {
			const node = processor(rate, {
				cutoff: 5000,
				resonance: 1,
				envMod: 1,
				accent: 1,
				volume: 1,
				waveform: 1
			})
			expect(rms(render(node))).toBe(0)
			midi(node, 0x90, 36, 127)
			const audio = render(node, Math.round(rate / 10))
			expect(audio.every(Number.isFinite)).toBe(true)
			expect(Math.max(...audio.map(Math.abs))).toBeLessThan(1.01)
			expect(rms(audio)).toBeGreaterThan(0.0001)
			midi(node, 0x90, 127, 127)
			render(node, 1024)
			midi(node, 0x80, 36, 0)
			midi(node, 0x80, 127, 0)
			render(node, Math.round(rate * 0.8))
			expect(rms(render(node))).toBeLessThan(1e-6)
		}
	)
	it("keeps event boundaries intact and smoothly applies automation", () => {
		const node = processor()
		const channel = new Float32Array(128).fill(0.5)
		node._process(16, 32, [], [[channel]])
		expect(channel[15]).toBe(0.5)
		expect(channel[16]).toBe(0)
		expect(channel[32]).toBe(0.5)
		midi(node, 0x90, 48, 100)
		node._parameterInterpolators.cutoff.values.fill(5000)
		render(node, 1)
		expect(node.controls.cutoff).toBeGreaterThan(450)
		expect(node.controls.cutoff).toBeLessThan(5000)
	})
	it("actually rejects frequencies above the output Nyquist during decimation", () => {
		const node = processor()
		const magnitude = (frequency: number) => {
			let re = 0,
				im = 0
			for (let i = 0; i < node.fir.length; i++) {
				re += node.fir[i] * Math.cos(2 * Math.PI * frequency * i)
				im -= node.fir[i] * Math.sin(2 * Math.PI * frequency * i)
			}
			return Math.hypot(re, im)
		}
		expect(magnitude(0.05)).toBeGreaterThan(0.999)
		expect(magnitude(0.15)).toBeLessThan(0.0002)
		expect(magnitude(0.25)).toBeLessThan(0.00001)
	})
})

describe("TB-303 output and panel", () => {
	it("restores the acid house preset output, routes to the mixer, forwards MIDI, resumes audio and cleans up", async () => {
		vi.stubGlobal("AudioWorkletNode", class {})
		const gain = { connect: vi.fn(), disconnect: vi.fn() },
			mixer = {} as AudioNode
		const context = {
			state: "suspended",
			resume: vi.fn(async () => {
				context.state = "running"
			}),
			currentTime: 4,
			createGain: () => gain,
			destination: {}
		}
		const setup = createContextSetup(
			START_CONTEXTS.find((context) => context.id === "acid-house")!
		)
		const saved = setup.devices.find((device) => device.id === "synth")!
		const output = await restoreDevice(
			saved,
			{
				audioContext: context as unknown as AudioContext,
				outputMixer: mixer as GainNode,
				now: () => context.currentTime
			},
			new Map()
		)
		const audioNode = {
			connect: vi.fn(),
			disconnect: vi.fn(),
			destroy: vi.fn(),
			scheduleEvents: vi.fn()
		}
		vi.spyOn(output as any, "createPlugin").mockResolvedValue({
			audioNode,
			descriptor: { name: "TB-303" },
			createGui: async () => document.createElement("section")
		})
		const gui = await output.createGui!()
		expect(output.name).toBe("TB-303")
		expect(output.configurationAffectsNoteRouting).toBe(false)
		expect(gain.connect).toHaveBeenCalledWith(mixer)
		expect(context.resume).toHaveBeenCalledOnce()
		expect(gui.querySelector("section")).not.toBeNull()
		expect(gui.querySelector('input[type="url"], input[type="search"]')).toBeNull()
		output.noteOn(48, 120)
		expect(audioNode.scheduleEvents).toHaveBeenCalledWith({
			type: WAM_MIDI_EVENT,
			time: 4,
			data: { bytes: [0x90, 48, 120] }
		})
		await output.disconnect!()
		expect(audioNode.destroy).toHaveBeenCalledOnce()
		await output.destroyGui!()
	})
	it("exposes only sound controls, schedules changes, reflects automation and removes listeners", async () => {
		const node = Object.assign(new EventTarget(), {
			context: { currentTime: 3 },
			getParameterValues: async () => ({}),
			scheduleEvents: vi.fn()
		})
		const remove = vi.spyOn(node, "removeEventListener")
		const gui = await createTB303Gui(node)
		const root = gui.shadowRoot!
		expect(root.querySelectorAll('input[type="range"]')).toHaveLength(7)
		expect(root.querySelectorAll("select")).toHaveLength(1)
		expect(root.querySelectorAll("button")).toHaveLength(0)
		const cutoff = root.querySelector<HTMLInputElement>('[aria-label="Cutoff Freq"]')!
		cutoff.value = "1"
		cutoff.dispatchEvent(new Event("input"))
		expect(node.scheduleEvents).toHaveBeenCalledWith({
			type: WAM_AUTOMATION_EVENT,
			time: 3,
			data: { id: "cutoff", value: 5000, normalized: false }
		})
		node.dispatchEvent(
			new CustomEvent(WAM_AUTOMATION_EVENT, { detail: { data: { id: "cutoff", value: 60 } } })
		)
		expect(cutoff.value).toBe("0")
		node.dispatchEvent(
			new CustomEvent(WAM_AUTOMATION_EVENT, {
				detail: { data: { id: "cutoff", value: 1, normalized: true } }
			})
		)
		expect(cutoff.value).toBe("1")
		const waveform = root.querySelector<HTMLSelectElement>("select")!
		waveform.value = "1"
		waveform.dispatchEvent(new Event("change"))
		expect(node.scheduleEvents).toHaveBeenLastCalledWith({
			type: WAM_AUTOMATION_EVENT,
			time: 3,
			data: { id: "waveform", value: 1, normalized: false }
		})
		destroyTB303Gui(gui)
		expect(remove).toHaveBeenCalledWith(WAM_AUTOMATION_EVENT, expect.any(Function))
	})
})