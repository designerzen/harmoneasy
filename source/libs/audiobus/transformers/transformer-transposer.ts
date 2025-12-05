/**
 * Forces by transposition the entered note into
 * the specified key and scale by finding the nearest note
 */
import { Transformer, type TransformerConfig } from "./abstract-transforme.ts"
import { findClosestNoteInScale, generateNotesInScale, TUNING_MODE_IONIAN } from "../tuning/scales.js"
import { getIntervalFormulaForMode } from "../tuning/chords/modal-chords.js"

import type { TransformerInterface } from "./interface-transformer.js"
import type { AudioCommandInterface } from "../audio-command-interface"
import type Timer from "../timing/timer.js"

export const ID_QUANTISE = "transposer"

interface Config extends TransformerConfig {
    root: number,
    mode: string,
    [key: string]: any
}

const DEFAULT_OPTIONS: Config = {
    root: 69,
    mode: TUNING_MODE_IONIAN
}

export class TransformerTransposer extends Transformer<Config> implements TransformerInterface {

    id = ID_QUANTISE

    notesInScale: Set<number>

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

    constructor(config = { root: 0, mode: TUNING_MODE_IONIAN }) {
        super( {...DEFAULT_OPTIONS, ...config} )
    }

    transform(commands:AudioCommandInterface[], timer:Timer ):AudioCommandInterface[] {
           
        if (!this.config.enabled || commands.length === 0)
        {
            return commands
        }

        // Quantise each command's note to the closest scale note
        return commands.map(command => {
            const quantisedNote = findClosestNoteInScale(command.number, this.notesInScale )

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


    private setScaleNotes (){
        // Create a set of all valid notes in the scale across all octaves
        const intervalFormula = getIntervalFormulaForMode(this.config.mode)
        this.notesInScale = generateNotesInScale(this.config.root, intervalFormula)
    }

    override setConfig(c: string, val: unknown): void {
        this.setScaleNotes()
        super.setConfig(c, val)
    }
}