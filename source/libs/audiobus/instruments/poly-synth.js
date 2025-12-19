/**
 * Lets you play many synths at once.
 * Can be of any instrument but currently limited to only one 
 */
import SynthOscillator, { OSCILLATORS } from "./synth-oscillator"

export default class PolySynth {

    options = {
        maxPolyphony: 24,
        class:SynthOscillator
    }

    instruments = []
    instrumentActivity = new Map()

    #gainNode

    SynthClass

    get output(){
        return this.#gainNode
    }

    constructor(audioContext,  options = {}) {
        this.audioContext = audioContext
        this.options = Object.assign({}, this.options, options)
       
        this.SynthClass = this.options.class
        this.#gainNode = audioContext.createGain()
		this.#gainNode.gain.setTargetAtTime( 1 / this.options.maxPolyphony, audioContext.currentTime, 0.01)
        this.factory( this.SynthClass, this.options.maxPolyphony)
    }

    /**
     * 
     * @param {Class} InstrumentClass 
     * @param {Number} quantity 
     */
    factory(InstrumentClass, quantity){
        for ( let i=0; i < quantity; ++i){
            const instrument = new InstrumentClass( this.audioContext, { ...this.options, title:'osc-0'+i } )
            this.instruments.push( instrument )
            instrument.output.connect( this.#gainNode )
        }
    }
    
    /**
     * Note ON
     * @param {Note} note - Model data
     * @param {Number} velocity - strength of the note
     * @param {Array<Number>} arp - intervals
     * @param {Number} delay - number to pause before playing
     */
    noteOn( note, velocity=1, arp=null, delay=0 ){
       
        if ( this.instrumentActivity.has(note.number) )
        {
            // already playing!
        }else{

            this.instruments.every( instrument => {
                if (!instrument.isNoteDown)
                {
                    instrument.noteOn( note, velocity, arp, delay )
                    this.instrumentActivity.set( note.number, instrument )
                    return false
                }
                return true
            })

            return  this.instrumentActivity.get( note.number )
        }
        return null
    }
    
    /**
     * Note OFF
     * This starts the process of stopping the note
     * by creating a smooth transition to silence from 
     * the current amplitude via release time.
     * @param {Note} note - Model data
     * @returns 
     */
    noteOff( note ){
        const instrument = this.instrumentActivity.get( note.number )
        if ( instrument )
        {
            instrument.noteOff( note )
            this.instrumentActivity.delete( note.number )
        } 
        return instrument
    }

    /**
     * Stop all notes on all instruments
     */
    allNotesOff(){
        this.instrumentActivity.forEach( (instrument, noteNumber) => instrument.allNotesOff() )
        // If the synth has an all notes off method, use it
        // Otherwise, iterate through all possible notes
        // for (let noteNumber = 0; noteNumber < 128; noteNumber++)
        // {
        //     const noteModel = new NoteModel(noteNumber)
        //     synth.noteOff(noteModel)
        // }
    }

    /**
     * Set a random oscillator timbre from the collection
     */
    setRandomTimbre(){
		const randomShape = OSCILLATORS[Math.floor(Math.random() * (OSCILLATORS.length - 1))]
		this.instruments.forEach( instrument => instrument.shape = randomShape )
    }
}
