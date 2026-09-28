import { afterEach, describe, expect, it, vi } from 'vitest'
import SynthOscillator from '../../../packages/audiobus/instruments/oscillators/synth-oscillator'
import PolySynth from '../../../packages/audiobus/instruments/polyphonic'
import ToneSynth from '../../../packages/audiobus/instruments/tone/tone-synth'
import ToneMonoSynth from '../../../packages/audiobus/instruments/tone/tone-mono-synth'
import ToneFMSynth from '../../../packages/audiobus/instruments/tone/tone-fm-synth'
import ToneSampler from '../../../packages/audiobus/instruments/tone/tone-sampler'
import TonePluck from '../../../packages/audiobus/instruments/tone/tone-pluck-string'
import OutputManager from '../../../packages/audiobus/io/output-manager'
import { dbToLinear } from '../../../packages/audiobus/conversion/decibels-to-linear'
import { velocityToGain } from '../../../packages/audiobus/conversion/velocity-to-gain'
import { createInstrumentById } from '../../../packages/audiobus/instruments/instrument-factory-ui'
import { INSTRUMENT_TYPE_SYNTH_OSCILLATOR, INSTRUMENT_TYPE_TONE_SYNTH } from '../../../packages/audiobus/instruments/instrument-types'

const tone = vi.hoisted(() => ({ voices: [] as any[] }))
vi.mock('../../../packages/audiobus/node_modules/tone', () => {
    class Voice {
        frequency = { rampTo: vi.fn() }
        volume = { value: 0, rampTo: vi.fn((value: number) => { this.volume.value = value }) }
        triggerAttack = vi.fn()
        triggerRelease = vi.fn()
        connect = vi.fn()
        constructor() { tone.voices.push(this) }
    }
    return { setContext: vi.fn(), Synth: Voice, MonoSynth: Voice, FMSynth: Voice, Sampler: Voice, PluckSynth: Voice }
})

function param(value = 0) {
    return { value, cancelScheduledValues: vi.fn(), linearRampToValueAtTime: vi.fn(), setValueAtTime: vi.fn() }
}
function context() {
    vi.stubGlobal('BiquadFilterNode', class {
        frequency = param()
        connect = vi.fn()
    })
    return {
        currentTime: 0,
        createGain: () => ({ gain: param(1), connect: vi.fn() }),
        createOscillator: () => ({ frequency: param(), connect: vi.fn(), start: vi.fn() }),
        createPeriodicWave: vi.fn(() => ({}))
    } as any
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); tone.voices.length = 0 })

describe('instrument output levels', () => {
    it.each([INSTRUMENT_TYPE_SYNTH_OSCILLATOR, INSTRUMENT_TYPE_TONE_SYNTH])('connects %s to the mixer before playing', async id => {
        vi.stubGlobal('window', { AudioContext: class {} })
        const mixer = {} as GainNode
        const instrument = await createInstrumentById(context(), id, { mixer })
        const output = instrument.output!
        expect(output.connect).toHaveBeenCalledExactlyOnceWith(mixer)
        await instrument.noteOn(60, 64)
        expect(instrument.output).toBe(output)
    })

    it('scales MIDI velocity without treating the quietest MIDI note as full volume', () => {
        expect(velocityToGain(1)).toBeCloseTo(1 / 127)
        expect(velocityToGain(127)).toBe(1)
        for (const value of [-1, NaN, Infinity]) expect(velocityToGain(value)).toBe(0)
        expect(velocityToGain(200)).toBe(1)
        expect(dbToLinear(0)).toBe(1)
        expect(dbToLinear(-20)).toBeCloseTo(0.1)
        expect(dbToLinear(-Infinity)).toBe(0)
    })

    it('keeps full-velocity chords bounded and does not boost release tails', async () => {
        vi.useFakeTimers()
        const synth = new PolySynth(context(), { class: SynthOscillator })
        await Promise.resolve()
        const manager = new OutputManager()
        manager.add(synth as any)
        const gain = (synth.output as any).gain.value
        for (let note = 48; note < 72; note++) await manager.noteOn(note, 127)
        let totalPeak = 0
        for (const voice of synth.instruments as any[]) {
            const peak = voice.gainNode.gain.linearRampToValueAtTime.mock.calls[0][0]
            expect(peak).toBeCloseTo(0.2)
            totalPeak += peak * gain
        }
        expect(totalPeak).toBeLessThan(1)
        for (let note = 48; note < 72; note++) manager.noteOff(note)
        await OutputManager.settled(synth as any)
        expect((synth.output as any).gain.value).toBe(gain)
        expect((synth.instruments as any[]).every(voice => voice.isNoteDown)).toBe(true)
        vi.advanceTimersByTime(901)
        expect((synth.instruments as any[]).some(voice => voice.isNoteDown)).toBe(false)
    })

    it('releases MIDI note zero and normalizes custom waveforms', () => {
        vi.useFakeTimers()
        const audio = context()
        const synth = new SynthOscillator(audio)
        synth.noteOn(0, 127)
        synth.allNotesOff()
        vi.advanceTimersByTime(901)
        expect(synth.isNoteDown).toBe(false)
        synth.oscillator = undefined as any
        synth.setWaveTable({ real: new Float32Array([0, 100]), imag: new Float32Array(2) } as never)
        expect(audio.createPeriodicWave.mock.calls[0][2]).toEqual({ disableNormalization: false })
    })

    it.each([ToneSynth, ToneMonoSynth, ToneFMSynth, ToneSampler, TonePluck].map(Instrument => ({ name: Instrument.name, Instrument })))('$name applies linear gain once and respects velocity', async ({ Instrument }) => {
        const instrument = new Instrument(context())
        const output = instrument.output
        expect(output).toBeDefined()
        await instrument.noteOn(60, 127)
        expect(instrument.output).toBe(output)
        expect(tone.voices[0].connect).toHaveBeenCalledWith(output)
        expect(instrument.output.gain.value).toBeCloseTo(0.2)
        instrument.gain = 0.1
        expect(instrument.output.gain.value).toBeCloseTo(0.1)
        expect(tone.voices[0].volume.value).toBe(0)
        instrument.volume = 0.5
        expect(instrument.volume).toBeCloseTo(0.5)
        await instrument.noteOn(62, 64)
        if (Instrument === TonePluck) {
            expect(instrument.output.gain.setValueAtTime.mock.lastCall[0]).toBeCloseTo(0.1 * 64 / 127)
        } else {
            expect(tone.voices[0].triggerAttack.mock.lastCall[2]).toBeCloseTo(64 / 127)
        }
    })
})
