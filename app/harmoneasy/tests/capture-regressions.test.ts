import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { loadCaptureWorklet } from '../../../packages/audiobus/io/inputs/load-capture-worklet.ts'
import InputDvsControlVinyl from '../../../packages/audiobus/io/inputs/input-dvs-control-vinyl.ts'
import { createChord, createMajorChord, createMinorChord, createDiminishedChord, createFifthsChord } from '../../../packages/audiobus/tuning/chords/chords.ts'
import { Ticks } from '../../../packages/audiobus/timing/index.ts'
import IOChain from '../../../packages/audiobus/io/IO-chain.ts'
import { DVS_CLOCK, MIDI_CLOCK } from '../../../packages/audiobus/commands.ts'

afterEach(() => vi.restoreAllMocks())

describe('capture regressions', () => {
	it.each([DVS_CLOCK, MIDI_CLOCK])('synchronizes transport BPM from %s', async type => {
		const chain = {
			timer: { BPM: 120 },
			addCommandToQueue: vi.fn().mockResolvedValue(undefined),
			dispatchEvent: vi.fn()
		}
		const command = { type, bpm: 98.6 }
		IOChain.prototype.onInputEvent.call(chain as any, {
			command, preventDefault: vi.fn(), clone: vi.fn()
		} as any)
		expect(chain.timer.BPM).toBe(99)
		expect(chain.addCommandToQueue).toHaveBeenCalledWith(command)
	})
	it('shares registration across simultaneous callers and reconnects, separately per context', async () => {
		const addModule = vi.fn().mockResolvedValue(undefined)
		const context = { audioWorklet: { addModule } } as unknown as AudioContext
		await Promise.all([loadCaptureWorklet(context, 'test', ''), loadCaptureWorklet(context, 'test', '')])
		await loadCaptureWorklet(context, 'test', '')
		expect(addModule).toHaveBeenCalledTimes(1)
		await loadCaptureWorklet({ audioWorklet: { addModule } } as unknown as AudioContext, 'test', '')
		expect(addModule).toHaveBeenCalledTimes(2)
	})

	it('retries failed registrations and releases blob URLs', async () => {
		const revoke = vi.spyOn(URL, 'revokeObjectURL')
		const addModule = vi.fn().mockRejectedValueOnce(new Error('load failed')).mockResolvedValue(undefined)
		const context = { audioWorklet: { addModule } } as unknown as AudioContext
		await expect(loadCaptureWorklet(context, 'test', '')).rejects.toThrow('load failed')
		await loadCaptureWorklet(context, 'test', '')
		expect(addModule).toHaveBeenCalledTimes(2)
		expect(revoke).toHaveBeenCalledTimes(2)
	})

	it.each([44100, 48000, 96000])('tracks a reference pilot at %i Hz without render-block tick bursts', sampleRate => {
		const source = readFileSync(new URL('../../../packages/audiobus/io/inputs/input-dvs-control-vinyl.ts', import.meta.url), 'utf8')
		const code = source.match(/const WORKLET_PROCESSOR_CODE = `([\s\S]*?)`/)![1]
		const messages: any[] = []
		let Processor: any
		const globals = {
			sampleRate, currentTime: 0,
			AudioWorkletProcessor: class { port = { postMessage: (message: any) => messages.push(message) } },
			registerProcessor: (_name: string, value: any) => { Processor = value }
		}
		runInNewContext(code, globals)
		const processor = new Processor({ processorOptions: {} })
		for (let frame = 0; frame < sampleRate * 3; frame += 128) {
			globals.currentTime = frame / sampleRate
			const samples = Float32Array.from({ length: 128 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 1000 * (frame + i) / sampleRate))
			processor.process([[samples]])
		}
		const ticks = messages.filter(message => message.type === 'tick')
		expect(ticks.length).toBeGreaterThanOrEqual(39)
		expect(ticks.length).toBeLessThanOrEqual(40)
		expect(ticks.at(-1).speed).toBeCloseTo(1, 2)
		for (let i = 1; i < ticks.length; i++) {
			expect(ticks[i].timestamp - ticks[i - 1].timestamp).toBeCloseTo(0.075, 2)
		}
	})

	it('rejects unsafe clock options', () => {
		expect(() => new InputDvsControlVinyl({ ticksPerRevolution: -1 })).toThrow(RangeError)
		expect(() => new InputDvsControlVinyl({ referenceRPM: Infinity })).toThrow(RangeError)
	})

	it('resolves timing exports and chord helper constants', () => {
		expect(Ticks.Beat).toBe(3840)
		const notes = Array.from({ length: 128 }, (_, i) => i)
		for (const create of [createChord, createMajorChord, createMinorChord, createDiminishedChord, createFifthsChord]) {
			expect(() => create(notes)).not.toThrow()
		}
	})
})
