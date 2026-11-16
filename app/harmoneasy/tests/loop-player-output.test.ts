// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import OutputLoopPlayer from "../../../packages/audiobus/io/outputs/output-loop-player"
import {
	loopPlayerSettings,
	loopSourceBpm
} from "../../../packages/audiobus/io/outputs/loop-player-settings"
import { OUTPUT_FACTORIES } from "../../../packages/audiobus/io/output-factory"
import { LOOP_PLAYER } from "../../../packages/audiobus/io/outputs/output-types"
import { defineDevice, deviceDefinition } from "../../../packages/audiobus/io/device-definition"

const outputs: OutputLoopPlayer[] = []
afterEach(() => {
	outputs.splice(0).forEach((output) => output.destroy())
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

function audioContext() {
	const param = () => ({
		value: 0,
		setValueAtTime: vi.fn(),
		linearRampToValueAtTime: vi.fn(),
		cancelScheduledValues: vi.fn()
	})
	const channels = Array.from({ length: 2 }, () => new Float32Array(32000))
	const buffer = {
		duration: 4,
		length: 32000,
		sampleRate: 8000,
		numberOfChannels: 2,
		getChannelData: (index: number) => channels[index]
	}
	return Object.assign(Object.create({}), {
		currentTime: 10,
		state: "running",
		destination: {},
		sampleRate: 8000,
		createGain: vi.fn(() => ({ gain: param(), connect: vi.fn(), disconnect: vi.fn() })),
		createBufferSource: vi.fn(() => ({
			buffer: null,
			loop: false,
			loopStart: 0,
			loopEnd: 0,
			playbackRate: param(),
			connect: vi.fn(),
			disconnect: vi.fn(),
			start: vi.fn(),
			stop: vi.fn(),
			addEventListener: vi.fn()
		})),
		resume: vi.fn(async () => {}),
		audioWorklet: { addModule: vi.fn(async () => {}) },
		decodeAudioData: vi.fn(async () => buffer)
	})
}

const tick = (step: number, bpm = 120, triggerAt = 10 + (step * 60) / bpm / 4) => ({
	step,
	bpm,
	triggerAt,
	stepDuration: 60 / bpm / 4
})

async function player(mode = "slice", options: Record<string, unknown> = {}) {
	const context = audioContext()
	const output = new OutputLoopPlayer({ audioContext: context, mode, ...options })
	outputs.push(output)
	await output.loadSample(new Uint8Array([1, 2, 3]).buffer, "break.wav")
	return { context, output }
}

function stubWorklet() {
	const nodes: any[] = []
	vi.stubGlobal(
		"AudioWorkletNode",
		class {
			port = { postMessage: vi.fn(), close: vi.fn() }
			connect = vi.fn()
			disconnect = vi.fn()
			constructor() {
				nodes.push(this)
			}
		}
	)
	return nodes
}

describe("loop player settings and persistence", () => {
	it("derives BPM from the selected region and clamps invalid options", () => {
		expect(loopSourceBpm(loopPlayerSettings({ start: 1, end: 3, loopBeats: 4 }, 4))).toBe(120)
		expect(loopPlayerSettings({ start: -1, end: 90, loopBeats: 90 }, 4)).toEqual({
			start: 0,
			end: 4,
			loopBeats: 32,
			mode: "granular"
		})
		const settings = loopPlayerSettings({ start: 90, end: -1, loopBeats: 0 }, 4)
		expect(settings.start).toBeCloseTo(3.99)
		expect(settings.end).toBe(4)
		expect(settings.loopBeats).toBe(1)
		expect(loopPlayerSettings({ start: NaN, end: Infinity, loopBeats: NaN }, 4)).toEqual({
			start: 0,
			end: 4,
			loopBeats: 4,
			mode: "granular"
		})
		expect(loopPlayerSettings({}, 0.005).end).toBe(0.005)
	})
	it("defaults to the whole file, saves audio and options, and restores the region", async () => {
		const { context, output } = await player()
		expect(output.options).toMatchObject({ start: 0, end: 4, loopBeats: 4 })
		output.configure({ start: 1, end: 3, loopBeats: 8, mode: "varispeed" })
		defineDevice(output, { factory: "output", type: LOOP_PLAYER })
		const saved = JSON.parse(JSON.stringify(deviceDefinition(output)))
		expect(saved.options).toMatchObject({
			sample: "AQID",
			fileName: "break.wav",
			start: 1,
			end: 3,
			loopBeats: 8,
			mode: "varispeed"
		})
		expect(saved.options.audioContext).toBeUndefined()
		const restored = new OutputLoopPlayer({ ...saved.options, audioContext: context })
		outputs.push(restored)
		await vi.waitFor(() => expect(restored.sourceBpm).toBe(240))
		restored.onClockTick(tick(4))
		expect(context.createBufferSource.mock.results[0].value.start).toHaveBeenCalledWith(
			10.5,
			1.25
		)
	})
	it("rejects oversized files and ignores stale decodes and decodes after destruction", async () => {
		const context = audioContext()
		const output = new OutputLoopPlayer({ audioContext: context, mode: "slice" })
		outputs.push(output)
		await expect(
			output.loadSample(new ArrayBuffer(4 * 1024 * 1024 + 1), "big.wav")
		).rejects.toThrow("4 MB")
		expect(context.decodeAudioData).not.toHaveBeenCalled()
		let resolve!: (buffer: any) => void
		context.decodeAudioData.mockImplementationOnce(
			() =>
				new Promise((done) => {
					resolve = done
				})
		)
		const old = output.loadSample(new Uint8Array([4]).buffer, "old.wav")
		await output.loadSample(new Uint8Array([5]).buffer, "new.wav")
		resolve({ duration: 9 })
		await old
		expect(output.options.fileName).toBe("new.wav")
		expect(output.options.end).toBe(4)
		context.decodeAudioData.mockImplementationOnce(
			() =>
				new Promise((done) => {
					resolve = done
				})
		)
		const late = output.loadSample(new Uint8Array([6]).buffer, "late.wav")
		output.destroy()
		resolve({ duration: 9 })
		await late
		expect(output.options.fileName).toBe("new.wav")
	})
	it("shows derived BPM and validated editable region and mode controls", async () => {
		const { output } = await player()
		const gui = await output.createGui()
		const numbers = gui.querySelectorAll<HTMLInputElement>('input[type="number"]')
		numbers[0].value = "1"
		numbers[0].dispatchEvent(new Event("change"))
		numbers[1].value = "3"
		numbers[1].dispatchEvent(new Event("change"))
		expect(gui.textContent).toContain("Source BPM: 120.00")
		numbers[1].value = "0"
		numbers[1].dispatchEvent(new Event("change"))
		expect(Number(numbers[1].value)).toBeCloseTo(1.01)
		numbers[1].value = ""
		numbers[1].dispatchEvent(new Event("change"))
		expect(Number(numbers[1].value)).toBeCloseTo(1.01)
		expect(Array.from(gui.querySelectorAll("option"), (option) => option.value)).toEqual([
			"granular",
			"slice",
			"varispeed"
		])
	})
})

describe("loop player clock scheduling", () => {
	it("triggers the right sixteenth slices, respects the region, wraps and clamps late ticks", async () => {
		const { context, output } = await player()
		output.configure({ start: 1, end: 3, loopBeats: 2 })
		for (let step = 0; step < 10; step++) output.onClockTick(tick(step))
		const sources = context.createBufferSource.mock.results.map((result) => result.value)
		for (let step = 0; step < 10; step++) {
			expect(sources[step].start).toHaveBeenCalledWith(
				10 + step * 0.125,
				1 + (step % 8) * 0.25,
				0.125
			)
			expect(sources[step].loop).toBe(false)
		}
		output.onClockTick(tick(10, 120, 9))
		expect(context.createBufferSource.mock.results[10].value.start).toHaveBeenCalledWith(
			10,
			1.5,
			0.125
		)
		output.onClockTick(tick(10, 120, 9))
		expect(context.createBufferSource).toHaveBeenCalledTimes(11)
		const gain = context.createGain.mock.results[1].value.gain
		expect(gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 10.005)
		expect(gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 10.125)
	})
	it("allows natural slice tails only within the source slice at slower tempos", async () => {
		const { context, output } = await player()
		output.configure({ start: 1, end: 2, loopBeats: 4 })
		output.onClockTick(tick(15, 60))
		expect(context.createBufferSource.mock.results[0].value.start).toHaveBeenCalledWith(
			13.75,
			1.9375,
			0.0625
		)
	})
	it("tracks the varispeed ratio and resyncs on beats, tempo changes and step jumps", async () => {
		const { context, output } = await player("varispeed")
		output.configure({ start: 1, end: 3, loopBeats: 4 })
		output.onClockTick(tick(0))
		output.onClockTick(tick(1))
		expect(context.createBufferSource).toHaveBeenCalledTimes(1)
		output.onClockTick(tick(2, 180, 10.25))
		output.onClockTick(tick(3, 180, 10.25 + 1 / 12))
		output.onClockTick(tick(4, 180, 10.5))
		output.onClockTick(tick(17, 120, 11))
		const sources = context.createBufferSource.mock.results.map((result) => result.value)
		expect(sources[0].playbackRate.setValueAtTime).toHaveBeenCalledWith(1, 10)
		expect(sources[1].playbackRate.setValueAtTime).toHaveBeenCalledWith(1.5, 10.25)
		expect(sources[1].start).toHaveBeenCalledWith(10.25, 1.25)
		expect(sources[2].start).toHaveBeenCalledWith(10.5, 1.5)
		expect(sources[3].start).toHaveBeenCalledWith(11, 1.125)
		expect(sources[0].stop).toHaveBeenCalledWith(10.255)
		expect(sources[0]).toMatchObject({ loop: true, loopStart: 1, loopEnd: 3 })
	})
	it.each(["slice", "varispeed"])(
		"stops every %s voice, resumes from the absolute step and ignores notes",
		async (mode) => {
			const { context, output } = await player(mode)
			output.onClockTick(tick(3))
			output.onClockTick(tick(4))
			output.noteOn(60, 100)
			output.noteOff(60)
			output.stopClock()
			// Fades out over 5 ms instead of cutting
			for (const result of context.createBufferSource.mock.results) {
				expect(result.value.stop).toHaveBeenLastCalledWith(expect.closeTo(10.005, 9))
			}
			expect(
				context.createGain.mock.results[0].value.gain.linearRampToValueAtTime
			).toHaveBeenLastCalledWith(0, expect.closeTo(10.005, 9))
			output.onClockTick(tick(11, 120, 12))
			const resumed = context.createBufferSource.mock.results.at(-1)!.value
			expect(resumed.start.mock.calls[0].slice(0, 2)).toEqual([12, 2.75])
			await output.disconnect()
			const count = context.createBufferSource.mock.calls.length
			output.onClockTick(tick(12))
			expect(context.createBufferSource).toHaveBeenCalledTimes(count)
			await output.connect()
			expect(output.isConnected).toBe(true)
		}
	)
	it("schedules worklet syncs at beats and tempo changes, transfers each region once and clears on stop", async () => {
		const nodes = stubWorklet()
		const { context, output } = await player("granular")
		await vi.waitFor(() => expect(nodes).toHaveLength(1))
		const port = nodes[0].port
		output.configure({ start: 1, end: 3 })
		await vi.waitFor(() =>
			expect(
				port.postMessage.mock.calls.filter(([data]: any[]) => data.type === "buffer")
			).toHaveLength(2)
		)
		const transfers = port.postMessage.mock.calls.filter(
			([data]: any[]) => data.type === "buffer"
		)
		expect(transfers[1][0].channels.map((channel: Float32Array) => channel.length)).toEqual([
			16000, 16000
		])
		expect(transfers[1][1]).toEqual(
			transfers[1][0].channels.map((channel: Float32Array) => channel.buffer)
		)
		output.onClockTick(tick(0))
		output.onClockTick(tick(1))
		output.onClockTick(tick(2, 180, 10.25))
		output.onClockTick(tick(3, 180, 10.4))
		output.onClockTick(tick(4, 180, 10.5))
		const syncs = port.postMessage.mock.calls
			.map(([data]: any[]) => data)
			.filter((data: any) => data.type === "sync")
		expect(syncs).toEqual([
			{ type: "sync", at: 10, position: 0, ratio: 1 },
			{ type: "sync", at: 10.25, position: 0.25, ratio: 1.5 },
			{ type: "sync", at: 10.5, position: 0.5, ratio: 1.5 }
		])
		output.stopClock()
		expect(port.postMessage).toHaveBeenLastCalledWith({
			type: "stop",
			at: expect.closeTo(10.005, 9)
		})
		output.onClockTick(tick(9, 120, 9.9))
		expect(port.postMessage.mock.calls.at(-1)[0]).toMatchObject({
			type: "sync",
			at: 10,
			ratio: 1
		})
		expect(port.postMessage.mock.calls.at(-1)[0].position).toBeCloseTo(1.225)
		expect(context.audioWorklet.addModule).toHaveBeenCalledOnce()
		output.destroy()
		expect(port.postMessage).toHaveBeenLastCalledWith({ type: "dispose" })
		expect(port.close).toHaveBeenCalledOnce()
	})
	it("changes loop length without cutting playback, and stops only for region or mode changes", async () => {
		const { context, output } = await player("varispeed")
		output.onClockTick(tick(0))
		const first = context.createBufferSource.mock.results[0].value
		// The whole 4 s file as 4 beats is 60 BPM, so 120 BPM plays at double speed
		expect(first.playbackRate.setValueAtTime).toHaveBeenCalledWith(2, 10)
		output.configure({ loopBeats: 8 })
		expect(first.stop).not.toHaveBeenCalled()
		// Resyncs at the new rate on the next tick, crossfading the old voice
		output.onClockTick(tick(1))
		const second = context.createBufferSource.mock.results[1].value
		expect(second.playbackRate.setValueAtTime).toHaveBeenCalledWith(1, expect.any(Number))
		expect(first.stop).toHaveBeenCalledOnce()
		output.configure({ start: 1 })
		expect(second.stop).toHaveBeenCalled()
	})
	it("uploads the granular region again only when start or end change", async () => {
		const nodes = stubWorklet()
		const { output } = await player("granular")
		await vi.waitFor(() => expect(nodes).toHaveLength(1))
		const buffers = () =>
			nodes[0].port.postMessage.mock.calls.filter(([data]: any[]) => data.type === "buffer")
		await vi.waitFor(() => expect(buffers()).toHaveLength(1))
		output.configure({ loopBeats: 8 })
		output.onClockTick(tick(0))
		expect(buffers()).toHaveLength(1)
		output.configure({ end: 2 })
		await vi.waitFor(() => expect(buffers()).toHaveLength(2))
	})
	it("falls back to varispeed when the granular worklet cannot load", async () => {
		const context = audioContext()
		context.audioWorklet.addModule = vi.fn(async () => {
			throw new Error("no worklets")
		})
		const output = new OutputLoopPlayer({ audioContext: context, mode: "granular" })
		outputs.push(output)
		await output.loadSample(new Uint8Array([1, 2, 3]).buffer, "break.wav")
		await vi.waitFor(() => expect(context.audioWorklet.addModule).toHaveBeenCalled())
		await new Promise((resolve) => setTimeout(resolve))
		output.onClockTick(tick(0))
		expect(context.createBufferSource).toHaveBeenCalledOnce()
		expect(output.options.mode).toBe("granular")
	})
	it("creates the registered output through its lazy factory", async () => {
		const factory = OUTPUT_FACTORIES.find((factory) => factory.id === LOOP_PLAYER)!
		expect(factory.name).toBe("Loop Player")
		const output = await factory.create({ audioContext: audioContext(), mode: "slice" })
		expect(output).toBeInstanceOf(OutputLoopPlayer)
		outputs.push(output as OutputLoopPlayer)
	})
})