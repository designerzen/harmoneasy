import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	captureTrackerSamples,
	downmixToMono,
	findSustainLoop,
	groupTrackerNotes,
	normalisePeak,
	representativeTrackerNote,
	trimSilence
} from "audiobus/io/recording/capture-instrument-samples"
import { trackerInstrumentKey } from "audiobus/formats/tracker/tracker-types"
import type { SequenceNote } from "audiobus/formats/note-sequence"
import type { IAudioOutput } from "audiobus/io/outputs/output-interface"
import { NOTE_ON, NOTE_OFF } from "audiobus/commands/commands"
import {
	RECORDING_DATA,
	RECORDING_START,
	RECORDING_STOP
} from "audiobus/io/recording/recording-format"

const sampleRate = 44000
const pitch = 69
const period = 100
const note = (values: Partial<SequenceNote> = {}): SequenceNote => ({
	chainId: "synth",
	number: pitch,
	velocity: 90,
	channel: 3,
	patch: 17,
	start: 0,
	duration: 1,
	...values
})
const saw = (frames = sampleRate): Float32Array =>
	Float32Array.from({ length: frames }, (_, i) => ((i % period) / period - 0.5) * 0.8)
const stereo = (mono: Float32Array): Float32Array =>
	Float32Array.from({ length: mono.length * 2 }, (_, i) => mono[Math.floor(i / 2)])

afterEach(() => {
	vi.useRealTimers()
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

it("trims only leading and trailing silence at the supplied threshold", () => {
	const input = new Float32Array([0, 0.001, 0.25, 0, -0.5, -0.001, 0])
	expect(trimSilence(input)).toEqual(new Float32Array([0.25, 0, -0.5]))
	expect(trimSilence(input, 0.3)).toEqual(new Float32Array([-0.5]))
	expect(trimSilence(new Float32Array(10))).toHaveLength(0)
	expect(input).toHaveLength(7)
})

it("normalises without changing polarity, clipping, or mutating the input", () => {
	const input = new Float32Array([-0.25, 0.125, 0])
	const normalised = normalisePeak(input)
	expect(normalised[0]).toBeCloseTo(-0.95)
	expect(normalised[1]).toBeCloseTo(0.475)
	expect(normalised[2]).toBe(0)
	expect(normalisePeak(input, 2)[0]).toBe(-1)
	expect(normalisePeak(new Float32Array(10))).toEqual(new Float32Array(10))
	expect(input[0]).toBe(-0.25)
})

it("averages interleaved channels to mono", () => {
	expect(downmixToMono(new Float32Array([0.5, 0.25, -0.5, 0.5]))).toEqual(
		new Float32Array([0.375, 0])
	)
	expect(downmixToMono(new Float32Array([0.5, -0.5]), 1)).toEqual(new Float32Array([0.5, -0.5]))
	expect(() => downmixToMono(new Float32Array(), 0)).toThrow("channel count")
})

it("loops a sustained saw at rising zero crossings separated by whole periods", () => {
	const input = saw()
	const loop = findSustainLoop(input, sampleRate, pitch)!
	expect(loop).toBeDefined()
	const start = loop.loopStart!
	const end = start + loop.loopLength!
	expect(loop.loopLength! % period).toBe(0)
	expect(input[start - 1]).toBeLessThanOrEqual(0)
	expect(input[start]).toBeGreaterThan(0)
	expect(input[end - 1]).toBeLessThanOrEqual(0)
	expect(input[end]).toBeGreaterThan(0)
	expect(Math.abs(input[start] - input[end])).toBeLessThan(0.01)
})

it("does not loop a decaying sine, silence, or a sound too short to sustain", () => {
	const decay = Float32Array.from(
		{ length: sampleRate },
		(_, i) => Math.sin((i * 2 * Math.PI) / period) * Math.exp((-i / sampleRate) * 8)
	)
	expect(findSustainLoop(decay, sampleRate, pitch)).toBeUndefined()
	expect(findSustainLoop(new Float32Array(sampleRate), sampleRate, pitch)).toBeUndefined()
	expect(findSustainLoop(saw(100), sampleRate, pitch)).toBeUndefined()
})

it("groups instruments by chain, channel and patch and skips unassigned notes", () => {
	const notes = [
		note(),
		note({ number: 60 }),
		note({ chainId: "other" }),
		note({ channel: 4 }),
		note({ patch: 5 }),
		note({ chainId: undefined })
	]
	const groups = groupTrackerNotes(notes)
	expect(groups.size).toBe(4)
	expect(groups.get(trackerInstrumentKey(notes[0]))).toEqual(notes.slice(0, 2))
	expect(notes).toHaveLength(6)
})

it("selects the median recorded pitch and velocity without mutating notes", () => {
	const notes = [
		note({ number: 84, velocity: 120 }),
		note({ number: 60, velocity: 40 }),
		note({ number: 72, velocity: 80 })
	]
	expect(representativeTrackerNote(notes)).toMatchObject({
		number: 72,
		velocity: 80,
		channel: 3,
		patch: 17
	})
	expect(representativeTrackerNote([note({ number: 60 }), note({ number: 72 })]).number).toBe(60)
	expect(notes[0].number).toBe(84)
	expect(() => representativeTrackerNote([])).toThrow("empty")
})

function fixture(buffers: Float32Array[] = [stereo(saw())]) {
	const context = {
		sampleRate,
		currentTime: 0,
		destination: {},
		resume: vi.fn().mockResolvedValue(undefined),
		audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) }
	}
	class FakeTap {
		connect = vi.fn()
		disconnect = vi.fn()
		onprocessorerror: (() => void) | null = null
		port = {
			onmessage: null as
				| ((event: { data: { type: string; samples?: Float32Array } }) => void)
				| null,
			close: vi.fn(),
			postMessage: vi.fn((type: string) => {
				if (type === RECORDING_STOP) {
					queueMicrotask(() => {
						this.feed(buffers[this.index] ?? new Float32Array())
						this.port.onmessage?.({ data: { type: RECORDING_STOP } })
					})
				}
			})
		}
		index: number
		constructor() {
			this.index = taps.length
			taps.push(this)
		}
		feed(samples: Float32Array) {
			this.port.onmessage?.({ data: { type: RECORDING_DATA, samples } })
		}
	}
	const taps: FakeTap[] = []
	vi.stubGlobal("AudioWorkletNode", FakeTap)
	const source = { context, connect: vi.fn(), disconnect: vi.fn() }
	const output = {
		name: "Synthe\u0301tiseur with a long name",
		output: source,
		hasAudioOutput: () => true,
		sendCommand: vi.fn().mockResolvedValue(undefined),
		noteOn: vi.fn(),
		noteOff: vi.fn(),
		allNotesOff: vi.fn()
	}
	const restore = vi.fn()
	const mute = vi.fn(() => restore)
	const getChain = vi.fn(() => ({ outputs: [output as unknown as IAudioOutput] }))
	const options = {
		audioContext: context as unknown as AudioContext,
		notes: [note()],
		getChain,
		mute
	}
	return { context, source, output, taps, restore, mute, options }
}

describe("live instrument capture", () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.spyOn(console, "warn").mockImplementation(() => {})
	})

	it("captures the representative note, forwards channel and patch, and removes only its tap", async () => {
		const { options, source, context, taps, output, mute, restore } = fixture()
		const progress = vi.fn()
		const notes = [
			note({ number: 60, velocity: 60 }),
			note(),
			note({ number: 80, velocity: 120 })
		]
		const result = captureTrackerSamples({ ...options, notes, onProgress: progress })
		await vi.runAllTimersAsync()
		const samples = await result
		const sample = samples.get(trackerInstrumentKey(note()))!
		expect(samples.size).toBe(1)
		expect(sample.baseNote).toBe(pitch)
		expect(sample.sampleRate).toBe(sampleRate)
		expect(sample.loopLength).toBeGreaterThan(0)
		expect(sample.name).toMatch(/^[\x20-\x7e]{1,22}$/)
		expect(sample.name.endsWith(" 17")).toBe(true)
		expect(Math.max(...sample.data)).toBeCloseTo(0.95, 1)
		expect(output.sendCommand).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				type: NOTE_ON,
				number: pitch,
				velocity: 90,
				channel: 3,
				patch: 17
			})
		)
		expect(output.sendCommand).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ type: NOTE_OFF, number: pitch, channel: 3, patch: 17 })
		)
		expect(source.connect).toHaveBeenCalledWith(taps[0])
		expect(source.disconnect.mock.calls).toEqual([[taps[0]]])
		expect(taps[0].connect).toHaveBeenCalledWith(context.destination)
		expect(taps[0].disconnect).toHaveBeenCalledOnce()
		expect(taps[0].port.close).toHaveBeenCalledOnce()
		expect(output.allNotesOff).toHaveBeenCalledOnce()
		expect(mute).toHaveBeenCalledOnce()
		expect(restore).toHaveBeenCalledOnce()
		expect(progress).toHaveBeenCalledWith(1, 1)
		expect(vi.getTimerCount()).toBe(0)
	})

	it.each([0, 0.0001, 0.001])(
		"omits instruments at silence level %s and restores the audible mix",
		async (level) => {
			const { options, restore } = fixture([new Float32Array(10000).fill(level)])
			const result = captureTrackerSamples(options)
			await vi.runAllTimersAsync()
			expect((await result).size).toBe(0)
			expect(console.warn).toHaveBeenCalledWith(
				"Tracker sample omitted",
				expect.any(String),
				expect.objectContaining({ message: "Instrument capture was silent" })
			)
			expect(restore).toHaveBeenCalledOnce()
		}
	)

	it("captures groups sequentially, omitting failed groups and reporting each attempt", async () => {
		const { options, output, taps, mute, restore, context } = fixture([
			new Float32Array(100),
			stereo(saw())
		])
		const progress = vi.fn()
		const result = captureTrackerSamples({
			...options,
			notes: [note(), note({ patch: 18 })],
			onProgress: progress
		})
		await vi.advanceTimersByTimeAsync(0)
		expect(taps).toHaveLength(1)
		await vi.runAllTimersAsync()
		expect([...(await result).keys()]).toEqual([trackerInstrumentKey(note({ patch: 18 }))])
		expect(taps).toHaveLength(2)
		expect(output.allNotesOff).toHaveBeenCalledTimes(2)
		expect(progress.mock.calls).toEqual([
			[1, 2],
			[2, 2]
		])
		expect(context.audioWorklet.addModule).toHaveBeenCalledOnce()
		expect(mute).toHaveBeenCalledOnce()
		expect(restore).toHaveBeenCalledOnce()
	})

	it("aborts during hold, stops notes, disconnects the tap, and restores the mix", async () => {
		const { options, output, taps, source, restore } = fixture()
		const controller = new AbortController()
		const result = captureTrackerSamples({ ...options, signal: controller.signal })
		const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" })
		await vi.advanceTimersByTimeAsync(0)
		expect(output.sendCommand).toHaveBeenCalledWith(expect.objectContaining({ type: NOTE_ON }))
		controller.abort()
		await rejected
		expect(output.allNotesOff).toHaveBeenCalledOnce()
		expect(source.disconnect.mock.calls).toEqual([[taps[0]]])
		expect(taps[0].port.close).toHaveBeenCalledOnce()
		expect(restore).toHaveBeenCalledOnce()
		expect(vi.getTimerCount()).toBe(0)
	})

	it("rejects an already aborted operation without muting or loading the worklet", async () => {
		const { options, mute, context } = fixture()
		const controller = new AbortController()
		controller.abort()
		await expect(
			captureTrackerSamples({ ...options, signal: controller.signal })
		).rejects.toMatchObject({ name: "AbortError" })
		expect(mute).not.toHaveBeenCalled()
		expect(context.audioWorklet.addModule).not.toHaveBeenCalled()
	})

	it("omits unavailable captures and restores the mix if loading the worklet fails", async () => {
		const { options, context, restore } = fixture()
		context.audioWorklet.addModule.mockRejectedValueOnce(new Error("Worklet unavailable"))
		expect((await captureTrackerSamples(options)).size).toBe(0)
		expect(console.warn).toHaveBeenCalledWith(
			"Tracker sample omitted",
			expect.any(String),
			expect.objectContaining({ message: "Worklet unavailable" })
		)
		expect(restore).toHaveBeenCalledOnce()
	})

	it("aborts promptly while worklet loading is pending and restores the mix", async () => {
		const { options, context, restore } = fixture()
		context.audioWorklet.addModule.mockImplementation(() => new Promise(() => {}))
		const controller = new AbortController()
		const result = captureTrackerSamples({ ...options, signal: controller.signal })
		const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" })
		await vi.advanceTimersByTimeAsync(0)
		controller.abort()
		await rejected
		expect(restore).toHaveBeenCalledOnce()
	})

	it("omits failed commands, stops notes, and restores the mix", async () => {
		const { options, output, source, taps, restore } = fixture()
		output.sendCommand.mockRejectedValueOnce(new Error("Instrument unavailable"))
		expect((await captureTrackerSamples(options)).size).toBe(0)
		expect(output.allNotesOff).toHaveBeenCalledOnce()
		expect(source.disconnect).toHaveBeenCalledWith(taps[0])
		expect(restore).toHaveBeenCalledOnce()
	})

	it("cleans up and omits an instrument when its capture processor fails", async () => {
		const { options, taps, output, restore } = fixture()
		const result = captureTrackerSamples(options)
		await vi.advanceTimersByTimeAsync(0)
		taps[0].onprocessorerror?.()
		expect((await result).size).toBe(0)
		expect(output.allNotesOff).toHaveBeenCalledOnce()
		expect(taps[0].port.close).toHaveBeenCalledOnce()
		expect(restore).toHaveBeenCalledOnce()
	})

	it("falls back to noteOn and noteOff when an output has no command API", async () => {
		const { options, output } = fixture()
		Reflect.deleteProperty(output, "sendCommand")
		const result = captureTrackerSamples(options)
		await vi.runAllTimersAsync()
		expect((await result).size).toBe(1)
		expect(output.noteOn).toHaveBeenCalledWith(pitch, 90)
		expect(output.noteOff).toHaveBeenCalledWith(pitch)
	})

	it("skips missing chains and hardware outputs without triggering them", async () => {
		const { options, output, taps } = fixture()
		output.hasAudioOutput = () => false
		expect((await captureTrackerSamples(options)).size).toBe(0)
		expect((await captureTrackerSamples({ ...options, getChain: () => undefined })).size).toBe(
			0
		)
		expect(taps).toHaveLength(0)
		expect(output.sendCommand).not.toHaveBeenCalled()
	})

	it("does no audio work when every note lacks a chain", async () => {
		const { options, mute, context } = fixture()
		expect(
			(await captureTrackerSamples({ ...options, notes: [note({ chainId: undefined })] }))
				.size
		).toBe(0)
		expect(mute).not.toHaveBeenCalled()
		expect(context.resume).not.toHaveBeenCalled()
	})

	it("caps returned samples to two seconds even for oversized capture buffers", async () => {
		const { options } = fixture([stereo(saw(sampleRate * 3))])
		const result = captureTrackerSamples({ ...options, holdSeconds: 10, releaseSeconds: 10 })
		await vi.runAllTimersAsync()
		const sample = (await result).get(trackerInstrumentKey(note()))!
		expect(sample.data.length).toBeLessThanOrEqual(sampleRate * 2)
		expect(sample.data.length).toBeGreaterThan(sampleRate)
	})

	it("finishes release early after a complete silent batch", async () => {
		const { options, taps } = fixture()
		const result = captureTrackerSamples({ ...options, holdSeconds: 0.1, releaseSeconds: 0.6 })
		await vi.advanceTimersByTimeAsync(110)
		taps[0].feed(new Float32Array(8192))
		taps[0].feed(new Float32Array(8192))
		expect((await result).size).toBe(1)
		expect(taps[0].port.postMessage.mock.calls.map(([type]) => type)).toEqual([
			RECORDING_START,
			RECORDING_STOP
		])
		expect(vi.getTimerCount()).toBe(0)
	})

	it("stops an asynchronous note that completes after cancellation", async () => {
		const { options, output, restore } = fixture()
		let complete: (() => void) | undefined
		output.sendCommand.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					complete = resolve
				})
		)
		const controller = new AbortController()
		const result = captureTrackerSamples({ ...options, signal: controller.signal })
		const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" })
		await vi.advanceTimersByTimeAsync(0)
		controller.abort()
		await rejected
		expect(output.allNotesOff).toHaveBeenCalledOnce()
		complete?.()
		await vi.advanceTimersByTimeAsync(0)
		expect(output.allNotesOff).toHaveBeenCalledTimes(2)
		expect(restore).toHaveBeenCalledOnce()
	})

	it("aborts during the release tail and restores the mix", async () => {
		const { options, output, taps, restore } = fixture()
		const controller = new AbortController()
		const result = captureTrackerSamples({
			...options,
			holdSeconds: 0.1,
			signal: controller.signal
		})
		const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" })
		await vi.advanceTimersByTimeAsync(110)
		expect(output.sendCommand).toHaveBeenCalledWith(expect.objectContaining({ type: NOTE_OFF }))
		controller.abort()
		await rejected
		expect(taps[0].disconnect).toHaveBeenCalledOnce()
		expect(restore).toHaveBeenCalledOnce()
		expect(vi.getTimerCount()).toBe(0)
	})

	it("fans multiple instrument outputs into one tap and disconnects each source", async () => {
		const { options, output, source, taps, context } = fixture()
		const secondSource = { context, connect: vi.fn(), disconnect: vi.fn() }
		const secondOutput = {
			...output,
			output: secondSource,
			sendCommand: vi.fn(),
			allNotesOff: vi.fn()
		}
		const result = captureTrackerSamples({
			...options,
			getChain: () => ({ outputs: [output, secondOutput] as unknown as IAudioOutput[] })
		})
		await vi.runAllTimersAsync()
		expect((await result).size).toBe(1)
		expect(source.connect).toHaveBeenCalledWith(taps[0])
		expect(secondSource.connect).toHaveBeenCalledWith(taps[0])
		expect(secondSource.disconnect.mock.calls).toEqual([[taps[0]]])
		expect(secondOutput.sendCommand).toHaveBeenCalledWith(
			expect.objectContaining({ type: NOTE_ON, channel: 3, patch: 17 })
		)
		expect(secondOutput.allNotesOff).toHaveBeenCalledOnce()
	})
})