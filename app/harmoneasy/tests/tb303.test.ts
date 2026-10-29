// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import register303 from "../../../packages/audiobus/instruments/303/processor.js"
import { SYNTH_303_PARAMETERS } from "../../../packages/audiobus/instruments/303/parameters"
import registerTB303Processor from "../../../packages/audiobus/wam/tb303/processor.js"
import { TB303_ID, TB303_PARAMETERS } from "../../../packages/audiobus/wam/tb303/parameters"
import { createTB303Gui, destroyTB303Gui } from "../../../packages/audiobus/wam/tb303/gui"
import { WAM_AUTOMATION_EVENT, WAM_MIDI_EVENT } from "../../../packages/audiobus/wam/host"
import { restoreDevice } from "../../../packages/audiobus/io/workspace-devices"
import { createContextSetup, START_CONTEXTS } from "../source/services/start-contexts"

afterEach(() => vi.unstubAllGlobals())

const bytes = readFileSync("../../packages/audiobus/instruments/303/wavetable.bin")
const wavetable = new Float32Array(
	bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
)
function processor(rate = 48000, patch: Record<string, number> = {}, legacy = false) {
	let Processor: any
	vi.stubGlobal("sampleRate", rate)
	class Base {
		port = {}
		process(inputs: unknown[], outputs: Float32Array[][], _parameters: object) {
			;(this as any)._process(0, outputs[0][0].length, inputs, outputs)
			return true
		}
	}
	vi.stubGlobal("AudioWorkletProcessor", Base)
	vi.stubGlobal("webAudioModules", {
		getModuleScope: () => ({
			WamProcessor: Base,
			WamParameterInfo: class {
				constructor(id: string, config: object) {
					Object.assign(this, { id }, config)
				}
			}
		})
	})
	vi.stubGlobal("registerProcessor", (_id: string, ctor: any) => {
		Processor = ctor
	})
	if (legacy) {
		new Function(`return (${register303.toString()})`)()(SYNTH_303_PARAMETERS)
	} else {
		new Function(
			`(${registerTB303Processor.toString()})(...arguments, (${register303.toString()}))`
		)(TB303_ID, TB303_PARAMETERS)
	}
	const node = new Processor({ processorOptions: { wavetable } })
	const parameters = Object.fromEntries(
		Object.entries(TB303_PARAMETERS).map(([id, config]) => [
			id,
			new Float32Array(128).fill(patch[id] ?? config.defaultValue)
		])
	)
	node._parameterInterpolators = Object.fromEntries(
		Object.entries(parameters).map(([id, values]) => [id, { values }])
	)
	Object.assign(node.controls ?? {}, patch)
	const render = (frames = 4096) => {
		const audio = new Float32Array(frames)
		for (let offset = 0; offset < frames; offset += 128) {
			const size = Math.min(128, frames - offset)
			const channels = [new Float32Array(size), new Float32Array(size)]
			if (legacy) {
				const converted = Object.fromEntries(
					Object.entries(parameters).map(([id, values]) => [
						id,
						new Float32Array([
							values[0] * (id === "tuning" ? 0.01 : id === "decay" ? 1000 : 1)
						])
					])
				)
				node.process([], [channels], converted)
			} else {
				expect(node.process([], [channels], {})).toBe(true)
			}
			expect(channels[0]).toEqual(channels[1])
			audio.set(channels[0], offset)
		}
		return audio
	}
	// Prime controls just as the worklet does before receiving MIDI.
	render(128)
	return {
		node,
		render,
		parameters,
		midi: (...bytes: number[]) => (legacy ? node.midi(bytes) : node._onMidi({ bytes }))
	}
}
const rms = (audio: Float32Array) =>
	Math.sqrt(audio.reduce((sum, s) => sum + s * s, 0) / audio.length)

describe("TB-303 shared sound engine", () => {
	it.each([22050, 44100, 48000, 96000])(
		"matches 303 oscillators, resonance, envelopes, slide, foldback and delay at %i Hz",
		(rate) => {
			for (const waveform of [0, 1]) {
				const patch = {
					waveform,
					cutoff: 1800,
					resonance: 0.9,
					envMod: 0.8,
					tuning: 125,
					decay: 0.7,
					accent: 0.8,
					shape: 0.8,
					threshold: 0.7,
					delaySend: 0.5,
					delayFeedback: 0.6,
					delayTime: 0.01
				}
				const a = processor(rate, patch),
					b = processor(rate, patch, true)
				for (const bytes of [
					[0x90, 36, 80],
					[0x91, 60, 127],
					[0x81, 60, 0],
					[0x80, 36, 0]
				]) {
					a.midi(...bytes)
					b.midi(...bytes)
					const audio = a.render()
					const reference = b.render()
					// Unit conversion passes through Float32 WAM parameter buffers.
					expect(
						Math.max(...audio.map((sample, i) => Math.abs(sample - reference[i])))
					).toBeLessThan(1e-6)
					expect(audio.every((s) => Number.isFinite(s) && Math.abs(s) <= 1)).toBe(true)
					expect(rms(audio)).toBeGreaterThan(0.001)
				}
			}
		}
	)
	it("uses binary accent, channel-aware last-note priority, sustain, bend and controller reset", () => {
		const a = processor(),
			b = processor()
		a.midi(0x90, 45, 30)
		b.midi(0x90, 45, 99)
		expect(a.render()).toEqual(b.render())
		a.midi(0x91, 60, 127)
		a.render(128)
		expect(a.node.engine.accentgain).toBeCloseTo(0.65)
		a.midi(0xb1, 64, 127)
		a.midi(0x81, 60, 0)
		expect(a.node.active.number).toBe(60)
		a.midi(0xe1, 127, 127)
		expect(a.node.bends[1]).toBeGreaterThan(1.99)
		a.midi(0xb1, 121, 0)
		expect(a.node.active.number).toBe(45)
		a.midi(0x80, 45, 0)
		expect(a.node.active).toBeNull()
	})
	it("clears filter and delay tails on All Sound Off after note release", () => {
		const a = processor(48000, { delaySend: 0.8, delayTime: 0.01, delayFeedback: 0.8 })
		a.midi(0x91, 48, 127)
		a.render()
		a.midi(0x81, 48, 0)
		expect(rms(a.render(1024))).toBeGreaterThan(0.001)
		a.midi(0xb1, 120, 0)
		expect(rms(a.render())).toBeLessThan(1e-12)
	})
	it("preserves WAM event offsets, automation ramps and saved tuning/decay units", () => {
		const a = processor()
		a.midi(0x90, 48, 100)
		const channel = new Float32Array(128).fill(0.5)
		a.parameters.cutoff.forEach((_, i, values) => {
			values[i] = 450 + i * 20
		})
		a.node._process(16, 32, [], [[channel]])
		expect(channel[15]).toBe(0.5)
		expect(channel[32]).toBe(0.5)
		expect(a.node.engine.cutOff).toBe(450 + 31 * 20)
		expect(a.node.decay).toBe(500)
		a.parameters.tuning.fill(100)
		a.render(128)
		expect(a.node.engine.tuning).toBe(1)
		expect((a.node.engine.oscdelta * 48000) / 4096).toBeCloseTo(138.5913, 3)
	})
	it("renders audible short gates and releases to silence without delay", () => {
		const a = processor()
		a.midi(0x90, 45, 80)
		expect(rms(a.render(3000))).toBeGreaterThan(0.025)
		a.midi(0x80, 45, 0)
		a.render(48000)
		expect(rms(a.render())).toBeLessThan(1e-6)
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
		expect(root.querySelectorAll('input[type="range"]')).toHaveLength(12)
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