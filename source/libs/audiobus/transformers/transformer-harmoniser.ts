/**
 * Harmoniser transposes into a specific key and mode
 */
import type { IAudioCommand } from "../audio-command-interface";
import { Transformer, type TransformerConfig } from "./abstract-transformer"
import NoteModel from "../note-model"
import AudioCommand from "../audio-command"
import { createChord, findRotationFromNote } from "../tuning/chords/chords.js"
import { convertToIntervalArray } from "../tuning/chords/describe-chord"
import * as MODES from "../tuning/chords/modal-chords.js"
import {
    IONIAN_INTERVALS,
    DORIAN_INTERVALS,
    PHRYGIAN_INTERVALS,
    LYDIAN_INTERVALS,
    MIXOLYDIAN_INTERVALS,
    AEOLIAN_INTERVALS,
    LOCRIAN_INTERVALS
} from "../tuning/intervals.js"
import { findClosestNoteInScale, generateNotesInScale, TUNING_MODE_IONIAN } from "../tuning/scales.js"
import { getIntervalFormulaForMode } from "../tuning/chords/modal-chords.js"
import type Timer from "../timing/timer.js"
import type { TransformerInterface } from "./interface-transformer.js"
import { TRANSFORMER_CATEGORY_TUNING } from "./transformer-categories.js";

export const ID_HARMONISER = "Harmoniser"

interface Config extends TransformerConfig {
	root: number,
	mode: string,
	[key: string]: any
}


const DEFAULT_OPTIONS: Config = {
	root: 69,
	mode: TUNING_MODE_IONIAN
}

export class TransformerHarmoniser extends Transformer<Config> implements TransformerInterface {

    protected type = ID_HARMONISER
	category = TRANSFORMER_CATEGORY_TUNING

    notesInScale: Set<number>

    get name(): string {
        return 'Harmoniser'
    }

	get description():string{
        return "Ensure that all played notes are in the specified scale."
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

    constructor(config = {}) {
        super( {...DEFAULT_OPTIONS, ...config} )
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
			// directly mutate the original command
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
		return generateNotesInScale( parseInt(this.config.root), intervalFormula)
	}

	/**
	 * 
	 * @param key 
	 * @param value 
	 */
	override setConfig(key: string, value: unknown): void {
		super.setConfig(key, value)
		this.notesInScale = this.setScaleNotes()
	}
}