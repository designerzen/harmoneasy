import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	CAPTURE_BUDGET_SECONDS,
	captureTrackerSamples,
	downmixToMono,
	findSustainLoop,
	groupTrackerNotes,
	normalisePeak,
	planTrackerCaptures,
	representativeTrackerNote,
	scheduleTrackerCaptures,
	trimSilence
} from "audiobus/io/recording/capture-instrument-samples"
import { DRUM_VOICES } from "audiobus/formats/tracker/tracker-drums"
import { trackerInstrumentKey, type TrackerSampleSet } from "audiobus/formats/tracker/tracker-types"
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
	// The loop that ends soonest wins: a short loop that early in the held note
	expect(loop.loopLength!).toBeLessThan(sampleRate * 0.06)
	expect(end).toBeLessThan(sampleRate * 0.7)
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

describe("capture planning", () => {
	const wide = (chainId: string) =>
		[36, 60, 84].map((number) => note({ chainId, number, channel: 3, patch: 17 }))

	it("samples a narrow instrument once and a wide one in up to three zones", () => {
		const narrow = planTrackerCaptures([60, 66, 72].map((number) => note({ number })))
		expect(narrow).toHaveLength(1)
		expect(narrow[0].map((job) => job.note.number)).toEqual([66])
		const zones = planTrackerCaptures(wide("synth"))
		expect(zones[0].map((job) => job.note.number)).toEqual([36, 60, 84])
		expect(zones[0].map((job) => job.rank)).toEqual([1, 0, 2])
		// Two octaves and a bit needs two zones, not three
		const two = planTrackerCaptures([60, 70, 80].map((number) => note({ number })))
		expect(two[0].length).toBeGreaterThan(1)
		expect(planTrackerCaptures([60, 74].map((number) => note({ number })))[0]).toHaveLength(1)
	})

	it("samples each drum voice of a channel 10 instrument, most played first, up to twelve", () => {
		const drums = [36, 36, 35, 38, 42, 42, 42, 46].map((number) =>
			note({ number, channel: 10 })
		)
		const [jobs] = planTrackerCaptures(drums)
		expect(jobs.map((job) => job.note.number)).toEqual([36, 42, 38, 46])
		expect(jobs[0].keys).toEqual([35, 36])
		expect(jobs.every((job) => job.drums)).toBe(true)
		const kit = DRUM_VOICES.map((voice) => note({ number: voice.rep, channel: 10 }))
		expect(planTrackerCaptures(kit)[0]).toHaveLength(12)
	})

	it("keeps the requested hold and release while the captures fit the budget", () => {
		const plans = planTrackerCaptures(
			Array.from({ length: 4 }, (_, i) => note({ chainId: `c${i}` }))
		)
		const schedule = scheduleTrackerCaptures(plans, CAPTURE_BUDGET_SECONDS, 0.8, 0.6)
		expect(schedule.plans.flat()).toHaveLength(4)
		expect(schedule.timing(plans[0][0])).toEqual({ hold: 0.8, release: 0.6 })
	})

	it("shrinks the holds and releases of many captures to share the budget", () => {
		const plans = planTrackerCaptures(
			Array.from({ length: 24 }, (_, i) => note({ chainId: `c${i}` }))
		)
		const schedule = scheduleTrackerCaptures(plans, 12, 0.8, 0.6)
		const times = schedule.plans.flat().map((job) => schedule.timing(job))
		expect(times).toHaveLength(24)
		expect(times[0].hold).toBeLessThan(0.8)
		expect(times[0].hold).toBeGreaterThan(0.15)
		expect(times.reduce((sum, time) => sum + time.hold + time.release, 0)).toBeLessThanOrEqual(
			12.0001
		)
	})

	it("drops the extra zones, never an instrument's main capture, when the budget is tight", () => {
		const plans = planTrackerCaptures([...wide("a"), ...wide("b"), ...wide("c")])
		expect(plans.flat()).toHaveLength(9)
		const tight = scheduleTrackerCaptures(plans, 0.9, 0.8, 0.6)
		expect(tight.plans.map((jobs) => jobs.map((job) => job.note.number))).toEqual([
			[60],
			[60],
			[60]
		])
		// Room for two more captures keeps the lower zone of the first two instruments
		const some = scheduleTrackerCaptures(plans, 1.5, 0.8, 0.6)
		expect(some.plans.flat()).toHaveLength(5)
	})
})

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
			note({ number: 72, velocity: 120 })
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

	it("captures a wide-range instrument in zones whose levels stay relative", async () => {
		const quiet = Float32Array.from(saw(), (value) => value * 0.25)
		const { options, output } = fixture([stereo(saw()), stereo(quiet), stereo(saw())])
		const notes = Array.from({ length: 12 }, (_, i) => note({ number: 36 + i * 4 }))
		const result = captureTrackerSamples({ ...options, notes })
		await vi.runAllTimersAsync()
		const set = (await result).get(trackerInstrumentKey(note())) as TrackerSampleSet
		expect(set.samples.map((sample) => sample.baseNote)).toEqual([40, 56, 72])
		expect(set.keymap).toBeUndefined()
		expect(set.samples.map((sample) => sample.volume!)).toEqual([1, 0.25, 1])
		expect(
			output.sendCommand.mock.calls
				.filter(([command]) => command.type === NOTE_ON)
				.map(([command]) => command.number)
		).toEqual([40, 56, 72])
	})

	it("captures each drum voice of a channel 10 instrument and maps the keys that play it", async () => {
		const { options, output } = fixture([
			stereo(saw()),
			stereo(saw()),
			stereo(saw()),
			stereo(saw())
		])
		const notes = [36, 36, 35, 38, 42, 42, 42, 46].map((number) =>
			note({ number, channel: 10, patch: 0 })
		)
		const result = captureTrackerSamples({ ...options, notes })
		await vi.runAllTimersAsync()
		const set = (await result).get(
			trackerInstrumentKey(note({ channel: 10, patch: 0 }))
		) as TrackerSampleSet
		expect(set.samples.map((sample) => [sample.name, sample.baseNote])).toEqual([
			["Kick 36", 36],
			["Closed hat 42", 42],
			["Snare 38", 38],
			["Open hat 46", 46]
		])
		expect([...set.keymap!]).toEqual([
			[35, 0],
			[36, 0],
			[42, 1],
			[38, 2],
			[46, 3]
		])
		// A hit rings out once, so it has no loop
		expect(set.samples.every((sample) => sample.loopLength === undefined)).toBe(true)
		expect(output.sendCommand).toHaveBeenCalledWith(
			expect.objectContaining({ type: NOTE_ON, number: 38, channel: 10 })
		)
	})

	it("keeps the whole capture within the budget by shortening holds and dropping zones", async () => {
		const { options } = fixture(Array.from({ length: 24 }, () => stereo(saw())))
		const progress = vi.fn()
		const notes = Array.from({ length: 24 }, (_, i) =>
			note({ chainId: `chain-${i}`, number: 60 })
		)
		const started = Date.now()
		const result = captureTrackerSamples({ ...options, notes, onProgress: progress })
		await vi.runAllTimersAsync()
		expect((await result).size).toBe(24)
		expect(Date.now() - started).toBeLessThanOrEqual(CAPTURE_BUDGET_SECONDS * 1000 + 100)
		// A wide-range instrument with room for only two captures gets two of its three zones
		const wide = [36, 60, 84].map((number) => note({ number }))
		const small = vi.fn()
		const zoned = captureTrackerSamples({
			...fixture([stereo(saw()), stereo(saw())]).options,
			notes: wide,
			budgetSeconds: 0.6,
			onProgress: small
		})
		await vi.runAllTimersAsync()
		const set = (await zoned).get(trackerInstrumentKey(note())) as TrackerSampleSet
		expect(set.samples.map((sample) => sample.baseNote)).toEqual([36, 60])
		expect(small.mock.calls).toEqual([
			[1, 2],
			[2, 2]
		])
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