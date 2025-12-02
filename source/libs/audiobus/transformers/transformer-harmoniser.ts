import type { AudioCommandInterface } from "../audio-command-interface";
import { Transformer } from "./abstract-transformer"
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
import { TUNING_MODE_IONIAN } from "../tuning/scales.js";
import { getIntervalFormulaForMode } from "../tuning/chords/modal-chords.js"
import type Timer from "../timing/timer.js";
import type { TransformerInterface } from "./transformer-interface.js";

export const ID_HARMONISER = "harmonise"

const NOTES_IN_CHORDS = 3

// Full keyboard with all notes
const keyboardKeys = (new Array(128)).fill("")
const ALL_KEYBOARD_NOTES = keyboardKeys.map((_, index) => new NoteModel(index))

interface Config {
    root: number,
    mode: string
}

const DEFAULT_OPTIONS: Config = {
    root: 69,
    mode: TUNING_MODE_IONIAN
}

export class TransformerHarmoniser extends Transformer<Config> implements TransformerInterface {

    id = ID_HARMONISER

    get name(): string {
        return 'Harmoniser'
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

    constructor(config = { root: 0, mode:TUNING_MODE_IONIAN }) {
        super( {...DEFAULT_OPTIONS, ...config} )
    }

    private harmonizeNote(command: AudioCommandInterface) {
        // Get the first audio command to generate chord from

        // Create note model from the first command's note number
        const noteModel = new NoteModel(command.number)

        // Get interval formula based on the configured mode
        const intervalFormula = getIntervalFormulaForMode(this.config.mode)

        // Calculate rotation: -1 if note is outside of the scale
        const rotation = findRotationFromNote(noteModel.noteNumber, this.config.root, intervalFormula)

        // If rotation is -1, the note is outside the scale, use 0 as fallback
        const finalRotation = rotation === -1 ? 0 : rotation

        // Generate chord based on the first command's note
        const chord = createChord(ALL_KEYBOARD_NOTES, intervalFormula, noteModel.noteNumber, finalRotation, NOTES_IN_CHORDS, true, true)
        const chordNotes = chord.map((c: NoteModel) => c.number)
        const intervals = convertToIntervalArray(chordNotes)

        console.log("Root", noteModel.noteNumber)
        console.log("Chord", noteModel, chord, chordNotes)
        console.log("Intervals?", intervals, intervalFormula)
        console.log("Chord Ionian", noteModel, MODES.createIonianChord(ALL_KEYBOARD_NOTES, noteModel.noteNumber, 0, 3))

        // Transform commands: create new audio commands for each chord note
        const harmonisedCommands: AudioCommandInterface[] = []

        for (const chordNote of chord) {
            const newCommand = new AudioCommand()
            // Copy properties from the original command
            newCommand.type = command.type
            newCommand.subtype = command.subtype
            newCommand.velocity = command.velocity
            newCommand.startAt = command.startAt
            newCommand.endAt = command.endAt
            newCommand.value = command.value
            newCommand.pitchBend = command.pitchBend
            newCommand.time = command.time
            newCommand.timeCode = command.timeCode
            newCommand.text = command.text

            // Set the new note number from the chord
            newCommand.number = chordNote.number

            harmonisedCommands.push(newCommand)
        }

        // Return the harmonised chord commands
        return harmonisedCommands
    }

    transform(commands:AudioCommandInterface[], timer:Timer ):AudioCommandInterface[] {

        if (commands.length === 0) {
            return commands
        }

        return commands.flatMap(c => this.harmonizeNote(c))
    }
}