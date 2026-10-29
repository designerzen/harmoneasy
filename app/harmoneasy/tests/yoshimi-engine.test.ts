// @vitest-environment node
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { createContext, runInContext } from "node:vm"
import { expect, it } from "vitest"

const root = new URL("../../../packages/audiobus/wam/yoshimi/", import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root))

it("renders different patches on two MIDI channels in one multipart engine", () => {
	let Processor: any
	const scope = createContext({
		AudioWorkletGlobalScope: { sampleRate: 48000 },
		sampleRate: 48000,
		console,
		WebAssembly,
		TextDecoder,
		TextEncoder,
		AudioWorkletProcessor: class {
			port = { start() {}, postMessage() {}, onmessage: null }
		},
		registerProcessor: (_name: string, processor: any) => {
			Processor = processor
		}
	})
	runInContext(read("libs/wam-processor.js").toString(), scope)
	runInContext(read("worklet/yoshimi-awp.js").toString(), scope)
	const processor = new Processor({
		numberOfInputs: 0,
		numberOfOutputs: 1,
		outputChannelCount: [2],
		processorOptions: {
			wasm: Uint8Array.from(read("worklet/yoshimi.wasm")).buffer,
			js: read("worklet/yoshimi.js").toString()
		}
	})
	const banks = JSON.parse(read("banks/root.json").toString())
	for (const [part, name] of ["SynthPiano", "Organ"].entries()) {
		const bank = banks.find((bank: any) => bank.name === name)
		const bytes = read(`banks/${name}/${bank.instruments[0]}`)
		const xml = (bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes).toString()
		processor.onmsg("set", `patch${part}`, xml)
	}
	const render = () => {
		let energy = 0
		for (let block = 0; block < 100; block++) {
			const outputs = [[new Float32Array(128), new Float32Array(128)]]
			processor.process([], outputs, {})
			for (const sample of outputs[0][0]) {
				expect(Number.isFinite(sample)).toBe(true)
				energy += sample * sample
			}
		}
		return energy
	}
	// Start part 1 first: a bridge hardcoded to part 0 would remain silent.
	processor.onmidi(0x91, 67, 100)
	const organ = render()
	expect(organ).toBeGreaterThan(0.001)
	processor.onmidi(0x90, 60, 100)
	expect(render()).toBeGreaterThan(0.001)
	processor.onmidi(0x80, 60, 0)
	expect(render()).toBeGreaterThan(0.001)
	processor.wam_terminate(processor.inst)
})