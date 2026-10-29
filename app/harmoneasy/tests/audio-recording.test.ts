// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import { AudioRecording } from "../source/services/audio-recording"
import {
	encodeSamples,
	waveHeader,
	RECORDING_DATA,
	RECORDING_START,
	RECORDING_STOP
} from "../source/services/recording-format"
import {
	getAudioDestination,
	setAudioDestination
} from "../../../packages/audiobus/audio-destination"
import OutputMetronome from "../../../packages/audiobus/io/outputs/output-metronome"

afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

it("includes direct outputs in the final recording mix without adding instrument effects", () => {
	const gain = { gain: { value: 1 }, connect: vi.fn() }
	const context = { destination: {}, createGain: () => gain } as unknown as AudioContext
	expect(getAudioDestination(context)).toBe(context.destination)
	const finalMix = {} as AudioNode
	setAudioDestination(context, finalMix)
	new OutputMetronome(context)
	expect(gain.connect).toHaveBeenCalledWith(finalMix)
	expect(gain.gain.value).toBe(0.3)
})

it("exports stereo PCM with correct duration, sizes and clipping", () => {
	const samples = encodeSamples(new Float32Array([-2, 2, -0.5, 0.5, NaN, Infinity]), 16)
	const view = new DataView(samples.buffer)
	expect([0, 2, 4, 6, 8, 10].map((offset) => view.getInt16(offset, true))).toEqual([
		-32768, 32767, -16384, 16384, 0, 0
	])
	const header = waveHeader(samples.length, 48000, 16)
	const fields = new DataView(header.buffer)
	expect(new TextDecoder().decode(header.subarray(0, 4))).toBe("RIFF")
	expect(fields.getUint32(4, true)).toBe(84)
	expect(fields.getUint16(56, true)).toBe(1)
	expect(fields.getUint32(64, true)).toBe(192000)
	expect(fields.getUint32(76, true)).toBe(12)
})

it("keeps original float samples and upgrades long files to RF64", () => {
	const encoded = encodeSamples(new Float32Array([1.5, -0.25]), 32)
	expect(new DataView(encoded.buffer).getFloat32(0, true)).toBe(1.5)
	const bytes = 2 ** 33
	const header = waveHeader(bytes, 48000, 32)
	const view = new DataView(header.buffer)
	expect(new TextDecoder().decode(header.subarray(0, 4))).toBe("RF64")
	expect(new TextDecoder().decode(header.subarray(12, 16))).toBe("ds64")
	expect(view.getBigUint64(28, true)).toBe(BigInt(bytes))
	expect(view.getBigUint64(36, true)).toBe(BigInt(bytes / 8))
	expect(view.getUint16(56, true)).toBe(3)
	expect(new TextDecoder().decode(header.subarray(72, 76))).toBe("fact")
})

function capture() {
	vi.stubGlobal("Worker", undefined)
	let node: any
	class FakeNode {
		port = {
			onmessage: undefined as any,
			postMessage: vi.fn((type: string) => {
				if (type === RECORDING_STOP) {
					queueMicrotask(() => this.port.onmessage({ data: { type: RECORDING_STOP } }))
				}
			}),
			close: vi.fn()
		}
		connect = vi.fn()
		disconnect = vi.fn()
		constructor() {
			node = this
		}
	}
	vi.stubGlobal("AudioWorkletNode", FakeNode)
	const context = {
		sampleRate: 48000,
		resume: vi.fn().mockResolvedValue(undefined),
		audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
		destination: {}
	}
	const source = { connect: vi.fn(), disconnect: vi.fn() }
	const recording = new AudioRecording(context as any, source as any)
	return {
		recording,
		context,
		source,
		node: () => node,
		append: (values: Float32Array) =>
			node.port.onmessage({ data: { type: RECORDING_DATA, samples: values } })
	}
}

it("records, flushes the final batch and replaces rather than appends the next take", async () => {
	const { recording, node, append, source } = capture()
	await recording.start()
	expect(recording.state).toBe("recording")
	expect(node().port.postMessage).toHaveBeenCalledWith(RECORDING_START)
	append(new Float32Array([0.25, -0.25, 0.5, -0.5]))
	const stop = recording.stop()
	append(new Float32Array([1, -1]))
	await stop
	expect(recording.frames).toBe(3)
	expect(source.disconnect).toHaveBeenCalled()
	const wave = await recording.wave(16)
	expect(wave.size).toBe(92)
	await recording.start()
	expect(recording.hasTake).toBe(false)
	append(new Float32Array([0.5, 0.5]))
	await recording.stop()
	expect(recording.frames).toBe(1)
	expect((await recording.wave(32)).size).toBe(100)
})

it("retains a take if starting the replacement fails before capture is ready", async () => {
	const { recording, context, append } = capture()
	await recording.start()
	append(new Float32Array([0.5, -0.5]))
	await recording.stop()
	context.resume.mockRejectedValueOnce(new Error("Audio device unavailable"))
	await recording.start()
	expect(recording.state).toBe("idle")
	expect(recording.frames).toBe(1)
	expect(recording.error).toContain("Audio device unavailable")
})

it("stops safely at the memory limit and preserves the accepted audio", async () => {
	const { recording, append } = capture()
	await recording.start()
	const batch = new Float32Array(1024 * 1024)
	for (let i = 0; i < 17; i++) {
		append(batch)
	}
	await recording.stop()
	expect(recording.state).toBe("idle")
	expect(recording.frames * 8).toBe(64 * 1024 * 1024)
	expect(recording.error).toContain("Memory recording limit")
})