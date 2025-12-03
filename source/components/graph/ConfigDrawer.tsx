import React from "react"
import type { TransformerManager } from "../../libs/audiobus/transformers/transformer-manager"
import { 
    tranformerFactory,
    TRANSFORMER_TYPE
} from "../../libs/audiobus/transformers/transformer-factory"

export function ConfigDrawer() {

    const onAdd = (s: string) => () => {
        const tM = (window as any).transformerManager as TransformerManager
        tM.setTransformers([
            ...tM.getTransformers(),
            tranformerFactory(s)
        ])
    }

    const onSetPreset = (transformers: string[]) => () => {
        const tM = (window as any).transformerManager as TransformerManager
        tM.setTransformers(transformers.map(tranformerFactory))
    }

    return (<aside className="transformers-drawer">
        
        <details open className="transformers">
            <summary><h6>Transformers</h6></summary>
            
            <button onClick={onAdd(TRANSFORMER_TYPE.ID_ARPEGGIATOR)}>Arpeggiator</button>
            <button onClick={onAdd(TRANSFORMER_TYPE.ID_QUANTISE)}>Quantise</button>
            <button onClick={onAdd(TRANSFORMER_TYPE.ID_CHORDIFIER)}>Chordifier</button>
            <button onClick={onAdd(TRANSFORMER_TYPE.ID_HARMONISER)}>Harmoniser</button>
            <button onClick={onAdd(TRANSFORMER_TYPE.ID_NOTE_SHORTENER)}>Note Shortener</button>
            <button onClick={onAdd(TRANSFORMER_TYPE.ID_NOTE_REPEATER)}>Note Repeater</button>
            <button onClick={onAdd(TRANSFORMER_TYPE.ID_NOTE_DELAY)}>Note Delay</button>
            <button onClick={onAdd(TRANSFORMER_TYPE.ID_RANDOMISER)}>Randomiser</button>
        </details>

        <details open className="presets">
            <summary><h6>Presets</h6></summary>

            <button onClick={onSetPreset([TRANSFORMER_TYPE.ID_QUANTISE, TRANSFORMER_TYPE.ID_CHORDIFIER, TRANSFORMER_TYPE.ID_ARPEGGIATOR])}>
                Chord Arpeggiator
            </button>

            <button onClick={onSetPreset([TRANSFORMER_TYPE.ID_RANDOMISER, TRANSFORMER_TYPE.ID_QUANTISE, TRANSFORMER_TYPE.ID_NOTE_SHORTENER])}>
                Random Patch
            </button>

            <button onClick={onSetPreset([TRANSFORMER_TYPE.ID_QUANTISE, TRANSFORMER_TYPE.ID_CHORDIFIER, TRANSFORMER_TYPE.ID_NOTE_REPEATER])}>
                Chord Repeater
            </button>

            <button onClick={onSetPreset([TRANSFORMER_TYPE.ID_QUANTISE, TRANSFORMER_TYPE.ID_RANDOMISER, TRANSFORMER_TYPE.ID_CHORDIFIER])}>
                Harmonic Randomiser
            </button>

            <button onClick={onSetPreset([TRANSFORMER_TYPE.ID_QUANTISE, TRANSFORMER_TYPE.ID_ARPEGGIATOR, TRANSFORMER_TYPE.ID_NOTE_SHORTENER])}>
                Staccato Arp
            </button>

            <button onClick={onSetPreset([TRANSFORMER_TYPE.ID_RANDOMISER, TRANSFORMER_TYPE.ID_HARMONISER, TRANSFORMER_TYPE.ID_ARPEGGIATOR, TRANSFORMER_TYPE.ID_NOTE_REPEATER])}>
                Complex Pattern
            </button>
        </details>
    </aside>)
}