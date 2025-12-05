import { IdentityTransformer } from "./transformer-identity"
import { TransformerQuantise, ID_QUANTISE } from "./transformer-quantise"
import { TransformerHarmoniser, ID_HARMONISER } from "./transformer-harmoniser"
import { TransformerArpeggiator, ID_ARPEGGIATOR } from "./transformer-arpeggiator"
import { TransformerNoteShortener, ID_NOTE_SHORTENER } from "./transformer-note-shortener"
import { TransformerNoteRepeater, ID_NOTE_REPEATER } from "./transformer-note-repeater"
import { TransformerRandomiser, ID_RANDOMISER } from "./transformer-randomiser"
import { TransformerNoteDelay, ID_NOTE_DELAY } from "./transformer-note-delay"
import { TransformerChordifier, ID_CHORDIFIER } from "./transformer-chordifier"
import { ID_TRANSPOSER, TransformerTransposer } from "./transformer-transposer"
import { ID_MICROTONALITY } from "./transformer-microtonality"

export const tranformerFactory = (s: string) => {
    switch (s) {
        case ID_QUANTISE: return new TransformerQuantise()
        case ID_CHORDIFIER: return new TransformerChordifier()
        case ID_HARMONISER: return new TransformerHarmoniser()
        case ID_ARPEGGIATOR: return new TransformerArpeggiator()
        case ID_NOTE_SHORTENER: return new TransformerNoteShortener()
        case ID_NOTE_REPEATER: return new TransformerNoteRepeater()
        case ID_NOTE_DELAY: return new TransformerNoteDelay()
        case ID_RANDOMISER: return new TransformerRandomiser()
        case ID_TRANSPOSER: return new TransformerTransposer()
        default: return new IdentityTransformer({})
    }
}

export const TRANSFORMER_TYPE = {
    ID_QUANTISE,
    ID_CHORDIFIER,
    ID_HARMONISER,
    ID_ARPEGGIATOR,
    ID_MICROTONALITY,
    ID_NOTE_SHORTENER,
    ID_NOTE_REPEATER,
    ID_NOTE_DELAY,
    ID_RANDOMISER,
    ID_TRANSPOSER
}

export const TRANSFORMERS = [
    ID_QUANTISE,
    ID_CHORDIFIER,
    ID_HARMONISER,
    ID_ARPEGGIATOR,
    ID_MICROTONALITY,
    ID_NOTE_SHORTENER,
    ID_NOTE_REPEATER,
    ID_NOTE_DELAY,
    ID_RANDOMISER,
    ID_TRANSPOSER
]
