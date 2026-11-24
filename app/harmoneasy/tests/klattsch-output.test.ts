import { afterEach, expect, it, vi } from "vitest"
import { compileString, FormantSynth } from "klattsch"
import OutputKlattsch from "../source/libs/output-klattsch"
import workletSource from "../source/libs/klattsch.worklet.js?raw"

afterEach(() => vi.unstubAllGlobals())

function setup() {
	const nodes: any[] = []
	const gain = () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() })
	const context = {
		createGain: gain,
		destination: {},
		audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) }
	}
	vi.stubGlobal(
		"AudioWorkletNode",
		class {
			port = { postMessage: vi.fn(), close: vi.fn(), onmessage: null }
			connect = vi.fn()
			disconnect = vi.fn()
			constructor(
				_context: unknown,
				public name: string,
				public options: any
			) {
				nodes.push(this)
			}
		}
	)
	return { context: context as unknown as AudioContext, nodes }
}

it("plays independent MIDI pitches and velocities, retriggers and releases without leaving voices running", async () => {
	const { context, nodes } = setup()
	const output = new OutputKlattsch({ audioContext: context })
	await output.connect()
	output.noteOn(69, 127)
	output.noteOn(72, 64)
	expect(nodes).toHaveLength(2)
	expect(nodes[0].options.processorOptions.voices).toEqual(
		compileString("HH AH L OW", { baseF0: 440 }).voices
	)
	expect(nodes[1].connect.mock.calls[0][0].gain.value).toBeCloseTo(64 / 127)
	output.noteOn(69, 100)
	expect(nodes[0].disconnect).toHaveBeenCalledOnce()
	expect(nodes[1].disconnect).not.toHaveBeenCalled()
	output.noteOn(72, 0)
	expect(nodes[1].port.postMessage).toHaveBeenCalledWith("stop")
	output.allNotesOff()
	expect(nodes[2].port.close).toHaveBeenCalledOnce()
	output.destroy()
})

it("uses the live GUI settings and banks for auditioning, and cleans up completed speech", async () => {
	const { context, nodes } = setup()
	const output = new OutputKlattsch({ audioContext: context, rate: 200, volume: 0.5 })
	await output.connect()
	output.setControlValue("phonemes", "AA [voice=1] IY")
	output.setControlValue("speak", 1)
	expect(nodes[0].options.numberOfOutputs).toBe(2)
	expect(output.output.gain.value).toBe(0.5)
	const onEnded = nodes[0].port.onmessage
	output.setControlValue("speak", 1)
	onEnded()
	expect(nodes[1].disconnect).not.toHaveBeenCalled()
	nodes[1].port.onmessage()
	expect(nodes[1].disconnect).toHaveBeenCalledOnce()
	output.setControlValue("bank", "ja-mokhtari-2000")
	expect(output.getUiDescriptor().controls.some((control) => control.id === "audition:A")).toBe(
		true
	)
	expect(output.options.phonemes).toBe("AA [voice=1] IY")
	output.setControlValue("rate", Number.NaN)
	expect(output.getControlValue("rate")).toBe(200)
	await output.disconnect()
	output.noteOn(60, 100)
	expect(nodes).toHaveLength(2)
	output.destroy()
})

it("shares module loading per context and permits retry after a failed load", async () => {
	const { context } = setup()
	const addModule = vi.mocked(context.audioWorklet.addModule)
	addModule.mockRejectedValueOnce(new Error("load failed"))
	const first = new OutputKlattsch({ audioContext: context })
	await expect(first.connect()).rejects.toThrow("load failed")
	await first.connect()
	const second = new OutputKlattsch({ audioContext: context })
	await second.connect()
	expect(addModule).toHaveBeenCalledTimes(2)
	first.destroy()
	second.destroy()
})

it("renders real formant audio in the worklet and terminates on completion or stop", () => {
	let Processor: any
	class BaseProcessor {
		port = { postMessage: vi.fn(), onmessage: null as unknown }
	}
	new Function(
		"FormantSynth",
		"AudioWorkletProcessor",
		"registerProcessor",
		"sampleRate",
		workletSource.replace(/^import[^\n]*\n/, "")
	)(
		FormantSynth,
		BaseProcessor,
		(_name: string, implementation: any) => {
			Processor = implementation
		},
		48000
	)
	const compiled = compileString("HH AH L OW")
	const processor = new Processor({ processorOptions: compiled })
	const samples = new Float32Array(128)
	let peak = 0
	let running = true
	for (let block = 0; running && block < 1000; block++) {
		running = processor.process([], [[samples]])
		for (const sample of samples) {
			expect(Number.isFinite(sample)).toBe(true)
			peak = Math.max(peak, Math.abs(sample))
		}
	}
	expect(peak).toBeGreaterThan(0.01)
	expect(running).toBe(false)
	expect(processor.port.postMessage).toHaveBeenCalledWith("ended")
	const stopped = new Processor({ processorOptions: compiled })
	stopped.port.onmessage()
	expect(stopped.process([], [[samples]])).toBe(false)
})