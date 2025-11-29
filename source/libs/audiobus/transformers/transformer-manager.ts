<<<<<<< HEAD
import type AudioCommand from "../audio-command";
=======
>>>>>>> c5160fc304026aa7bff62c92756c4a445d9b4444
import type { AudioCommandInterface } from "../audio-command-interface";
import { Transformer } from "./abstract-transformer";
import { IdentityTransformer } from "./id-transformer";

export class TransformerManager extends Transformer<{}> {
   
    private transformers: Array<Transformer> = [
        new IdentityTransformer({})
    ]

<<<<<<< HEAD
    addTransformer(transformer: Transformer) {
        this.transformers.push(transformer)
    }

    removeTransformer(transformer: Transformer) {
        this.transformers = this.transformers.filter(t => t !== transformer)
    }

  
    constructor(initialTransformers?: Array<Transformer>) {
        super({});
        if (initialTransformers) {
            this.transformers = initialTransformers;
        }
    }

    setTransformers(transformers: Array<Transformer>): void {
        this.transformers = transformers;
    }

      /**
     * Advance through every single registered transformer and pass the
     * command 
     * @param note 
     * @returns 
     */

    transform(note: AudioCommandInterface[]) {
       return this.transformers.reduce((v, t) => t.transform(v), note)
    }
}