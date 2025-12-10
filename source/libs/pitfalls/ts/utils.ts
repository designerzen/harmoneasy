const LOG_2 = Math.log(2)

/**
 * Calculate ratio for EDO scale
 * 
 * @param division - Current division
 * @param edivisions - Total divisions in octave
 * @returns Ratio value
 */
export const getRatio = (division: number, edivisions: number): number => {
    return division === 0 ? 1 : Math.pow(2, division / edivisions)
}

/**
 * Get frequency based on EDO scale parameters
 * 
 * @param baseFrequency - Base frequency in Hz
 * @param edo - EDO divisions 
 * @param index - Scale degree index
 * @param octave - Target octave
 * @param baseOctave - Reference octave
 * @returns Frequency in Hz
 */
export const get_freq = (baseFrequency: number, edo: number, index: number, octave: number, baseOctave: number): number => {
    const frequency: number = baseFrequency * getRatio(index - 1, edo)
    if (octave < baseOctave) {
        return frequency / Math.pow(2, baseOctave - octave)
    } 
    return frequency * Math.pow(2, octave - baseOctave)
}

/**
 * Convert Hertz to MIDI note number
 * 
 * @param freq - Frequency in Hz
 * @param tuning - Tuning frequency (reference)
 * @returns MIDI note number
 */
export const hz_to_midi = (freq: number, tuning: number): number => {
    return 12 * (Math.log(freq / tuning) / LOG_2) + 69
}

/**
 * Convert MIDI note number to Hz
 * 
 * @param noteNumber - MIDI note number
 * @param tuning - Tuning frequency (reference)
 * @returns Frequency in Hz
 */
export const midi_to_hz = (noteNumber: number, tuning: number): number => {
    return tuning * Math.pow(2, (noteNumber - 69) / 12 )
}