/**
 * Harmoniser transposes into a specific key and mode
 */
import * as MODES from "../../tuning/chords/modal-chords.js"
import { Transformer, type TransformerConfig } from "./abstract-transformer.ts"
import { TRANSFORMER_CATEGORY_TUNING } from "./transformer-categories.ts"
import { findClosestNoteInScale, generateNotesInScale, TUNING_MODE_IONIAN } from "../../tuning/scales.ts"
import { getIntervalFormulaForMode } from "../../tuning/chords/modal-chords.js"

import type Timer from "../../timing/timer.ts"
import type { ITransformer } from "./interface-transformer.ts"
import type { IAudioCommand } from "../../audio-command-interface.ts"

export const ID_HARMONISER = "Harmoniser"

interface Config extends TransformerConfig {
	root: number,
	mode: string
}

const DEFAULT_OPTIONS: Config = {
	root: 0,
	mode: TUNING_MODE_IONIAN
}

export class TransformerHarmoniser extends Transformer<Config> implements ITransformer {

    protected type = ID_HARMONISER
	category = TRANSFORMER_CATEGORY_TUNING

    notesInScale: Set<number>

    get name(): string {
        return 'Harmoniser'
    }

	get description():string{
        return "Ensure that all played notes are in the specified scale."
    }

    get fields(): FieldConfig[] {
        return [
             {
                name: 'enabled',
                type: 'select',
                values: [
                    { name: 'On', value: 1 },
                    { name: 'Off', value: 0 }
                ],
                default: 1
            },
            {
                name: 'root',
                type: 'select',
                values: [
                    { name: 'A', value: 9 },
                    { name: 'A#/Bb', value: 10 },
                    { name: 'B', value: 11 },
                    { name: 'C', value: 0 },
                    { name: 'C#/Db', value: 1 },
                    { name: 'D', value: 2 },
                    { name: 'D#/Eb', value: 3 },
                    { name: 'E', value: 4 },
                    { name: 'F', value: 5 },
                    { name: 'F#/Gb', value: 6 },
                    { name: 'G', value: 7 },
                    { name: 'G#/Ab', value: 8 }
                ],
                default: DEFAULT_OPTIONS.root
            },
            {
                name: 'mode',
                type: 'select',
                values: [
                    { name: 'Major (Ionian)', value:MODES.IONIAN },
                    { name: 'Dorian', value: MODES.DORIAN },
                    { name: 'Phrygian', value: MODES.PHRYGIAN },
                    { name: 'Lydian', value: MODES.LYDIAN },
                    { name: 'Mixolydian', value: MODES.MIXOLYDIAN },
                    { name: 'Natural Minor (Aeolian)', value: MODES.AEOLIAN },
                    { name: 'Locrian', value: MODES.LOCRIAN }
                ],
                default: DEFAULT_OPTIONS.mode
            }
        ]
    }

    constructor(config = {}) {
        super( {...DEFAULT_OPTIONS, ...config} )
        this.notesInScale = this.setScaleNotes()
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
			command.number = transposedNote 
			return command
		})
	}

	/**
	 * Create a set of all valid notes in the scale across all octaves
	 * Sets the scale that this transposer operates im
	 * Currently takes a formula and a root note as the 
	 * inputs to decide what keys are permissable
	 */
	private setScaleNotes ():Set<number>{
		const intervalFormula:number[] = getIntervalFormulaForMode(this.config.mode)
		const midiRoot = parseInt(this.config.root)
		return generateNotesInScale( midiRoot, intervalFormula)
	}

	/**
	 * Override and use to set notes in scale Set
	 * @param key 
	 * @param value 
	 */
	override setConfig(key: string, value: unknown): void {
		super.setConfig(key, value)
		this.notesInScale = this.setScaleNotes()
	}
}