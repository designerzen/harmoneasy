import type { AudioCommandInterface } from "../audio-command-interface";
import { Transformer } from "./abstract-transformer"
import {
    IONIAN_INTERVALS,
    DORIAN_INTERVALS,
    PHRYGIAN_INTERVALS,
    LYDIAN_INTERVALS,
    MIXOLYDIAN_INTERVALS,
    AEOLIAN_INTERVALS,
    LOCRIAN_INTERVALS
} from "../tuning/intervals.js"

export const ID_QUANTISE = "transposer"

interface Config {
    root: number,
    mode: string,
    [key: string]: any
}

export class TransformerTransposer extends Transformer<Config>{

    id = ID_QUANTISE

    get name(): string {
        return 'Transposer'
    }

    get fields() {
        return [
            {
                name: 'root',
                type: 'select',
                values: [
                    { name: 'A', value: 0 },
                    { name: 'A#/Bb', value: 1 },
                    { name: 'B', value: 2 },
                    { name: 'C', value: 3 },
                    { name: 'C#/Db', value: 4 },
                    { name: 'D', value: 5 },
                    { name: 'D#/Eb', value: 6 },
                    { name: 'E', value: 7 },
                    { name: 'F', value: 8 },
                    { name: 'F#/Gb', value: 9 },
                    { name: 'G', value: 10 },
                    { name: 'G#/Ab', value: 11 }
                ]
            },
            {
                name: 'mode',
                type: 'select',
                values: [
                    { name: 'Major (Ionian)', value: 'ionian' },
                    { name: 'Dorian', value: 'dorian' },
                    { name: 'Phrygian', value: 'phrygian' },
                    { name: 'Lydian', value: 'lydian' },
                    { name: 'Mixolydian', value: 'mixolydian' },
                    { name: 'Natural Minor (Aeolian)', value: 'aeolian' },
                    { name: 'Locrian', value: 'locrian' }
                ]
            }
        ]
    }

    constructor(config = { root: 0, mode: 'ionian' }) {
        super(config)
    }

    transform(commands:AudioCommandInterface[]):AudioCommandInterface[] {
        const intervalFormula = this.getIntervalFormulaForMode(this.config.mode)
        const rootNote = this.config.root

        console.log('ROOT NOTE', rootNote)

        // Create a set of all valid notes in the scale across all octaves
        const scaleNotes = this.generateScaleNotes(rootNote, intervalFormula)

        // Quantise each command's note to the closest scale note
        return commands.map(command => {
            const quantisedNote = this.findClosestNoteInScale(command.number, scaleNotes)

            // If the note is already in the scale, return unchanged
            if (quantisedNote === command.number) {
                return command
            }

            // Create a new command with the quantised note
            const quantisedCommand = { ...command }
            quantisedCommand.number = quantisedNote

            console.log(`Quantised note ${command.number} to ${quantisedNote}`)

            return quantisedCommand
        })
    }

    private generateScaleNotes(root: number, intervals: number[]): Set<number> {
        const scaleNotes = new Set<number>()

        // Generate notes for all octaves (MIDI range 0-127)
        for (let octave = 0; octave < 11; octave++) {
            for (const interval of intervals) {
                const note = root + (octave * 12) + interval
                if (note >= 0 && note <= 127) {
                    scaleNotes.add(note)
                }
            }
        }

        return scaleNotes
    }

    private findClosestNoteInScale(noteNumber: number, scaleNotes: Set<number>): number {
        // If the note is already in the scale, return it
        if (scaleNotes.has(noteNumber)) {
            return noteNumber
        }

        let closestNote = noteNumber
        let minDistance = Infinity

        // Search within a reasonable range (1 octave up and down)
        for (let offset = -12; offset <= 12; offset++) {
            const candidateNote = noteNumber + offset

            if (scaleNotes.has(candidateNote)) {
                const distance = Math.abs(offset)

                if (distance < minDistance) {
                    minDistance = distance
                    closestNote = candidateNote
                }
            }
        }

        return closestNote
    }

    private getIntervalFormulaForMode(mode: string): number[] {
        switch (mode) {
            case 'ionian':
                return IONIAN_INTERVALS
            case 'dorian':
                return DORIAN_INTERVALS
            case 'phrygian':
                return PHRYGIAN_INTERVALS
            case 'lydian':
                return LYDIAN_INTERVALS
            case 'mixolydian':
                return MIXOLYDIAN_INTERVALS
            case 'aeolian':
                return AEOLIAN_INTERVALS
            case 'locrian':
                return LOCRIAN_INTERVALS
            default:
                return IONIAN_INTERVALS
        }
    }


    setConfig(c: string, val: unknown) {
        this.config[c] = val
    }

}