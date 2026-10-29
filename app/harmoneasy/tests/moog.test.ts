// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import registerMoogProcessor from "../../../packages/audiobus/wam/moog/processor.js"
import {
	MOOG_CONTROL_GROUPS,
	MOOG_ID,
	MOOG_PARAMETERS
} from "../../../packages/audiobus/wam/moog/parameters"
import { createMoogGui, destroyMoogGui } from "../../../packages/audiobus/wam/moog/gui"
import { WAM_AUTOMATION_EVENT, WAM_MIDI_EVENT } from "../../../packages/audiobus/wam/host"
import { createOutputById } from "../../../packages/audiobus/io/output-factory"

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
		expect(id).toBe(MOOG_ID)
		Processor = ctor
	})
	// The SDK stringifies the function and runs it in an isolated worklet scope.
	const register = new Function(`return (${registerMoogProcessor.toString()})`)()
	register(MOOG_ID, MOOG_PARAMETERS)
	const node = new Processor({})
	node._parameterInterpolators = Object.fromEntries(
		Object.entries(MOOG_PARAMETERS).map(([id, config]) => [
			id,
			{ values: new Float32Array(128).fill(parameters[id] ?? config.defaultValue) }
		])
	)
	return node
}
function render(node: any, blocks = 1) {
	const result: number[] = []
	for (let block = 0; block < blocks; block++) {
		const channels = [new Float32Array(128), new Float32Array(128)]
		node._process(0, 128, [], [channels])
		expect(channels[0]).toEqual(channels[1])
		result.push(...channels[0])
	}
	return result
}
const rms = (samples: number[]) =>
	Math.sqrt(samples.reduce((sum, s) => sum + s * s, 0) / samples.length)

describe("Moog WAM processor", () => {
	it("is silent until a note arrives and releases back to silence", () => {
		const node = processor(48000, { release: 0.005 })
		expect(rms(render(node))).toBe(0)
		node._onMidi({ bytes: [0x90, 69, 110] })
		expect(rms(render(node, 10))).toBeGreaterThan(0.005)
		node._onMidi({ bytes: [0x90, 69, 0] })
		render(node, 12)
		expect(rms(render(node))).toBe(0)
		expect(node.voices).toHaveLength(0)
	})
	it("attenuates high frequencies when the ladder cutoff is lowered", () => {
		const amplitude = (frequency: number) => {
			const node = processor(48000, { frequency, waveform: 3, gain: 0 })
			node._onMidi({ bytes: [0x90, 93, 127] })
			render(node, 20)
			return rms(render(node, 10))
		}
		expect(amplitude(200)).toBeLessThan(amplitude(10000) / 20)
	})
	it.each([22050, 44100, 48000, 96000])("stays finite at parameter extremes at %i Hz", (rate) => {
		const node = processor(rate, { frequency: 20000, gain: 4, volume: 1 })
		for (let note = 60; note < 80; note++) {
			node._onMidi({ bytes: [0x90, note, 127] })
		}
		expect(node.voices).toHaveLength(16)
		const audio = render(node, 50)
		expect(audio.every((s) => Number.isFinite(s))).toBe(true)
		expect(rms(audio)).toBeGreaterThan(0)
	})
	it("honours channel sustain, pitch bend and channel-specific panic", () => {
		const node = processor()
		node._onMidi({ bytes: [0x91, 60, 127] })
		node._onMidi({ bytes: [0x92, 60, 127] })
		node._onMidi({ bytes: [0xb1, 64, 127] })
		node._onMidi({ bytes: [0x81, 60, 0] })
		expect(node.voices[0].released).toBe(false)
		node._onMidi({ bytes: [0xe1, 127, 127] })
		expect(node.bend[1]).toBeGreaterThan(1.99)
		node._onMidi({ bytes: [0xb1, 64, 0] })
		expect(node.voices[0].released).toBe(true)
		node._onMidi({ bytes: [0xb1, 120, 0] })
		expect(node.voices.map((v: any) => v.channel)).toEqual([2])
	})
	it("only writes the samples in the WAM event slice", () => {
		const node = processor()
		const channel = new Float32Array(128).fill(0.5)
		node._process(16, 32, [], [[channel]])
		expect(channel[15]).toBe(0.5)
		expect(channel[16]).toBe(0)
		expect(channel[31]).toBe(0)
		expect(channel[32]).toBe(0.5)
	})
})

describe("Fontana Moog VCF equations", () => {
	it("matches paper equations (8), (5) and (4) with nonzero stored filter states", () => {
		const node = processor(48000)
		node._filterCoefficients(1000)
		const state = { s1: 0.1, s2: -0.2, s3: 0.3, s4: -0.4 }
		const b = node.b0 ** 4
		const s = node.b0 ** 3 * state.s1 + node.b0 ** 2 * state.s2 + node.b0 * state.s3 + state.s4
		const y = (b * 0.7 + s) / (1 + b * 3)
		expect(node._filterSample(0.7, state, node.b0, node.a1, 3)).toBeCloseTo(y, 14)
	})
	// Independent direct-form transfer function, not the worklet's state update:
	// H(z) = b0^4(1+z^-1)^4 / [(1+a1*z^-1)^4 + k*b0^4(1+z^-1)^4].
	it.each([22050, 44100, 48000, 96000])(
		"matches the closed-loop transfer function sample by sample at %i Hz",
		(rate) => {
			const node = processor(rate)
			const binomial = [1, 4, 6, 4, 1]
			for (const cutoff of [
				1000,
				Math.min(10000, rate * 0.48),
				Math.min(20000, rate * 0.49)
			]) {
				const g = Math.tan((Math.PI * cutoff) / rate)
				const a1 = (g - 1) / (g + 1)
				const b0 = g / (g + 1)
				node._filterCoefficients(cutoff)
				expect(node.b0).toBeCloseTo(b0, 14)
				expect(node.a1).toBeCloseTo(a1, 14)
				for (const k of [0, 1, 2, 3.8]) {
					const numerator = binomial.map((c) => c * b0 ** 4)
					const denominator = binomial.map((c, j) => c * a1 ** j + k * numerator[j])
					const inputs: number[] = []
					const expected: number[] = []
					const state = { s1: 0, s2: 0, s3: 0, s4: 0 }
					let maximumError = 0
					for (let n = 0; n < 4096; n++) {
						inputs.push(n === 0 ? 1 : 0.1 * Math.sin(n * 0.731))
						let y = numerator[0] * inputs[n]
						for (let j = 1; j <= Math.min(4, n); j++) {
							y += numerator[j] * inputs[n - j] - denominator[j] * expected[n - j]
						}
						y /= denominator[0]
						expected.push(y)
						const actual = node._filterSample(inputs[n], state, node.b0, node.a1, k)
						maximumError = Math.max(maximumError, Math.abs(actual - y))
					}
					expect(maximumError).toBeLessThan(1e-7)
				}
			}
		}
	)
	it.each([0, 1, 2, 3])(
		"preserves DC gain 1/(1+k) and the resonant cutoff response for k=%i",
		(k) => {
			const rate = 48000,
				cutoff = 1000
			const node = processor(rate)
			node._filterCoefficients(cutoff)
			const dc = { s1: 0, s2: 0, s3: 0, s4: 0 }
			const impulse = { ...dc }
			let constant = 0,
				real = 0,
				imaginary = 0
			for (let n = 0; n < 32768; n++) {
				constant = node._filterSample(1, dc, node.b0, node.a1, k)
				const response = node._filterSample(n === 0 ? 1 : 0, impulse, node.b0, node.a1, k)
				const angle = (2 * Math.PI * cutoff * n) / rate
				real += response * Math.cos(angle)
				imaginary -= response * Math.sin(angle)
			}
			expect(constant).toBeCloseTo(1 / (1 + k), 10)
			expect(real).toBeCloseTo(-1 / (4 - k), 10)
			expect(imaginary).toBeCloseTo(0, 10)
		}
	)
	it("does not add output saturation to the linear model", () => {
		const quiet = processor(48000, { volume: 0.1 })
		const loud = processor(48000, { volume: 1 })
		quiet._onMidi({ bytes: [0x90, 60, 127] })
		loud._onMidi({ bytes: [0x90, 60, 127] })
		const a = render(quiet, 10),
			b = render(loud, 10)
		const scale =
			loud._parameterInterpolators.volume.values[0] /
			quiet._parameterInterpolators.volume.values[0]
		expect(Math.max(...b.map((value, i) => Math.abs(value - a[i] * scale)))).toBeLessThan(1e-7)
	})
})

describe("Moog sound controls", () => {
	it.each([22050, 48000, 96000])("keeps all new modulation paths finite at %i Hz", (rate) => {
		const node = processor(rate, {
			filterAmount: 6,
			keyTracking: 1,
			filterAttack: 0.001,
			lfoRate: 20,
			lfoPitch: 2,
			lfoFilter: 4,
			lfoAmp: 1,
			oscillatorMix: 0.5,
			noise: 1,
			sub: 1,
			detune: 50,
			octave: 4,
			octave2: 0,
			gain: 3,
			glide: 0.1
		})
		for (const note of [36, 60, 72, 96]) {
			node._onMidi({ bytes: [0x90, note, 127] })
		}
		expect(render(node, 120).every(Number.isFinite)).toBe(true)
		for (const note of [36, 60, 72, 96]) {
			node._onMidi({ bytes: [0x80, note, 0] })
		}
		expect(render(node, 160).every(Number.isFinite)).toBe(true)
		expect(node.voices).toHaveLength(0)
	})
	it("advances ADSR through attack, decay, sustain and release from the current level", () => {
		const node = processor(1000)
		const env = { value: 0, stage: 0, releaseStart: 0 }
		for (let i = 0; i < 10; i++) {
			node._advanceEnvelope(env, false, 0.01, 0.02, 0.4, 0.01)
		}
		expect(env.value).toBeCloseTo(1)
		for (let i = 0; i < 21; i++) {
			node._advanceEnvelope(env, false, 0.01, 0.02, 0.4, 0.01)
		}
		expect(env.value).toBeCloseTo(0.4)
		expect(env.stage).toBe(2)
		for (let i = 0; i < 5; i++) {
			node._advanceEnvelope(env, true, 0.01, 0.02, 0.4, 0.01)
		}
		expect(env.value).toBeCloseTo(0.2)
		for (let i = 0; i < 6; i++) {
			node._advanceEnvelope(env, true, 0.01, 0.02, 0.4, 0.01)
		}
		expect(env.value).toBe(0)
	})
	it("modulates cutoff with the filter envelope and keyboard tracking", () => {
		const node = processor(48000, {
			frequency: 500,
			filterAmount: 2,
			filterAttack: 0.001,
			filterDecay: 0.005,
			filterSustain: 0.25,
			keyTracking: 1
		})
		node._onMidi({ bytes: [0x90, 72, 100] })
		render(node, 5)
		expect(node.voices[0].filter.value).toBeCloseTo(0.25)
		expect(node.voices[0].filterCutoff).toBeCloseTo(500 * 2 ** 1.5)
		node._onMidi({ bytes: [0x80, 72, 0] })
		render(node)
		expect(node.voices[0].filter.value).toBeLessThan(0.25)
	})
	it("mixes a separately tuned second oscillator and adds sub and noise signals", () => {
		const sound = (params: Record<string, number>) => {
			const node = processor(48000, { waveform: 3, frequency: 18000, gain: 0, ...params })
			node._onMidi({ bytes: [0x90, 69, 127] })
			render(node, 10)
			return render(node, 40)
		}
		const original = sound({})
		const second = sound({ oscillatorMix: 1, waveform2: 3, octave2: 1, detune: 0 })
		const energy = (samples: number[], hz: number) => {
			let re = 0,
				im = 0
			samples.forEach((x, i) => {
				re += x * Math.cos((2 * Math.PI * hz * i) / 48000)
				im += x * Math.sin((2 * Math.PI * hz * i) / 48000)
			})
			return Math.hypot(re, im)
		}
		expect(energy(original, 440)).toBeGreaterThan(energy(original, 220) * 10)
		expect(energy(second, 220)).toBeGreaterThan(energy(second, 440) * 10)
		const sub = sound({ sub: 1 })
		expect(energy(sub, 220)).toBeGreaterThan(energy(original, 220) * 10)
		expect(sound({ noise: 1 })).not.toEqual(original)
		expect(sound({ oscillatorMix: 0.5, detune: 25 })).not.toEqual(original)
	})
	it("applies LFO cutoff, pitch and volume depths, with zero depths neutral", () => {
		const node = processor(48000, { lfoFilter: 1, frequency: 1000, lfoRate: 5 })
		node._onMidi({ bytes: [0x90, 60, 127] })
		const cutoffs: number[] = []
		const coefficients = node._filterCoefficients.bind(node)
		node._filterCoefficients = (frequency: number, state: any) => {
			cutoffs.push(frequency)
			coefficients(frequency, state)
		}
		render(node, 100)
		expect(Math.min(...cutoffs)).toBeCloseTo(500, 2)
		expect(Math.max(...cutoffs)).toBeCloseTo(2000, 2)
		const plain = processor(),
			vibrato = processor(48000, { lfoPitch: 2 })
		plain._onMidi({ bytes: [0x90, 60, 127] })
		vibrato._onMidi({ bytes: [0x90, 60, 127] })
		expect(render(vibrato, 10)).not.toEqual(render(plain, 10))
		const tremolo = processor(48000, { lfoAmp: 1 })
		tremolo._onMidi({ bytes: [0x90, 60, 127] })
		render(tremolo, 10)
		tremolo.lfoPhase = 0.75
		const channel = new Float32Array(128)
		tremolo._process(0, 1, [], [[channel]])
		expect(channel[0]).toBe(0)
	})
	it("keeps one legato voice, glides to the newest key and returns to a held key", () => {
		const node = processor(48000, { voiceMode: 2, glide: 0.2, release: 0.005 })
		node._onMidi({ bytes: [0x90, 60, 100] })
		render(node, 10)
		const voice = node.voices[0]
		const amplitude = voice.amp.value
		node._onMidi({ bytes: [0x90, 72, 100] })
		expect(node.voices).toEqual([voice])
		expect(voice.amp.value).toBe(amplitude)
		render(node)
		expect(voice.pitch).toBeGreaterThan(60)
		expect(voice.pitch).toBeLessThan(72)
		node._onMidi({ bytes: [0x80, 72, 0] })
		expect(voice.note).toBe(60)
		expect(voice.released).toBe(false)
		node._onMidi({ bytes: [0x80, 60, 0] })
		render(node, 4)
		expect(node.voices).toHaveLength(0)
	})
	it("retriggers mono envelopes and honours sustain across voice-mode changes", () => {
		const node = processor(48000, { voiceMode: 1 })
		node._onMidi({ bytes: [0x90, 60, 100] })
		render(node, 10)
		node._onMidi({ bytes: [0x90, 60, 100] })
		expect(node.voices[0].amp.value).toBe(0)
		node._onMidi({ bytes: [0xb0, 64, 127] })
		node._onMidi({ bytes: [0x80, 60, 0] })
		expect(node.voices[0].released).toBe(false)
		node._parameterInterpolators.voiceMode.values.fill(0)
		render(node)
		expect(node.voices[0].held).toBe(false)
		node._onMidi({ bytes: [0xb0, 64, 0] })
		expect(node.voices[0].released).toBe(true)
		node._onMidi({ bytes: [0xb0, 120, 0] })
		expect(node.voices).toHaveLength(0)
		expect(node.heldNotes).toHaveLength(0)
	})
})

describe("Moog GUI and output", () => {
	it("initializes the synth when its controls are mounted and resumes suspended audio", async () => {
		vi.stubGlobal("AudioWorklet", class {})
		const gain = { connect: vi.fn(), disconnect: vi.fn() }
		const context = {
			state: "suspended",
			resume: vi.fn(async () => {
				context.state = "running"
			}),
			createGain: () => gain,
			currentTime: 3,
			destination: {}
		}
		const output = await createOutputById("moog", { audioContext: context })
		const audioNode = {
			connect: vi.fn(),
			disconnect: vi.fn(),
			destroy: vi.fn(),
			scheduleEvents: vi.fn()
		}
		const createGui = vi.fn(async () => document.createElement("section"))
		const createPlugin = vi
			.spyOn(output as any, "createPlugin")
			.mockResolvedValue({ audioNode, createGui, descriptor: { name: "Moog" } })
		const gui = await output.createGui!()
		expect(context.resume).toHaveBeenCalledOnce()
		expect(output.isConnected).toBe(true)
		expect(createGui).toHaveBeenCalledOnce()
		expect(gui.querySelector("section")).not.toBeNull()
		expect(gui.querySelector('input[type="url"]')).toBeNull()
		expect(gui.querySelector('input[type="search"], select, button')).toBeNull()
		expect(output.requiresConnectionControl).toBe(false)
		await output.connect!()
		expect(createPlugin).toHaveBeenCalledOnce()
		await output.disconnect!()
		await output.destroyGui!()
	})
	it("schedules automation, reflects host changes and cleans up GUI listeners", async () => {
		const node = Object.assign(new EventTarget(), {
			context: { currentTime: 2 },
			getParameterValues: async () => ({}),
			scheduleEvents: vi.fn()
		})
		const remove = vi.spyOn(node, "removeEventListener")
		const gui = await createMoogGui(node)
		expect(gui.shadowRoot!.querySelectorAll("fieldset")).toHaveLength(6)
		expect(gui.shadowRoot!.querySelectorAll("input, select")).toHaveLength(
			Object.keys(MOOG_PARAMETERS).length
		)
		expect(Object.values(MOOG_CONTROL_GROUPS).flat().sort()).toEqual(
			Object.keys(MOOG_PARAMETERS).sort()
		)
		const cutoff = gui.shadowRoot!.querySelector<HTMLInputElement>('[aria-label="Cutoff"]')!
		cutoff.value = "1"
		cutoff.dispatchEvent(new Event("input"))
		expect(node.scheduleEvents).toHaveBeenCalledWith({
			type: WAM_AUTOMATION_EVENT,
			time: 2,
			data: { id: "frequency", value: 20000, normalized: false }
		})
		node.dispatchEvent(
			new CustomEvent(WAM_AUTOMATION_EVENT, {
				detail: { data: { id: "frequency", value: 20 } }
			})
		)
		expect(cutoff.value).toBe("0")
		node.dispatchEvent(
			new CustomEvent(WAM_AUTOMATION_EVENT, {
				detail: { data: { id: "frequency", value: 1, normalized: true } }
			})
		)
		expect(cutoff.value).toBe("1")
		gui.shadowRoot!.querySelector("button")!.click()
		expect(node.scheduleEvents).toHaveBeenCalledWith({
			type: WAM_MIDI_EVENT,
			time: 2,
			data: { bytes: [0xbf, 120, 0] }
		})
		destroyMoogGui(gui)
		expect(remove).toHaveBeenCalledWith(WAM_AUTOMATION_EVENT, expect.any(Function))
	})
	it("creates an output routed to the mixer and forwards MIDI through the WAM node", async () => {
		vi.stubGlobal("AudioWorklet", class {})
		const gain = { connect: vi.fn(), disconnect: vi.fn() }
		const mixer = {} as AudioNode
		const context = {
			createGain: () => gain,
			currentTime: 3,
			destination: {}
		} as unknown as AudioContext
		const output = await createOutputById("moog", { audioContext: context, mixer })
		const audioNode = {
			connect: vi.fn(),
			disconnect: vi.fn(),
			destroy: vi.fn(),
			scheduleEvents: vi.fn()
		}
		vi.spyOn(output as any, "createPlugin").mockResolvedValue({
			audioNode,
			descriptor: { name: "Moog" }
		})
		await output.connect!()
		expect(gain.connect).toHaveBeenCalledWith(mixer)
		output.noteOn(60, 100)
		expect(audioNode.scheduleEvents).toHaveBeenCalledWith({
			type: WAM_MIDI_EVENT,
			time: 3,
			data: { bytes: [0x90, 60, 100] }
		})
		await output.disconnect!()
		expect(audioNode.destroy).toHaveBeenCalledOnce()
	})
})