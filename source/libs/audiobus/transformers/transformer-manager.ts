import type { AudioCommandInterface } from "../audio-command-interface"
import { Transformer } from "./abstract-transformer"
import { IdentityTransformer } from "./id-transformer"
import { ID_QUANTISE } from "./transformer-quantise"

export class TransformerManager extends Transformer<{}> {
   
    private transformers: Array<Transformer> = [
        new IdentityTransformer({})
    ]

    private transformersMap:Map<string, Transformer> = new Map()

    get isQuantised(){
        return this.transformersMap.get(ID_QUANTISE)
    }

    constructor(initialTransformers?: Array<Transformer>) {
        super({})
        
        if (initialTransformers) {
           this.setTransformers(initialTransformers)
        }
    }
    
    /**
     * Overwrite the qhole transformers queue stack
     * @param transformers 
     */
    setTransformers(transformers: Array<Transformer>): void {
        this.transformers = transformers
        this.transformersMap = new Map()
        this.transformers.forEach( (transformer:Transformer) => this.transformersMap.set(transformer.id, transformer) )
    }

    /**
     * Add a transformer to the pipeline
     * @param transformer 
     */
    addTransformer(transformer: Transformer) {
        this.transformers.push(transformer)
        this.transformersMap.set(transformer.id, transformer)
    }

    /**
     * Remove a transformer to the pipeline
     * @param transformer 
     */
    removeTransformer(transformer: Transformer) {
        this.transformers = this.transformers.filter(t => t !== transformer)
        this.transformersMap.delete(transformer.id)
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