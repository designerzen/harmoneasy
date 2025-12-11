/**
 * Forces by transposition the entered note into
 * the specified key and scale by finding the nearest note
 */
import { Transformer, type TransformerConfig } from "./abstract-transformer.ts"
import { findClosestNoteInScale, generateNotesInScale, TUNING_MODE_IONIAN } from "../tuning/scales.js"
import { getIntervalFormulaForMode } from "../tuning/chords/modal-chords.js"

import type { TransformerInterface } from "./interface-transformer.js"
import type { IAudioCommand } from "../audio-command-interface"
import type Timer from "../timing/timer.js"
import { TRANSFORMER_CATEGORY_TUNING } from "./transformer-categories.ts"

export const ID_TRANSPOSER = "Transposer"

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

    protected type = ID_TRANSPOSER
	category = TRANSFORMER_CATEGORY_TUNING

    notesInScale: Set<number>

    get name(): string {
        return 'Transposer'
    }

	get description(): string{
        return "Transposes the note by the specified parammeters."
    }

    get fields() {
        return [
             {
                name: 'enabled',
                type: 'select',
                values: [
                    { name: 'On', value: 1 },
                    { name: 'Off', value: 0 }
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
        super( { ...DEFAULT_OPTIONS, ...config } )
    }

    /**
     * 
     * @param commands 
     * @param timer 
     * @returns 
     */
    transform(commands:IAudioCommand[], timer:Timer ):IAudioCommand[] {
           
        if (!this.config.enabled || commands.length === 0)
        {
            return commands
        }

        // Quantise each command's note to the closest scale note
        return commands.map(command => {
            const transposedNote = findClosestNoteInScale(command.number, this.notesInScale )

            // If the note is already in the scale, return unchanged
            if (transposedNote === command.number) {
                return command
            }

            // Create a new command with the quantised note
            const quantisedCommand = command.clone()
            quantisedCommand.number = transposedNote

            //console.log(`Transposed note ${command.number} to ${transposedNote}`)
            return quantisedCommand
        })
    }

    /**
     * Create a set of all valid notes in the scale across all octaves
     * Sets the scale that this transposer operates im
     * Currently takes a formula and a root note as the 
     * inputs to decide what keys are permissable
     */
    private setScaleNotes (){
        const intervalFormula:number[] = getIntervalFormulaForMode(this.config.mode)
        this.notesInScale = generateNotesInScale(this.config.root, intervalFormula)
    }

    /**
     * 
     * @param c 
     * @param val 
     */
    override setConfig(c: string, val: unknown): void {
        super.setConfig(c, val)
        this.setScaleNotes()
    }
}