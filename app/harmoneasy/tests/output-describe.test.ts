// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { describeChord, precacheChordDescriptions } from '../../../packages/audiobus/tuning/chords/describe-chord'
import * as noteNames from '../../../packages/audiobus/conversion/note-to-name'
import OutputDescribe from '../../../packages/audiobus/io/outputs/output-describe'
import { createOutputById } from '../../../packages/audiobus/io/output-factory'
import { deviceDefinition } from '../../../packages/audiobus/io/device-definition'

describe('chord descriptions', () => {
    it('reuses normalized voicings without allowing callers to corrupt cached results', () => {
        const chord = describeChord([60, 64, 67])
        expect(describeChord([67, 60, 64, 60, NaN])).toBe(chord)
        expect(Object.isFrozen(chord)).toBe(true)
        expect(Object.isFrozen(chord.notes)).toBe(true)
        const higher = describeChord([72, 76, 79])
        expect(higher.name).toBe(chord.name)
        expect(higher.notes).toEqual(['C5', 'E5', 'G5'])
        expect(higher.bass).toBe(72)
    })

    it('prewarms common chords in every key and inversion only once', () => {
        precacheChordDescriptions()
        const convert = vi.spyOn(noteNames, 'noteNumberToName')
        try {
            precacheChordDescriptions()
            for (let root = 0; root < 12; root++) {
                describeChord([60 + root, 64 + root, 67 + root])
                describeChord([64 + root, 67 + root, 72 + root])
                describeChord([60 + root, 63 + root, 67 + root, 70 + root])
            }
            expect(convert).not.toHaveBeenCalled()
        } finally { convert.mockRestore() }
    })

    it.each([
        [[60, 64, 67], 'C major'],
        [[60, 63, 67, 70], 'C minor seventh'],
        [[60, 64, 67, 71, 74], 'C major ninth'],
        [[60, 64, 67, 70, 73], 'C dominant seventh flat nine'],
        [[60, 64, 66, 70, 73], 'C dominant seventh flat five flat nine'],
        [[60, 63, 67, 70, 74, 77], 'C minor eleventh'],
        [[60, 64, 67, 70, 74, 77, 81], 'C dominant thirteenth'],
        [[60, 64, 67, 70, 78], 'C dominant seventh with added sharp eleventh'],
        [[72, 67, 64, 60, 60], 'C major'],
    ])('names %j', (notes, name) => {
        expect(describeChord(notes).name).toBe(name)
    })

    it('finds the root independently of the bass', () => {
        expect(describeChord([64, 67, 72])).toMatchObject({
            root: 0, bass: 64, matched: true,
            description: 'C major, first inversion, with E in the bass.',
        })
    })

    it('describes silence, single notes, intervals and unclassified clusters', () => {
        expect(describeChord([]).name).toBe('No active notes')
        expect(describeChord([61]).description).toBe('A single C#4 note.')
        expect(describeChord([60, 72]).description).toContain('2 octaves')
        expect(describeChord([60, 61]).description).toBe('A minor second above C4.')
        expect(describeChord([60, 61, 62]).name).toBe('Unclassified chord')
        expect(describeChord([NaN, -1, 128, 60.5]).notes).toEqual([])
    })
})

describe('Describe output', () => {
    it('skips redundant note events and reuses the current analysis', async () => {
        const output = new OutputDescribe()
        output.noteOn(60)
        const gui = await output.createGui()
        const observer = new MutationObserver(() => {})
        observer.observe(gui, { childList: true, subtree: true, characterData: true })
        const chord = output.chord
        output.noteOn(60, 0.5)
        output.noteOff(61)
        expect(output.chord).toBe(chord)
        expect(observer.takeRecords()).toHaveLength(0)
        output.noteOn(64)
        expect(output.chord).not.toBe(chord)
        expect(observer.takeRecords().length).toBeGreaterThan(0)
        observer.disconnect()
    })

    it('is available through the output factory and persists its type', async () => {
        const output = await createOutputById('describe')
        expect(output.name).toBe('Describe')
        expect(deviceDefinition(output)).toMatchObject({ factory: 'output', type: 'describe' })
    })

    it('updates its live display and preserves notes when recreating its GUI', async () => {
        const output = new OutputDescribe()
        output.noteOn(60, 1)
        output.noteOn(64, 1)
        output.noteOn(67, 1)
        const gui = await output.createGui()
        expect(gui.textContent).toContain('C major')
        expect(gui.textContent).toContain('Notes: C4, E4, G4')
        expect(gui.getAttribute('aria-live')).toBe('polite')
        output.noteOn(70, 1)
        expect(gui.textContent).toContain('C dominant seventh')
        output.noteOn(70, 0)
        expect(gui.textContent).toContain('C major, root position')
        await output.destroyGui()
        const recreated = await output.createGui()
        expect(recreated.textContent).toContain('C major')
        output.noteOff(64)
        expect(recreated.textContent).toContain('C power')
        output.allNotesOff()
        expect(recreated.textContent).toContain('No active notes')
    })
})
