import React from "react";
import type { TransformerManager } from "../../libs/audiobus/transformers/transformer-manager";
import { IdentityTransformer } from "../../libs/audiobus/transformers/id-transformer";

export function ConfigDrawer() {

    const onIdentityAdd = () => {
        const tM = (window as any).transformerManager as TransformerManager
        tM.setTransformers([
            ...tM.getTransformers(),
            new IdentityTransformer({})
        ])
    }

    return (<div>
        <button onClick={onIdentityAdd}>Identity</button>
    </div>)
}