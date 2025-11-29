import React from "react";
import type { TransformerManager } from "../../libs/audiobus/transformers/transformer-manager";
import { IdentityTransformer } from "../../libs/audiobus/transformers/id-transformer";
import { TransformerQuantise } from "../../libs/audiobus/transformers/transformer-quantise";

const tranformerFactory = (s: string) => {
    switch (s) {
        case 'quantise': return new TransformerQuantise({})
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

    return (<div>
        <button onClick={onAdd('identity')}>Identity</button>
        <button onClick={onAdd('quantise')}>Quantise</button>
    </div>)
}