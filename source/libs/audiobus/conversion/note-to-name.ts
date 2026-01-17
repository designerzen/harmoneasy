
/**
 * Convert MIDI note number (0-127) to note name (C-1, C0, ..., G9)
 */

import { noteNumberToKeyName } from "./note-to-key-name"
import { noteNumberToOctave } from "./note-to-octave"

// FIXME: CACHE
export const noteNumberToName = (noteNumber: number): string =>  {
	return `${noteNumberToKeyName(noteNumber)}${noteNumberToOctave(noteNumber)}`
}