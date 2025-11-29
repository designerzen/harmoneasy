import type EdoScale from "./edo-scale"
import type Intervals from "./intervals"

import { get_freq, hz_to_midi, midi_to_hz } from './utils'

export default class Pitches {

    #baseFrequency:Number
    #rootOctave:Number
    #scaleLength:Number

    #edoScale:EdoScale
    #intervals

    // Frequencies
    freqs = {}
    midis = {}
    degrees = {}
    octdegfreqs = {}
    octdegmidis = {}
    midiMappings = {}

    // array of offsets in cents for each 12 notes in octave C is first offset
    tuningOctaveOffsets:Number[] = []

    // first value MIDI note
    // 2nd value cents offset 0-100
    octaveTuning = new Map([
        [60, 0],
        [61, 0],
        [62, 0],
        [63, 0],
        [64, 0],
        [65, 0],
        [66, 0],
        [67, 0],
        [68, 0],
        [69, 0],
        [70, 0],
        [71, 0]
    ])

    get intervals(){
        return this.#intervals
    }

    constructor(scale:EdoScale, intervals:Intervals, tuning, midi_start:Number, root_octave:Number, key_mappings) {

        this.#edoScale = scale
        this.#intervals = intervals

        this.#scaleLength = scale.length
        this.keyMappings = key_mappings.get(this.#scaleLength)
        this.#baseFrequency = midi_to_hz(midi_start, tuning)
        this.#rootOctave = root_octave

        let index = 0
        let f = null

        // Loop through octaves
        for (let oct = 0; oct <= 8; oct++) {

            this.octdegfreqs[oct] = {}
            this.octdegmidis[oct] = {}

            f = get_freq( this.#baseFrequency, scale.edivisions, scale.tonic, oct, this.#rootOctave)
            console.info( "ratio" , {scale} , f, this.#baseFrequency, scale.edivisions, scale.tonic, oct, this.#rootOctave)

            // Loop through Scale
            for (let deg = 0; deg < scale.length; deg++) {

                ++index
                // fixme: string conversion v slow
                const ratio = f * intervals.getRatioAtIndex(deg)
               
                this.freqs[index] = parseFloat( ratio ).toFixed(3)
                this.midis[index] = parseFloat(hz_to_midi(ratio, tuning).toFixed(4))
                this.degrees[index] = deg

                this.octdegfreqs[oct][deg + 1] = this.freqs[index]
                this.octdegmidis[oct][deg + 1] = this.midis[index]
            }
        }

        this.midiMappings = Object.values(this.octdegmidis[3]).map((midi) => {
            const integerPart = Math.floor(midi)
            const fractionalPart = midi - integerPart
            const cents = Math.min(100, Math.round(fractionalPart * 100))
            this.octaveTuning.set(integerPart, cents)
            return [integerPart, cents]
        })

        this.#baseFrequency = parseFloat(this.#baseFrequency).toFixed(4)
    }
  
    getDegree(index) {
        return this.degrees[index]
    }

    getFrequency(index) {
        return this.freqs[index]
    }

    octdeg(deg) {
        const higherOcatve = deg > this.#edoScale.length
        const octave = this.#rootOctave + (higherOcatve ? Math.floor((deg - 1) / this.#edoScale.length) : 0)
        const degree = higherOcatve ? (deg % this.#edoScale.length === 0 ? this.#edoScale.length : deg % this.#edoScale.length) : deg
        // console.log([octave, degree])
        return [octave, degree]
    }

    octdegfreq(oct, deg) {
        if (this.octdegfreqs[oct]) {
            return this.octdegfreqs[oct][deg]
        } else {
            return null
        }
    }

    octdegmidi(oct, deg) {
        if (this.octdegmidis[oct]) {
            return this.octdegmidis[oct][deg]
        } else {
            return null
        }
    }
}