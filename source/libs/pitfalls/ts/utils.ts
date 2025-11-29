const LOG_2 = Math.log(2)

/**
 * Ratio
 * 
 * @param division 
 * @param edivisions 
 * @returns {Number}
 */
export const getRatio = (division: Number, edivisions: Number): Number => {
    return division === 0 ? 1 : Math.pow(2, division / edivisions)
}

/**
 * This function gets frequency based on 
 * index, edo, octave, and base frequency
 * 
 * @param baseFrequency 
 * @param edo 
 * @param index 
 * @param octave 
 * @param baseOctave 
 * @returns {Number}
 */
export const get_freq = (baseFrequency: Number, edo: Number, index: Number, octave: Number, baseOctave: Number): Number => {
    const frequency:Number = baseFrequency * getRatio(index - 1, edo)
    if (octave < baseOctave) {
        return frequency / Math.pow(2, baseOctave - octave)
    } 
    return frequency * Math.pow(2, octave - baseOctave)
}

/**
 * Convert a Hertz value into a MIDI Note number
 * @param freq 
 * @param tuning 
 * @returns {Number}
 */
export const hz_to_midi = (freq: Number, tuning: Number): Number => {
    return 12 * (Math.log(freq / tuning) / LOG_2) + 69
}

/**
 * Convert MIDI number to Hz using a given tuning multiplier
 * 
 * @param noteNumber 
 * @param tuning 
 * @returns {Number}
 */
export const midi_to_hz = (noteNumber: Number, tuning: Number): Number => {
    return tuning * Math.pow(2, (noteNumber - 69) / 12 )
}