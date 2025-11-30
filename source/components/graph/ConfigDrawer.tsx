import React from "react";
import type { TransformerManager } from "../../libs/audiobus/transformers/transformer-manager";
import { IdentityTransformer } from "../../libs/audiobus/transformers/id-transformer";
import { TransformerQuantise } from "../../libs/audiobus/transformers/transformer-quantise";
import { TransformerHarmoniser } from "../../libs/audiobus/transformers/transformer-harmoniser";
import { TransformerArpeggiator } from "../../libs/audiobus/transformers/transformer-arpeggiator";
import { TransformerNoteShortener } from "../../libs/audiobus/transformers/transformer-note-shortener";
import { TransformerNoteRepeater } from "../../libs/audiobus/transformers/transformer-note-repeater";
import { TransformerRandomiser } from "../../libs/audiobus/transformers/transformer-randomiser";
import { TransformerTransposer } from "../../libs/audiobus/transformers/transformer-transposer";

const tranformerFactory = (s: string) => {
    switch (s) {
        case 'quantise': return new TransformerQuantise()
        case 'harmonise': return new TransformerHarmoniser()
        case 'arpeggiator': return new TransformerArpeggiator()
        case 'note-shortener': return new TransformerNoteShortener()
        case 'note-repeater': return new TransformerNoteRepeater()
        case 'randomiser': return new TransformerRandomiser()
        case 'transposer': return new TransformerTransposer()
        default: return new IdentityTransformer({})

    }
}


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

    return (<div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
        <button onClick={onAdd('identity')}>Identity</button>
        <button onClick={onAdd('arpeggiator')}>Arpeggiator</button>
        <button onClick={onAdd('quantise')}>Quantise</button>
        <button onClick={onAdd('harmonise')}>Harmonise</button>
        <button onClick={onAdd('note-shortener')}>Note Shortener</button>
        <button onClick={onAdd('note-repeater')}>Note Repeater</button>
        <button onClick={onAdd('randomiser')}>Randomiser</button>
        <button onClick={onAdd('transposer')}>Transposer</button>

        <div style={{
            marginTop: '16px',
            paddingTop: '16px',
            borderTop: '2px solid #444'
        }}>
            <div style={{fontSize: '12px', fontWeight: 'bold', color: '#888', marginBottom: '8px'}}>PRESETS</div>

            <div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
                <button onClick={onSetPreset(['quantise', 'harmonise', 'arpeggiator'])}>
                    Chord Arpeggiator
                </button>

                <button onClick={onSetPreset(['randomiser', 'quantise', 'note-shortener'])}>
                    Random Patch
                </button>

                <button onClick={onSetPreset(['quantise', 'harmonise', 'note-repeater'])}>
                    Chord Repeater
                </button>

                <button onClick={onSetPreset(['transposer', 'randomiser', 'harmonise'])}>
                    Harmonic Randomiser
                </button>

                <button onClick={onSetPreset(['quantise', 'arpeggiator', 'note-shortener'])}>
                    Staccato Arp
                </button>

                <button onClick={onSetPreset(['randomiser', 'harmonise', 'arpeggiator', 'note-repeater'])}>
                    Complex Pattern
                </button>
            </div>
        </div>
    </div>)
}