import { describe, expect, it } from 'vitest'
import { PRESETS, createPresetTransformers } from '../../../packages/audiobus/io/transformer-presets'
import { NOTE_ON, NOTE_OFF } from '../../../packages/audiobus/commands'
import { createAudioCommand } from '../../../packages/audiobus/audio-command-factory'

const play = (name: string, number: number) => createPresetTransformers(PRESETS.find(preset => preset.name === name)!)
    .reduce((commands, transformer) => transformer.transform(commands, { BPM: 120, bpm: 120 } as any),
        [createAudioCommand(NOTE_ON, number, 1)])

describe('musical preset settings', () => {
    it('creates independent configured instances without changing the catalogue', () => {
        for (const preset of PRESETS) {
            const first = createPresetTransformers(preset)
            const second = createPresetTransformers(preset)
            first.forEach((transformer, index) => {
                expect(transformer).not.toBe(second[index])
                expect(JSON.parse(transformer.exportConfig()).type).toBe(preset.steps[index].type)
            })
            first[0].setConfig('enabled', false)
            expect(second[0].options.enabled).toBe(true)
        }
    })
    it('maps melodies to their advertised keys and transposes registers', () => {
        expect(play('C Major Sketchbook', 61)[0].number).toBe(60)
        expect(play('A Minor Nocturne', 68)[0].number).toBe(67)
        expect(play('D Dorian Session', 70)[0].number).toBe(69)
        expect(play('Bass Register', 60)[0].number).toBe(48)
        expect(play('Fifth Above', 60)[0].number).toBe(67)
    })
    it('builds major and minor chords in the advertised keys', () => {
        expect(play('Classic Chord', 60).map(note => note.number)).toEqual([60, 64, 67])
        expect(play('Minor Chord Diary', 69).map(note => note.number)).toEqual([69, 72, 76])
        expect(play('Seventh Heaven', 60).map(note => note.number)).toEqual([60, 64, 67, 71])
    })
    it('uses actual configured spacing for arpeggios, repetitions and delays', () => {
        const arp = play('Chord Arpeggiator', 60).filter(note => note.type === NOTE_ON)
        expect(arp.map(note => note.startAt)).toEqual([1, 1.125, 1.25])
        const repeats = play('Ratchet Fill', 60).filter(note => note.type === NOTE_ON)
        expect(repeats).toHaveLength(8)
        expect(repeats[1].startAt - repeats[0].startAt).toBe(.0625)
        expect(play('Late Answer', 60)[0].startAt).toBe(1.5)
    })
})


it('creates tempo-synced acid bass figures with short gates', () => {
    const notes = play('Acid House', 69)
    const on = notes.filter(note => note.type === NOTE_ON)
    const off = notes.filter(note => note.type === NOTE_OFF)
    expect(on.map(note => note.number)).toEqual([57, 60, 64])
    expect(on.map(note => note.startAt)).toEqual([1, 1.125, 1.25])
    expect(off.map(note => note.startAt)).toEqual([1.0625, 1.1875, 1.3125])
})
