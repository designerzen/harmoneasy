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
import { ID_MICROTONALITY, TransformerMicroTonality } from "./robots/transformer-microtonality.ts"
import { ID_CHANNELER, TransformerChanneler } from "./robots/transformer-channeler.ts"
import { ID_CONSTRICTOR, TransformerConstrictor } from "./robots/transformer-constrictor.ts"
import { ID_TIMING_HUMANISER, TransformerTimingHumaniser } from "./robots/transformer-timing-humaniser.ts"
import { ID_VIBRATOR, TransformerVibrator } from "./robots/transformer-vibrator.ts"
import { ID_FILTER, TransformerFilter } from "./robots/transformer-filter.ts"
import { ID_EMOJI, TransformerEmoji } from "./robots/transformer-emoji.ts"
import { ID_MIDI_FILE_PLAYER, TransformerMIDIFilePlayer } from "./robots/transformer-midi-file-player.ts"
import { ID_CC_MAPPER, TransformerCCMapper } from "./robots/transformer-cc-mapper.ts"

export const tranformerFactory = (type: string, config: any={} ) => {
    switch (type) {
        case ID_ARPEGGIATOR: return new TransformerArpeggiator(config)
    case ID_CHANNELER: return new TransformerChanneler(config)
         case ID_CHORDIFIER: return new TransformerChordifier(config)
         case ID_CONSTRICTOR: return new TransformerConstrictor(config)
         case ID_CC_MAPPER: return new TransformerCCMapper(config)
    case ID_EMOJI: return new TransformerEmoji(config)
    case ID_FILTER: return new TransformerFilter(config)
        case ID_HARMONISER: return new TransformerHarmoniser(config)
        case ID_MICROTONALITY: return new TransformerMicroTonality(config)
        case ID_MIDI_FILE_PLAYER: return new TransformerMIDIFilePlayer(config)
        case ID_NOTE_DELAY: return new TransformerNoteDelay(config)
    case ID_NOTE_REPEATER: return new TransformerNoteRepeater(config)
    case ID_NOTE_SHORTENER: return new TransformerNoteShortener(config)
         case ID_QUANTISE: return new TransformerQuantise(config)
    case ID_RANDOMISER: return new TransformerRandomiser(config)
    case ID_TIMING_HUMANISER: return new TransformerTimingHumaniser(config)
    case ID_TRANSPOSER: return new TransformerTransposer(config)
    case ID_VIBRATOR: return new TransformerVibrator(config)
    default: return new IdentityTransformer(config)
    }
}

export const TRANSFORMER_TYPE = {
    ID_ARPEGGIATOR,
    ID_CHANNELER,
    ID_CHORDIFIER,
	ID_CONSTRICTOR,
	ID_CC_MAPPER,
	ID_EMOJI,
	ID_FILTER,
    ID_HARMONISER,
    ID_MICROTONALITY,
    ID_MIDI_FILE_PLAYER,
    ID_NOTE_SHORTENER,
    ID_NOTE_REPEATER,
    ID_NOTE_DELAY,
	ID_QUANTISE,
    ID_RANDOMISER,
    ID_TRANSPOSER
}

// Add the transformers that require certain functionality
TRANSFORMER_TYPE[ID_VIBRATOR] = ID_VIBRATOR

export const TRANSFORMERS = Object.values(TRANSFORMER_TYPE)