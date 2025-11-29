import type { AudioCommandInterface } from "../audio-command-interface";
import { Transformer } from "./abstract-transformer";
import { IdentityTransformer } from "./id-transformer";

export class TransformerManager extends Transformer<{}> {
    private transformers: Array<Transformer> = [
        new IdentityTransformer({})
    ]

    constructor(initialTransformers?: Array<Transformer>) {
        super({});
        if (initialTransformers) {
            this.transformers = initialTransformers;
        }
    }

    setTransformers(transformers: Array<Transformer>): void {
        this.transformers = transformers;
    }

    transform(note: AudioCommandInterface[]) {
        return this.transformers.reduce((v, t) => t.transform(v), note)
    }
}