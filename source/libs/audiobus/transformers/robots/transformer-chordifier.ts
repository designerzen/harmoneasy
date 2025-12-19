/**
 * Takes one note and a chord type and create
 * a chord with the given root note and chord type
 * and the length specified in simultaneous
 */
import { Transformer } from "./abstract-transformer.ts"
import NoteModel from "../../note-model.ts"
import AudioCommand from "../../audio-command.ts"
import { createChord, findRotationFromNote } from "../../tuning/chords/chords.js"
import { convertToIntervalArray } from "../../tuning/chords/describe-chord.ts"
import * as MODES from "../../tuning/chords/modal-chords.js"
import {
    IONIAN_INTERVALS,
    DORIAN_INTERVALS,
    PHRYGIAN_INTERVALS,
    LYDIAN_INTERVALS,
    MIXOLYDIAN_INTERVALS,
    AEOLIAN_INTERVALS,
    LOCRIAN_INTERVALS
} from "../../tuning/intervals.js"
import { TUNING_MODE_IONIAN } from "../../tuning/scales.ts"
import { getIntervalFormulaForMode } from "../../tuning/chords/modal-chords.js"

import type { IAudioCommand } from "../../audio-command-interface.ts"
import type Timer from "../../timing/timer.ts"
import type { ITransformer } from "./interface-transformer.ts"
import { TRANSFORMER_CATEGORY_TUNING } from "./transformer-categories.ts"
import { cloneAudioCommand } from "../../audio-command-factory.ts"

export const ID_CHORDIFIER = "Chordifier"

// Full keyboard with all notes
const keyboardKeys = (new Array(128)).fill("")
const ALL_KEYBOARD_NUMBERS = keyboardKeys.map((_, index) => index )
const ALL_KEYBOARD_NOTES = keyboardKeys.map((_, index) => new NoteModel(index))
const NOTES_IN_CHORDS = 3

interface Config {
    simultaneous: number,
    root: number,
    mode: string
}

const DEFAULT_OPTIONS: Config = {
    simultaneous:NOTES_IN_CHORDS,
    root: 0,
    mode: TUNING_MODE_IONIAN
}

export class TransformerChordifier extends Transformer<Config> implements ITransformer {

    protected type = ID_CHORDIFIER

	category = TRANSFORMER_CATEGORY_TUNING

    get name(): string {
        return 'Chordifier'
    }
       
    get description(): string{
        return "Adds harmonic triads to your notes"
    }

    get fields() {
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
                ],
                default: DEFAULT_OPTIONS.root
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
                ],
                default: DEFAULT_OPTIONS.mode
            }
        ]
    }

    constructor(config = {}) {
        super( {...DEFAULT_OPTIONS, ...config} )
    }

    private harmonizeNote(command: IAudioCommand) {

        // Fetch note model from the first command's note number
        const noteModel = ALL_KEYBOARD_NOTES[command.number]

        // Get interval formula based on the configured mode
        const intervalFormula = getIntervalFormulaForMode(this.config.mode)

        // Calculate rotation: -1 if note is outside of the scale
        const rotation = findRotationFromNote(noteModel.noteNumber, this.config.root, intervalFormula)

        // If rotation is -1, the note is outside the scale, use 0 as fallback
        const finalRotation = rotation === -1 ? 0 : rotation

        // Generate chord based on the first command's note
        const chordNotes:number[] = createChord(ALL_KEYBOARD_NUMBERS, intervalFormula, noteModel.noteNumber, finalRotation, this.config.simultaneous, true, true)
        
		
		// const intervals = convertToIntervalArray(chordNotes)

        // console.log("Root", noteModel.noteNumber)
        // console.log("Chord", noteModel, chordNotes )
        // console.log("Intervals?", intervals, intervalFormula)
        // console.log("Chord Ionian", noteModel, MODES.createIonianChord(ALL_KEYBOARD_NOTES, noteModel.noteNumber, 0, 3))

        // Transform commands: create new audio commands for each chord note
        const harmonisedCommands: IAudioCommand[] = chordNotes.map((chordNote:number) => {
            
			if (!command)
			{
				console.error("No command or clone method available")
				throw new Error("No command or clone method available")
			}

			const newCommand:IAudioCommand = cloneAudioCommand( command )
			
			// Set the new note number from the chord
            newCommand.number = chordNote
            return newCommand
        })

		command = null

        // Return the harmonised chord commands
        return harmonisedCommands
    }

    transform(commands:IAudioCommand[], timer:Timer ):IAudioCommand[] {

        if (!this.config.enabled || commands.length === 0)
        {
            return commands
        }

        return commands.flatMap(c => this.harmonizeNote(c))
    }
}