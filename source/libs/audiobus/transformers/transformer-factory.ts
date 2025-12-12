import { IdentityTransformer } from "./robots/transformer-identity.ts"
import { TransformerQuantise, ID_QUANTISE } from "./robots/transformer-quantise.ts"
import { TransformerHarmoniser, ID_HARMONISER } from "./robots/transformer-harmoniser.ts"
import { TransformerArpeggiator, ID_ARPEGGIATOR } from "./robots/transformer-arpeggiator.ts"
import { TransformerNoteShortener, ID_NOTE_SHORTENER } from "./robots/transformer-note-shortener.ts"
import { TransformerNoteRepeater, ID_NOTE_REPEATER } from "./robots/transformer-note-repeater.ts"
import { TransformerRandomiser, ID_RANDOMISER } from "./robots/transformer-randomiser.ts"
import { TransformerNoteDelay, ID_NOTE_DELAY } from "./robots/transformer-note-delay.ts"
import { TransformerChordifier, ID_CHORDIFIER } from "./robots/transformer-chordifier.ts"
import { ID_TRANSPOSER, TransformerTransposer } from "./robots/transformer-transposer.ts"
import { ID_MICROTONALITY } from "./robots/transformer-microtonality.ts"
import { ID_CHANNELER, TransformerChanneler } from "./robots/transformer-channeler.ts"

export const tranformerFactory = (type: string) => {
    switch (type) {
        case ID_QUANTISE: return new TransformerQuantise()
        case ID_CHANNELER: return new TransformerChanneler({})
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
    ID_CHANNELER,
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
    ID_CHANNELER,
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
