import { describe, expect, it } from 'vitest'
import { tranformerFactory, TRANSFORMER_TYPE } from '../../../packages/audiobus/io/transformer-factory'
import { TransformerVelocityShaper } from '../../../packages/audiobus/io/transformers/transformer-velocity-shaper'
import { TransformerProbabilityGate } from '../../../packages/audiobus/io/transformers/transformer-probability-gate'
import { TransformerNoteMapper, parseNoteMap } from '../../../packages/audiobus/io/transformers/transformer-note-mapper'
import { TransformerStrummer } from '../../../packages/audiobus/io/transformers/transformer-strummer'
import { TransformerLatch } from '../../../packages/audiobus/io/transformers/transformer-latch'
import { TransformerEuclideanGate, euclideanStep } from '../../../packages/audiobus/io/transformers/transformer-euclidean-gate'
import { TransformerVoiceLeader, leadVoices } from '../../../packages/audiobus/io/transformers/transformer-voice-leader'
import { TransformerCCAnimator } from '../../../packages/audiobus/io/transformers/transformer-cc-animator'
import { TransformerOrnamenter } from '../../../packages/audiobus/io/transformers/transformer-ornamenter'
import { TransformerPhraseRecombiner } from '../../../packages/audiobus/io/transformers/transformer-phrase-recombiner'
import { TransformerLegato } from '../../../packages/audiobus/io/transformers/transformer-legato'
import { TransformerCCMapper } from '../../../packages/audiobus/io/transformers/transformer-cc-mapper'
import TransformerManager from '../../../packages/audiobus/io/transformer-manager-worker'
import { TransformerChordifier } from '../../../packages/audiobus/io/transformers/transformer-chordifier'
import { createAudioCommand } from '../../../packages/audiobus/audio-command-factory'
import { NOTE_ON, NOTE_OFF, CONTROL_CHANGE } from '../../../packages/audiobus/commands'
import { commandToMidi } from '../../../packages/audiobus/midi/midi-command-conversion'
import type { IAudioCommand } from '../../../packages/audiobus/audio-command-interface'
import type { ITimerControl as Timer } from 'netronome'

const clock = (now = 0, bpm = 120) => ({ now, bpm, BPM: bpm } as Timer)
const command = (type: string, pitch: number, at = 0, channel = 1, from = 'keyboard', velocity = 100) =>
    Object.assign(createAudioCommand(type, pitch, at, from), { channel, velocity })
const on = (pitch = 60, at = 0, channel = 1, from = 'keyboard', velocity = 100) => command(NOTE_ON, pitch, at, channel, from, velocity)
const off = (pitch = 60, at = 0, channel = 1, from = 'keyboard') => command(NOTE_OFF, pitch, at, channel, from, 0)
const ons = (commands: IAudioCommand[]) => commands.filter(command => command.type === NOTE_ON)
const offs = (commands: IAudioCommand[]) => commands.filter(command => command.type === NOTE_OFF)
const cc = (number: number, value: number, at = 0) => Object.assign(command(CONTROL_CHANGE, number, at), { value })

describe('expressive MIDI Transformers', () => {
    it('shapes only attack velocity, clamps limits and accepts UI string values', () => {
        const effect = new TransformerVelocityShaper({ minimum: 20, maximum: 100, curve: 0.5 })
        effect.setConfig('fixed', '80')
        const input = on(60, 0, 3, 'a', 10)
        expect(effect.transform([input], clock())[0]).toMatchObject({ velocity: 80, channel: 3 })
        expect(input.velocity).toBe(10)
        expect(effect.transform([off(60, 0.1, 3, 'a')], clock(0.1))[0]).toMatchObject({ type: NOTE_OFF, velocity: 0 })
        expect(effect.transform([cc(1, 64)], clock())).toEqual([cc(1, 64)])
    })
    it('matches probability decisions by source, channel and repeated pitch, even after settings change', () => {
        const effect = new TransformerProbabilityGate({ chance: 0 })
        expect(effect.transform([on()], clock())).toEqual([])
        effect.setConfig('chance', 100)
        expect(ons(effect.transform([on(60, 0, 2), on(60, 0, 1, 'other'), on()], clock()))).toHaveLength(3)
        expect(effect.transform([off()], clock())).toEqual([])
        expect(offs(effect.transform([off(60, 0, 2), off(60, 0, 1, 'other'), off()], clock()))).toHaveLength(3)
    })
    it('repeats a seeded probability sequence after reset', () => {
        const effect = new TransformerProbabilityGate({ chance: 50, seed: 11 })
        const run = () => Array.from({ length: 40 }, (_, i) => ons(effect.transform([on(60, i), off(60, i)], clock(i))).length)
        const first = run()
        effect.reset()
        expect(run()).toEqual(first)
        expect(new Set(first).size).toBe(2)
    })
    it('layers mapped notes and releases the original mapping after config changes', () => {
        const effect = new TransformerNoteMapper({ mapping: '36:48; 38:50+62', channel: 10 })
        expect(effect.transform([on(38)], clock()).map(commandToMidi)).toEqual([[0x99, 50, 100], [0x99, 62, 100]])
        effect.setConfig('mapping', '38:70')
        effect.setConfig('channel', '4')
        expect(effect.transform([off(38)], clock()).map(commandToMidi)).toEqual([[0x89, 50, 0], [0x89, 62, 0]])
        expect(() => parseNoteMap('36:128')).toThrow()
        expect(() => parseNoteMap('incorrect')).toThrow()
    })
    it('maps notes to CC attack/release pairs without stale native MIDI bytes', () => {
        const effect = new TransformerNoteMapper({ mapping: '60:11', output: 'cc' })
        const input = Object.assign(on(), { raw: Uint8Array.from([0x90, 60, 100]), ump: [123], umpOriginal: { type: NOTE_ON, number: 60, velocity: 100, value: 60 } })
        const result = effect.transform([input], clock())[0]
        expect(commandToMidi(result)).toEqual([0xb0, 11, 100])
        expect(result.ump).toBeUndefined()
        expect(effect.transform([off()], clock()).map(commandToMidi)).toEqual([[0xb0, 11, 0]])
    })
    it('collects individually arriving chord notes, strums once and cancels unheard attacks on release', () => {
        const effect = new TransformerStrummer({ collect: 20, spread: 100, direction: 'up', falloff: 0 })
        expect(effect.transform([on(67)], clock())).toEqual([])
        expect(effect.transform([on(60, 0.005)], clock(0.005))).toEqual([])
        expect(effect.transform([on(64, 0.01)], clock(0.01))).toEqual([])
        expect(ons(effect.tick(0.02, clock(0.02))).map(command => command.number)).toEqual([60])
        expect(effect.transform([off(67, 0.03)], clock(0.03))).toEqual([])
        expect(ons(effect.tick(0.075, clock(0.075))).map(command => command.number)).toEqual([64])
        expect(ons(effect.tick(0.2, clock(0.2)))).toEqual([])
        expect(offs(effect.transform([off(60, 0.2), off(64, 0.2)], clock(0.2))).map(command => command.number)).toEqual([60, 64])
    })
    it('alternates chord stroke directions', () => {
        const effect = new TransformerStrummer({ collect: 0, spread: 0 })
        expect(ons(effect.transform([on(60), on(64)], clock())).map(command => command.number)).toEqual([60, 64])
        effect.transform([off(60, 1), off(64, 1)], clock(1))
        expect(ons(effect.transform([on(60, 2), on(64, 2)], clock(2))).map(command => command.number)).toEqual([64, 60])
    })
    it('holds and replaces a whole chord, then releases on disable', () => {
        const effect = new TransformerLatch()
        effect.transform([on(60), on(64)], clock())
        expect(effect.transform([off(60, 0.1), off(64, 0.1)], clock(0.1))).toEqual([])
        const replacement = effect.transform([on(62, 1), on(65, 1)], clock(1))
        expect(offs(replacement).map(command => command.number)).toEqual([60, 64])
        expect(ons(replacement).map(command => command.number)).toEqual([62, 65])
        effect.setConfig('enabled', '0')
        expect(offs(effect.tick(1.1, clock(1.1))).map(command => command.number)).toEqual([62, 65])
        expect(effect.tick(5, clock(5))).toEqual([])
    })
    it('toggles latched pitches independently on each MIDI channel', () => {
        const effect = new TransformerLatch({ mode: 'toggle' })
        effect.transform([on(), on(60, 0, 2), off(), off(60, 0, 2)], clock())
        expect(effect.transform([on(60, 1)], clock(1))).toEqual([expect.objectContaining({ type: NOTE_OFF, channel: 1 })])
        effect.setConfig('enabled', 0)
        expect(offs(effect.tick(1, clock(1)))).toEqual([expect.objectContaining({ channel: 2 })])
    })
    it('generates a Euclidean rhythm while held, follows tempo and stops on release', () => {
        expect(Array.from({ length: 8 }, (_, i) => euclideanStep(i, 8, 3))).toEqual([true, false, false, true, false, false, true, false])
        const effect = new TransformerEuclideanGate({ steps: 8, pulses: 3, rate: 0.25, gate: 50 })
        const result = [...effect.transform([on(60, 0, 4)], clock()), ...effect.tick(0.99, clock(0.99))]
        expect(ons(result).map(command => command.startAt)).toEqual([0, 0.375, 0.75])
        expect(result.every(command => command.channel === 4)).toBe(true)
        effect.transform([off(60, 1, 4)], clock(1))
        expect(ons(effect.tick(3, clock(3)))).toEqual([])
        const slower = new TransformerEuclideanGate({ steps: 1, pulses: 1, rate: 1 })
        slower.transform([on()], clock(0, 60))
        expect(ons(slower.tick(1.01, clock(1.01, 60)))[0].startAt).toBe(1)
    })
    it('selects smooth chord octaves while preserving pitch classes and releases mapped pitches', () => {
        expect(leadVoices([67, 71, 74], [60, 64, 67], 48, 84, 12, true)).toEqual([67, 59, 62])
        const effect = new TransformerVoiceLeader({ collect: 0 })
        effect.transform([on(60), on(64), on(67)], clock())
        effect.transform([off(60, 0.5), off(64, 0.5), off(67, 0.5)], clock(0.5))
        const pitches = ons(effect.transform([on(67, 1), on(71, 1), on(74, 1)], clock(1))).map(command => command.number)
        expect(pitches.map(pitch => pitch % 12)).toEqual([7, 11, 2])
        expect(offs(effect.transform([off(67, 2), off(71, 2), off(74, 2)], clock(2))).map(command => command.number)).toEqual(pitches)
    })
    it('animates one CC stream per route, restores it on final release and cancels later work', () => {
        const effect = new TransformerCCAnimator({ waveform: 'ramp', beats: 1, maximum: 100, restore: 10, retrigger: 0 })
        const first = effect.transform([on(60), on(64)], clock())
        expect(first.filter(command => command.type === CONTROL_CHANGE)).toHaveLength(1)
        expect(effect.tick(0.041, clock(0.041)).map(command => command.value)).toEqual([4, 8])
        expect(effect.transform([off(60, 0.05)], clock(0.05)).some(command => command.type === CONTROL_CHANGE)).toBe(false)
        const last = effect.transform([off(64, 0.06)], clock(0.06))
        expect(last).toContainEqual(expect.objectContaining({ type: CONTROL_CHANGE, value: 10 }))
        expect(effect.tick(5, clock(5))).toEqual([])
    })
    it('adds cancellable ornaments with correctly paired note-offs', () => {
        const effect = new TransformerOrnamenter({ style: 'mordent', interval: 2, rate: 0.125 })
        effect.transform([on(60, 0, 7)], clock())
        expect(effect.tick(0.063, clock(0.063))).toEqual([
            expect.objectContaining({ type: NOTE_OFF, number: 60, channel: 7 }),
            expect.objectContaining({ type: NOTE_ON, number: 62, channel: 7 }),
        ])
        expect(effect.transform([off(60, 0.07, 7)], clock(0.07))).toEqual([expect.objectContaining({ type: NOTE_OFF, number: 62 })])
        expect(effect.tick(2, clock(2))).toEqual([])
    })
    it('connects a melody, keeps routes separate and ends the final note at maximum hold', () => {
        const effect = new TransformerLegato({ overlap: 20, hold: 2 })
        effect.transform([on(), on(72, 0, 2)], clock())
        expect(effect.transform([off(60, 0.1)], clock(0.1))).toEqual([])
        expect(ons(effect.transform([on(62, 0.2)], clock(0.2)))).toHaveLength(1)
        expect(offs(effect.tick(0.221, clock(0.221)))).toEqual([expect.objectContaining({ number: 60, channel: 1 })])
        expect(offs(effect.tick(1.21, clock(1.21))).map(command => command.number)).toEqual([72, 62])
    })
    it('captures one phrase and replays rotated pitches with preserved timing and duration', () => {
        const effect = new TransformerPhraseRecombiner({ beats: 2, loop: 0, dimension: 'pitch', rotation: 1, level: 100 })
        effect.transform([on(60)], clock())
        effect.transform([off(60, 0.1), on(64, 0.25), off(64, 0.4), on(67, 0.5), off(67, 0.7)], clock(0.7))
        const result = effect.tick(2, clock(2))
        expect(ons(result).map(command => [command.number, command.startAt])).toEqual([[64, 1], [67, 1.25], [60, 1.5]])
        expect(offs(result).map(command => command.startAt)).toEqual([1.1, 1.4, 1.7])
        expect(effect.tick(4, clock(4))).toEqual([])
    })
    it('cancels phrase loops when playing a new phrase or resetting transport', () => {
        const effect = new TransformerPhraseRecombiner({ beats: 1 })
        effect.transform([on()], clock())
        effect.transform([off(60, 0.1)], clock(0.1))
        effect.tick(0.6, clock(0.6))
        expect(ons(effect.transform([on(72, 0.75)], clock(0.75))).map(command => command.number)).toEqual([72])
        expect(ons(effect.tick(1.1, clock(1.1)))).toEqual([])
        effect.reset()
        expect(effect.tick(10, clock(10))).toEqual([])
    })
    it('remaps and inverts CC values and leaves system controllers alone', () => {
        const effect = new TransformerCCMapper({ input: 1, output: 11, minimum: 127, maximum: 0, channel: 3 })
        expect(effect.transform([cc(1, 127)], clock()).map(commandToMidi)).toEqual([[0xb2, 11, 0]])
        expect(effect.transform([cc(123, 0)], clock()).map(commandToMidi)).toEqual([[0xb0, 123, 0]])
        effect.setConfig('block', '1')
        expect(effect.transform([cc(1, 10)], clock())).toEqual([])
    })
    it('treats zero-velocity attacks as releases and keeps panic messages scoped to their source and channel', () => {
        const effect = new TransformerEuclideanGate({ steps: 1, pulses: 1, rate: 1 })
        effect.transform([on(60), on(64, 0, 2), on(67, 0, 1, 'other')], clock())
        const panic = effect.transform([cc(123, 0, 0.01)], clock(0.01))
        // The CC helper uses the same keyboard source as the note helper.
        expect(offs(panic).map(command => command.number)).toEqual([60])
        expect(ons(effect.tick(0.51, clock(0.51))).map(command => command.number)).toEqual([64, 67])
        effect.transform([on(64, 0.6, 2, 'keyboard', 0), off(67, 0.6, 1, 'other')], clock(0.6))
        expect(ons(effect.tick(2, clock(2)))).toEqual([])
    })
    it('keeps generated controllers out of legacy chord effects and processes downstream notes on clock ticks', async () => {
        const manager = new TransformerManager([new TransformerStrummer({ collect: 20, spread: 0 }), new TransformerVelocityShaper({ fixed: 70 })])
        expect(await manager.transform([on()], clock())).toEqual([])
        expect(manager.advanceTime(0.021, clock(0.021))).toEqual([expect.objectContaining({ type: NOTE_ON, velocity: 70 })])
        const controls = new TransformerManager([new TransformerNoteMapper({ mapping: '60:11', output: 'cc' }), new TransformerChordifier()])
        expect((await controls.transform([on()], clock())).map(commandToMidi)).toEqual([[0xb0, 11, 100]])
        const mapper = new TransformerManager([new TransformerChordifier(), new TransformerCCMapper()])
        expect(mapper.transformMidiControls([cc(1, 75)], clock()).map(commandToMidi)).toEqual([[0xb0, 11, 75]])
    })
    it('keeps controller ordering around note groups and cancels a panicked chord collection window', async () => {
        const legacy = new TransformerManager([new TransformerChordifier()])
        const control = cc(64, 127)
        expect((await legacy.transform([control, on()], clock()))[0]).toBe(control)
        const strum = new TransformerStrummer({ collect: 50, spread: 0 })
        strum.transform([on()], clock())
        strum.transform([cc(123, 0, 0.01)], clock(0.01))
        strum.transform([on(64, 0.02)], clock(0.02))
        expect(strum.tick(0.051, clock(0.051))).toEqual([])
        expect(ons(strum.tick(0.071, clock(0.071))).map(command => command.number)).toEqual([64])
    })
    it('saves and restores all new types, settings and numeric UI values through the factory', () => {
        const ids = Object.values(TRANSFORMER_TYPE).slice(0, 12)
        const manager = new TransformerManager(ids.map(id => tranformerFactory(id)))
        const exported = manager.exportConfig()
        const restored = new TransformerManager([])
        restored.importConfig(exported)
        expect(restored.activeTransformers.map(effect => JSON.parse(effect.exportConfig()).type)).toEqual(ids)
        for (const effect of restored.activeTransformers) {
            expect(effect.fields.length).toBeGreaterThan(1)
            effect.setConfig('enabled', '0')
            expect(effect.transform([on()], clock())).toEqual([on()])
            effect.destroy()
            expect(effect.tick?.(10, clock(10))).toEqual([])
        }
    })
})
