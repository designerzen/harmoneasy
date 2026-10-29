import { expect, it, vi } from 'vitest'
import { PercussionSynth } from '../../../packages/audiobus/instruments/percussion/percussion-synth.ts'
import { DEFAULT_DRUM_COMPRESSOR_SETTINGS } from '../../../packages/audiobus/effects/drum-compressor.ts'

function setup() {
	const parameter = () => ({
		value: 0,
		setValueAtTime: vi.fn(),
		linearRampToValueAtTime: vi.fn(),
		exponentialRampToValueAtTime: vi.fn(),
		setTargetAtTime: vi.fn(),
	})
	const node = () => ({ connect: vi.fn(), disconnect: vi.fn() })
	const sources: ReturnType<typeof source>[] = []
	const source = () => {
		const value = {
			...node(),
			start: vi.fn(),
			stop: vi.fn(),
			frequency: parameter(),
			buffer: null,
			type: 'sine',
			onended: null as (() => void) | null,
		}
		sources.push(value)
		return value
	}
	const destination = node()
	const gains: ReturnType<typeof gain>[] = []
	const gain = () => {
		const value = { ...node(), gain: parameter() }
		gains.push(value)
		return value
	}
	const compressor = {
		...node(),
		threshold: parameter(),
		ratio: parameter(),
		knee: parameter(),
		attack: parameter(),
		release: parameter(),
	}
	const context = {
		currentTime: 10,
		sampleRate: 48000,
		destination,
		createGain: gain,
		createDynamicsCompressor: () => compressor,
		createBuffer: () => ({ getChannelData: () => new Float32Array(48000) }),
		createOscillator: source,
		createBufferSource: source,
		createBiquadFilter: () => ({ ...node(), frequency: parameter(), type: 'highpass' }),
	}
	const mixer = node()
	const synth = new PercussionSynth(
		context as unknown as AudioContext,
		mixer as unknown as AudioNode,
	)
	return { synth, sources, mixer, gains, compressor }
}

it('schedules a native kit against audio time and disconnects every finished voice', () => {
	const { synth, sources, mixer } = setup()
	synth.trigger({ part: 'kick', velocity: 0.8, triggerAt: 11 })
	synth.trigger({ part: 'snare', velocity: 0.6, triggerAt: 11.125 })
	expect(sources).toHaveLength(3)
	expect(sources[0].start).toHaveBeenCalledWith(11)
	expect(sources[0].frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(
		42,
		expect.any(Number),
	)
	expect(sources[1].start).toHaveBeenCalledWith(11.125)
	sources[0].onended!()
	expect(sources[0].disconnect).toHaveBeenCalled()
	synth.destroy()
	expect(sources[1].stop).toHaveBeenLastCalledWith()
	expect(sources[2].disconnect).toHaveBeenCalled()
	expect(mixer.disconnect).not.toHaveBeenCalled()
})

it('compresses the drum bus before volume, with live controls, makeup gain, and bypass', () => {
	const { synth, gains, compressor, mixer } = setup()
	const [output, input, makeup, dry, wet] = gains
	expect(input.connect).toHaveBeenCalledWith(compressor)
	expect(input.connect).toHaveBeenCalledWith(dry)
	expect(compressor.connect).toHaveBeenCalledWith(makeup)
	expect(makeup.connect).toHaveBeenCalledWith(wet)
	expect(wet.connect).toHaveBeenCalledWith(output)
	expect(dry.connect).toHaveBeenCalledWith(output)
	expect(output.connect).toHaveBeenCalledWith(mixer)
	synth.setCompressor({
		...DEFAULT_DRUM_COMPRESSOR_SETTINGS,
		compressorThreshold: -24,
		compressorRatio: 6,
		compressorAttack: 0.02,
		compressorRelease: 0.3,
		compressorMakeupGain: 6,
	})
	expect(compressor.threshold.setTargetAtTime).toHaveBeenLastCalledWith(-24, 10, 0.01)
	expect(compressor.ratio.setTargetAtTime).toHaveBeenLastCalledWith(6, 10, 0.01)
	expect(compressor.attack.setTargetAtTime).toHaveBeenLastCalledWith(0.02, 10, 0.01)
	expect(compressor.release.setTargetAtTime).toHaveBeenLastCalledWith(0.3, 10, 0.01)
	expect(makeup.gain.setTargetAtTime).toHaveBeenLastCalledWith(10 ** (6 / 20), 10, 0.01)
	synth.setCompressor({ ...DEFAULT_DRUM_COMPRESSOR_SETTINGS, compressorEnabled: false })
	expect(dry.gain.setTargetAtTime).toHaveBeenLastCalledWith(1, 10, 0.01)
	expect(wet.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 10, 0.01)
	synth.destroy()
	for (const value of [input, compressor, makeup, dry, wet, output])
		expect(value.disconnect).toHaveBeenCalled()
})

it('chokes an open hat at the first closed hat without later hits extending it', () => {
	const { synth, sources } = setup()
	synth.trigger({ part: 'hat', open: true, velocity: 1, triggerAt: 11 })
	synth.trigger({ part: 'hat', open: false, velocity: 1, triggerAt: 11.1 })
	synth.trigger({ part: 'hat', open: false, velocity: 1, triggerAt: 11.2 })
	expect(sources[0].stop).toHaveBeenLastCalledWith(11.1)
	synth.allNotesOff()
	expect(sources.every((source) => source.disconnect.mock.calls.length > 0)).toBe(true)
	synth.destroy()
})

it('tunes the kick to the specified MIDI note without altering its scheduled time', () => {
	const { synth, sources } = setup()
	synth.trigger({ part: 'kick', velocity: 0.8, triggerAt: 11, tuningNote: 69 })
	expect(sources[0].frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(
		440,
		expect.any(Number),
	)
	expect(sources[0].start).toHaveBeenCalledWith(11)
	synth.trigger({ part: 'kick', velocity: 0.8, triggerAt: 12, tuningNote: 57 })
	expect(sources[1].frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(
		220,
		expect.any(Number),
	)
	synth.destroy()
})

it('restores the branch’s six-oscillator 808 hat and dual-oscillator cowbell', () => {
	const { synth, sources } = setup()
	synth.trigger({ part: 'hatClosed', velocity: 1, triggerAt: 11 })
	expect(sources).toHaveLength(6)
	for (const [i, ratio] of [2, 3, 4.16, 5.43, 6.79, 8.21].entries()) {
		expect(sources[i].type).toBe('square')
		expect(sources[i].frequency.setValueAtTime).toHaveBeenCalledWith(40 * ratio, 11)
	}
	synth.trigger({ part: 'cowbell', velocity: 1, triggerAt: 12 })
	expect(sources).toHaveLength(8)
	expect(sources[6].frequency.setValueAtTime).toHaveBeenCalledWith(800, 12)
	expect(sources[7].frequency.setValueAtTime).toHaveBeenCalledWith(540, 12)
	synth.destroy()
	expect(sources.every(source => source.disconnect.mock.calls.length > 0)).toBe(true)
})
