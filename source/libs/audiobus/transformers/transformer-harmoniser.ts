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

export const ID_QUANTISE = "harmonise"

const NOTES_IN_CHORDS = 3

// Full keyboard with all notes
const keyboardKeys = (new Array(128)).fill("")
const ALL_KEYBOARD_NOTES = keyboardKeys.map((_, index) => new NoteModel(index))

interface Config {
    root: number,
    mode: string
}

export class TransformerHarmoniser extends Transformer<Config>{

    id = ID_QUANTISE

    constructor(config = { root: 0, mode: 'ionian' }) {
        super(config)
    }

    transform(commands:AudioCommandInterface[]):AudioCommandInterface[] {
        if (commands.length === 0) {
            return commands
        }

        // Get the first audio command to generate chord from
        const firstCommand = commands[0]

        // Create note model from the first command's note number
        const noteModel = new NoteModel(firstCommand.number)

        // Get interval formula based on the configured mode
        const intervalFormula = this.getIntervalFormulaForMode(this.config.mode)

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
            newCommand.type = firstCommand.type
            newCommand.subtype = firstCommand.subtype
            newCommand.velocity = firstCommand.velocity
            newCommand.startAt = firstCommand.startAt
            newCommand.endAt = firstCommand.endAt
            newCommand.value = firstCommand.value
            newCommand.pitchBend = firstCommand.pitchBend
            newCommand.time = firstCommand.time
            newCommand.timeCode = firstCommand.timeCode
            newCommand.text = firstCommand.text

            // Set the new note number from the chord
            newCommand.number = chordNote.number

            harmonisedCommands.push(newCommand)
        }

        // Return the harmonised chord commands
        return harmonisedCommands
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

    get name(): string {
        return 'Harmonise'
    }

    setConfig(c: string, val: unknown) {
        this.config[c] = val
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
}