import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { describe, it, expect, vi, afterEach } from "vitest"
import { loadCaptureWorklet } from "../../../packages/audiobus/io/inputs/load-capture-worklet.ts"
import InputDvsControlVinyl from "../../../packages/audiobus/io/inputs/input-dvs-control-vinyl.ts"
import {
	createChord,
	createMajorChord,
	createMinorChord,
	createDiminishedChord,
	createFifthsChord
} from "../../../packages/audiobus/tuning/chords/chords.ts"
import { Ticks } from "../../../packages/audiobus/timing/index.ts"
import IOChain from "../../../packages/audiobus/io/IO-chain.ts"
import { INPUT_EVENT } from "../../../packages/audiobus/commands/commands.ts"
import {
	DVS_CLOCK,
	DVS_START,
	DVS_STOP,
	MIDI_CLOCK
} from "../../../packages/audiobus/commands/commands.ts"

afterEach(() => vi.restoreAllMocks())

describe("capture regressions", () => {
	it.each([DVS_CLOCK, MIDI_CLOCK])("synchronizes transport BPM from %s", async (type) => {
		const chain = {
			isActive: true,
			timer: { BPM: 120 },
			addCommandToQueue: vi.fn().mockResolvedValue(undefined),
			dispatchEvent: vi.fn()
		}
		const command = { type, bpm: 98.6 }
		IOChain.prototype.onInputEvent.call(
			chain as any,
			{
				command,
				preventDefault: vi.fn(),
				clone: vi.fn()
			} as any
		)
		expect(chain.timer.BPM).toBe(99)
		expect(chain.addCommandToQueue).toHaveBeenCalledWith(command)
	})
	it("shares registration across simultaneous callers and reconnects, separately per context", async () => {
		const addModule = vi.fn().mockResolvedValue(undefined)
		const context = { audioWorklet: { addModule } } as unknown as AudioContext
		await Promise.all([
			loadCaptureWorklet(context, "test", ""),
			loadCaptureWorklet(context, "test", "")
		])
		await loadCaptureWorklet(context, "test", "")
		expect(addModule).toHaveBeenCalledTimes(1)
		await loadCaptureWorklet(
			{ audioWorklet: { addModule } } as unknown as AudioContext,
			"test",
			""
		)
		expect(addModule).toHaveBeenCalledTimes(2)
	})

	it("retries failed registrations and releases blob URLs", async () => {
		const revoke = vi.spyOn(URL, "revokeObjectURL")
		const addModule = vi
			.fn()
			.mockRejectedValueOnce(new Error("load failed"))
			.mockResolvedValue(undefined)
		const context = { audioWorklet: { addModule } } as unknown as AudioContext
		await expect(loadCaptureWorklet(context, "test", "")).rejects.toThrow("load failed")
		await loadCaptureWorklet(context, "test", "")
		expect(addModule).toHaveBeenCalledTimes(2)
		expect(revoke).toHaveBeenCalledTimes(2)
	})

	const simulateWorklet = (
		sampleRate: number,
		processorOptions: Record<string, unknown>,
		seconds: number,
		setup?: (processor: any) => void,
		// Pilot phase in radians at time t; stereo adds the lagging quadrature channel
		{
			phase = (t: number) => 2 * Math.PI * 1000 * t,
			secondary
		}: { phase?: (t: number) => number; secondary?: (angle: number) => number } = {}
	) => {
		const source = readFileSync(
			new URL(
				"../../../packages/audiobus/io/inputs/input-dvs-control-vinyl.ts",
				import.meta.url
			),
			"utf8"
		)
		const code = source.match(/const WORKLET_PROCESSOR_CODE = `([\s\S]*?)`/)![1]
		const messages: any[] = []
		let Processor: any
		const globals = {
			sampleRate,
			currentTime: 0,
			AudioWorkletProcessor: class {
				port = { postMessage: (message: any) => messages.push(message) }
			},
			registerProcessor: (_name: string, value: any) => {
				Processor = value
			}
		}
		runInNewContext(code, globals)
		const processor = new Processor({ processorOptions })
		setup?.(processor)
		for (let frame = 0; frame < sampleRate * seconds; frame += 128) {
			globals.currentTime = frame / sampleRate
			const angles = Array.from({ length: 128 }, (_, i) => phase((frame + i) / sampleRate))
			const channels = [Float32Array.from(angles, (angle) => 0.5 * Math.sin(angle))]
			if (secondary) {
				channels.push(Float32Array.from(angles, (angle) => 0.5 * secondary(angle)))
			}
			processor.process([channels])
		}
		return Object.assign(
			messages.filter((message) => message.type === "tick"),
			{ status: messages.filter((message) => message.type === "status") }
		)
	}
	const quadrature = (angle: number) => Math.sin(angle - Math.PI / 2)

	it.each([44100, 48000, 96000])(
		"emits 24 musical ticks per beat of referenceBPM at %i Hz without render-block tick bursts",
		(sampleRate) => {
			// 120 BPM at speed 1.0 = 48 ticks per second
			const ticks = simulateWorklet(sampleRate, { referenceBPM: 120 }, 3)
			expect(ticks.length).toBeGreaterThanOrEqual(142)
			expect(ticks.length).toBeLessThanOrEqual(144)
			expect(ticks.at(-1).speed).toBeCloseTo(1, 2)
			for (let i = 1; i < ticks.length; i++) {
				expect(ticks[i].timestamp - ticks[i - 1].timestamp).toBeCloseTo(1 / 48, 2)
			}
		}
	)

	it("follows referenceBPM changes posted to the worklet port", () => {
		const ticks = simulateWorklet(48000, {}, 2, (processor) =>
			processor.port.onmessage({ data: { type: "referenceBPM", referenceBPM: 60 } })
		)
		// 60 BPM = 24 ticks per second
		expect(ticks.length).toBeGreaterThanOrEqual(46)
		expect(ticks.length).toBeLessThanOrEqual(48)
	})

	it("reads direction from the stereo quadrature and holds the clock in reverse", () => {
		const forward = simulateWorklet(48000, {}, 1, undefined, { secondary: quadrature })
		expect(forward.length).toBeGreaterThanOrEqual(46)
		expect(forward.status.at(-1).direction).toBe(1)
		const reverse = simulateWorklet(48000, {}, 1, undefined, {
			phase: (t) => -2 * Math.PI * 1000 * t,
			secondary: quadrature
		})
		expect(reverse.length).toBeLessThanOrEqual(1)
		expect(reverse.status.at(-1).direction).toBe(-1)
		const inverted = simulateWorklet(48000, { invertDirection: true }, 1, undefined, {
			secondary: quadrature
		})
		expect(inverted.status.at(-1).direction).toBe(-1)
	})

	it("resumes ticking where it held after a backspin", () => {
		// 1 s forward, 1 s back, 1 s forward with a continuous pilot phase
		const w = 2 * Math.PI * 1000
		const ticks = simulateWorklet(48000, {}, 3, undefined, {
			phase: (t) => (t < 1 ? w * t : t < 2 ? w * (2 - t) : w * (t - 2)),
			secondary: quadrature
		})
		expect(ticks.length).toBeGreaterThanOrEqual(92)
		expect(ticks.length).toBeLessThanOrEqual(98)
		expect(ticks.some((tick: any) => tick.timestamp > 1.05 && tick.timestamp < 2)).toBe(false)
		expect(ticks.at(-1).direction).toBe(1)
	})

	it("treats an unclear second channel as unknown direction and keeps ticking", () => {
		const ticks = simulateWorklet(48000, {}, 1, undefined, { secondary: Math.sin })
		expect(ticks.length).toBeGreaterThanOrEqual(46)
		expect(ticks.status.at(-1).direction).toBe(0)
	})

	it("rejects unsafe clock options", () => {
		expect(() => new InputDvsControlVinyl({ referenceBPM: -1 })).toThrow(RangeError)
		expect(() => new InputDvsControlVinyl({ referenceBPM: Infinity })).toThrow(RangeError)
		expect(() => new InputDvsControlVinyl().setReferenceBPM(0)).toThrow(RangeError)
	})

	it("brackets a run of ticks with DVS_START and DVS_STOP and carries the audio time", async () => {
		const port: any = { postMessage: vi.fn() }
		vi.stubGlobal(
			"AudioWorkletNode",
			class {
				port = port
				connect() {}
				disconnect() {}
			}
		)
		vi.stubGlobal("navigator", {
			mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) }
		})
		const context = {
			sampleRate: 48000,
			audioWorklet: { addModule: vi.fn(async () => {}) },
			createMediaStreamSource: () => ({ connect() {}, disconnect() {} })
		}
		const input = new InputDvsControlVinyl({ audioContext: context })
		const commands: any[] = []
		input.addEventListener(INPUT_EVENT, (event) => commands.push((event as any).command))
		await input.connect()
		input.setReferenceBPM(90)
		expect(port.postMessage).toHaveBeenCalledWith({ type: "referenceBPM", referenceBPM: 90 })
		const status = (hasSignal: boolean, timestamp: number) =>
			port.onmessage({
				data: { type: "status", hasSignal, timestamp, speed: 1, direction: 0 }
			})
		for (let i = 0; i < 3; i++) {
			port.onmessage({
				data: { type: "tick", timestamp: 10 + i / 48, speed: 1, direction: 0 }
			})
		}
		expect(commands.map((command) => command.type)).toEqual([
			DVS_START,
			DVS_CLOCK,
			DVS_CLOCK,
			DVS_CLOCK
		])
		expect(commands[1].audioTime).toBe(10)
		expect(commands[3].bpm).toBeCloseTo(120)
		status(true, 10.2)
		expect(commands.length).toBe(4)
		// ticks stop while the tone remains: stops after the timeout
		status(true, 10.6)
		expect(commands.at(-1).type).toBe(DVS_STOP)
		expect(commands.length).toBe(5)
		// signal returns: a fresh start
		port.onmessage({ data: { type: "tick", timestamp: 11, speed: 1, direction: 0 } })
		expect(commands.at(-2).type).toBe(DVS_START)
		// signal lost stops immediately
		status(false, 11.1)
		expect(commands.at(-1).type).toBe(DVS_STOP)
		// reverse play holds: no stop while the record runs backwards
		port.onmessage({ data: { type: "tick", timestamp: 12, speed: 1, direction: 1 } })
		expect(commands.at(-1).text).toBe("forward")
		const held = commands.length
		port.onmessage({
			data: { type: "status", hasSignal: true, timestamp: 13, speed: 1, direction: -1 }
		})
		expect(commands.length).toBe(held)
		await input.disconnect()
		vi.unstubAllGlobals()
	})

	it("resolves timing exports and chord helper constants", () => {
		expect(Ticks.Beat).toBe(3840)
		const notes = Array.from({ length: 128 }, (_, i) => i)
		for (const create of [
			createChord,
			createMajorChord,
			createMinorChord,
			createDiminishedChord,
			createFifthsChord
		]) {
			expect(() => create(notes)).not.toThrow()
		}
	})
})