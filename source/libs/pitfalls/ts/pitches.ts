import type EdoScale from "./edo-scale.ts"
import type Intervals from "./intervals.ts"

import { get_freq, hz_to_midi, midi_to_hz } from './utils.ts'

export default class Pitches {

    #baseFrequency: number
    #rootOctave: number
    #scaleLength: number

    #edoScale: EdoScale
    #intervals: Intervals

    // Frequencies
    freqs: Record<number, string> = {}
    midis: Record<number, number> = {}
    degrees: Record<number, number> = {}
    octdegfreqs: Record<number, Record<number, string>> = {}
    octdegmidis: Record<number, Record<number, number>> = {}
    midiMappings: Array<[number, number]> = []
    keyMappings?: Map<number, number>

    // array of offsets in cents for each 12 notes in octave C is first offset
    tuningOctaveOffsets: number[] = []

    // first value MIDI note
    // 2nd value cents offset 0-100
    octaveTuning: Map<number, number> = new Map([
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

    constructor(scale: EdoScale, intervals: Intervals, tuning: number, midi_start: number, root_octave: number, key_mappings: Map<number, Map<number, number>>) {

        this.#edoScale = scale
        this.#intervals = intervals

        this.#scaleLength = scale.length
        this.keyMappings = key_mappings.get(this.#scaleLength)
        this.#baseFrequency = midi_to_hz(midi_start, tuning)
        this.#rootOctave = root_octave

        let index = 0
        let f: number | null = null

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
                const ratio = (f as number) * intervals.getRatioAtIndex(deg)
               
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
  
    getDegree(index: number): number {
        return this.degrees[index]
    }

    getFrequency(index: number): string {
        return this.freqs[index]
    }

    octdeg(deg: number): [number, number] {
        const higherOcatve = deg > this.#edoScale.length
        const octave = this.#rootOctave + (higherOcatve ? Math.floor((deg - 1) / this.#edoScale.length) : 0)
        const degree = higherOcatve ? (deg % this.#edoScale.length === 0 ? this.#edoScale.length : deg % this.#edoScale.length) : deg
        // console.log([octave, degree])
        return [octave, degree]
    }

    octdegfreq(oct: number, deg: number): string | null {
        if (this.octdegfreqs[oct]) {
            return this.octdegfreqs[oct][deg]
        } else {
            return null
        }
    }

    octdegmidi(oct: number, deg: number): number | null {
        if (this.octdegmidis[oct]) {
            return this.octdegmidis[oct][deg]
        } else {
            return null
        }
    }
}