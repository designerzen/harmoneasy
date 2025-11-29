import React from "react";
import type { TransformerManager } from "../../libs/audiobus/transformers/transformer-manager";
import { IdentityTransformer } from "../../libs/audiobus/transformers/id-transformer";
import { TransformerQuantise } from "../../libs/audiobus/transformers/transformer-quantise";
import { TransformerHarmoniser } from "../../libs/audiobus/transformers/transformer-harmoniser";
import { TransformerArpeggiator } from "../../libs/audiobus/transformers/transformer-arpeggiator";
import { TransformerNoteShortener } from "../../libs/audiobus/transformers/transformer-note-shortener";
import { TransformerNoteRepeater } from "../../libs/audiobus/transformers/transformer-note-repeater";

const tranformerFactory = (s: string) => {
    switch (s) {
        case 'quantise': return new TransformerQuantise()
        case 'harmonise': return new TransformerHarmoniser()
        case 'arpeggiator': return new TransformerArpeggiator()
        case 'note-shortener': return new TransformerNoteShortener()
        case 'note-repeater': return new TransformerNoteRepeater()
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

    return (<div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
        <button onClick={onAdd('identity')}>Identity</button>
        <button onClick={onAdd('arpeggiator')}>Arpeggiator</button>
        <button onClick={onAdd('quantise')}>Quantise</button>
        <button onClick={onAdd('harmonise')}>Harmonise</button>
        <button onClick={onAdd('note-shortener')}>Note Shortener</button>
        <button onClick={onAdd('note-repeater')}>Note Repeater</button>
    </div>)
}