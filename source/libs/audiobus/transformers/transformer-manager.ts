import type AudioCommand from "../audio-command";
import type { AudioCommandInterface } from "../audio-command-interface";
import { Transformer } from "./abstract-transformer";
import { IdentityTransformer } from "./id-transformer";

export class TransformerManager extends Transformer<{}> {
   
    private transformers: Array<Transformer> = [
        new IdentityTransformer({})
    ]

    addTransformer(transformer: Transformer) {
        this.transformers.push(transformer)
    }

    removeTransformer(transformer: Transformer) {
        this.transformers = this.transformers.filter(t => t !== transformer)
    }

    /**
     * Advance through every single registered transformer and pass the
     * command 
     * @param note 
     * @returns 
     */
    transform(note: AudioCommandInterface):[]|AudioCommandInterface {
        // 
        return this.transformers.reduce((v, t) => t.transform(v), note)
    }
}