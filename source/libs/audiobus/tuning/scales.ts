

// Scale type keys as constants
export const TUNING_MODE_MAJOR = 'major'
export const TUNING_MODE_IONIAN = 'ionian'
export const TUNING_MODE_NATURAL_MINOR = 'naturalMinor'
export const TUNING_MODE_AEOLIAN = 'aeolian'
export const TUNING_MODE_DORIAN = 'dorian'
export const TUNING_MODE_PHRYGIAN = 'phrygian'
export const TUNING_MODE_LYDIAN = 'lydian'
export const TUNING_MODE_MIXOLYDIAN = 'mixolydian'
export const TUNING_MODE_LOCRIAN = 'locrian'
export const TUNING_MODE_HARMONIC_MINOR = 'harmonicMinor'
export const TUNING_MODE_MELODIC_MINOR = 'melodicMinor'

export const TUNING_MODE_NAMES = [
    TUNING_MODE_IONIAN,			// Same as major
    TUNING_MODE_DORIAN,			// Start from second degree of major
    TUNING_MODE_PHRYGIAN,		    // Start from third degree of major
    TUNING_MODE_LYDIAN,			// Start from fourth degree of major
    TUNING_MODE_MIXOLYDIAN,		// Start from fifth degree of major
    TUNING_MODE_AEOLIAN,		    // Start from sixth degree (same as natural minor)
    TUNING_MODE_LOCRIAN			// Start from seventh degree
]
