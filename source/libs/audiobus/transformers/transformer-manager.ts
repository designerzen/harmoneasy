import type AudioCommand from "../audio-command";
import { Transformer } from "./abstract-transformer";
import { IdentityTransformer } from "./id-transformer";

export class TransformerManager extends Transformer<{}> {
    private transformers: Array<Transformer> = [
        new IdentityTransformer({})
    ]

    transform(note: AudioCommand) {
        return this.transformers.reduce((v, t) => t.transform(v), note)
    }
}