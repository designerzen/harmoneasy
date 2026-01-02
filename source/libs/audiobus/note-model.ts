/**
 * Tonic
 * Supertonic
 * Mediant
 * Subdominant
 * Dominant
 * Submediant
 * Leading Tone
 * Sub-Tonic
 * 
 * Charles Goes Dancing At Every Big Fun Celebration.
 * From G D A E B...
 * 
 */

const ROOT_FREQUENCY = 440 //frequency of A (coomon value is 440Hz)
const ROOT_F_BY_32 = ROOT_FREQUENCY / 32
export const noteNumberToFrequency = (noteNumber:number) => ROOT_F_BY_32 * (2 ** ((noteNumber - 9) / 12))

const KEY_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]
const SOUNDS_SOLFEGE = ["Do","Do #","Re","Re #","Mi","Fa","Fa #","Sol","Sol #","La","La #","Si"]

// const SHARPS = [1,3,6,8,10]
const SHARPS = [false, true, false, true, false, false, true, false, true, false, true, false]
// const FLATS = [false, true, false, true, false, false, true, false, true, false, true, false]

export const QUANTITY_NOTES = KEY_NAMES.length

export const noteNumberToKeyName = (noteNumber:number) => KEY_NAMES[noteNumber % QUANTITY_NOTES]
export const noteNumberToOctave = (noteNumber:number) => Math.floor(noteNumber / QUANTITY_NOTES) - 1
export const isSharp = (noteNumber:number) => SHARPS[noteNumber % QUANTITY_NOTES] 
export const isFlat = (noteNumber:number) => isSharp(noteNumber)

// convert a letter and an octave to a noteNumber
export const keyAndOctaveAsNoteNumber = (key, octave=4, isAccidental=false) => KEY_NAMES.indexOf(key) + (octave * 12) + (isAccidental ? 1 : 0)


const colourMap = new Map()
export const convertNoteNumberToColour = (noteNumber:number, saturation:number=150, luminance:number=150) => {
	if (colourMap.has(noteNumber))
	{ 
		return colourMap.get(noteNumber)
	}
	const colour = "rgb("+360*((noteNumber % QUANTITY_NOTES)%12)/12+","+saturation+","+luminance+")"
	// return "hsl("+360*(this.sequenceIndex%12)/12+",5%,80%)"
	colourMap.set(noteNumber,colour)
	return colour
}

export default class NoteModel{

    // noteName
	// noteNumber
    // noteKey 
	// frequency
	// octave
    // accidental
    // sound
    // alternate

    detune:number = 0
    sequenceIndex: number
    number: any
    noteKey: string
    octave: number
    noteName: any
    frequency: number
    accidental: boolean
    sound: string
    alternate: any
        
    get colour():string{
        return convertNoteNumberToColour( this.number )
    }
	
    set noteNumber(noteNumber:number){
        this.number = noteNumber
        this.sequenceIndex = noteNumber % QUANTITY_NOTES
        this.noteKey =  noteNumberToKeyName( noteNumber )  
        this.octave = noteNumberToOctave( noteNumber )
        this.noteName =  this.noteKey + this.octave
        this.frequency = noteNumberToFrequency( noteNumber )
        this.accidental = isSharp( noteNumber )
        this.sound = SOUNDS_SOLFEGE[noteNumber % SOUNDS_SOLFEGE.length]
        this.alternate = this.accidental ? 
            noteNumberToKeyName( noteNumber + 1 ) + " Flat"  :
            this.noteName 
    }

    get noteNumber():number{
        return this.number
    }

    constructor( noteNumber:number ){
       this.noteNumber = noteNumber
    }

    toString():string{
        return "[Note: "+this.noteNumber+" key:"+this.noteKey+"  octave:" + this.octave + " sound:" + this.sound+"  ] Freq:"+ this.frequency
    }

    clone():NoteModel{
        return new NoteModel( this.noteNumber )
    }
}