import type { AudioCommandInterface } from "../audio-command-interface"
import { Transformer } from "./abstract-transformer"
import { IdentityTransformer } from "./id-transformer"
import { ID_QUANTISE, TransformerQuantise } from "./transformer-quantise"
import { TransformerTransposition } from "./transformer-transposition"

type Callback = () => void

export class TransformerManager extends Transformer<{}> {
   
    private transformers: Array<Transformer> = [
        new IdentityTransformer({}),
        new TransformerQuantise({}),
        new TransformerTransposition({})
    ]

    private transformersMap:Map<string, Transformer> = new Map()

    get isQuantised(){
        return this.transformersMap.has(ID_QUANTISE)
    }
  
    private onChangeFns: Callback[] = []

    constructor(initialTransformers?: Array<Transformer>) {
        super({})
        
        if (this.transformers) {
           this.setTransformers(this.transformers)
        }
         
        // add any transformers set in the constructor
        if (initialTransformers) {
            initialTransformers.forEach( (transformer:Transformer) => {
                this.addTransformer(transformer)
            })
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
        this.transformers = transformers;
        this.onChangeFns.forEach(t => t())
    }

    getTransformers() {
        return this.transformers
    }

    onChange(fn: () => void) {
        this.onChangeFns.push(fn)
        return () => {
            this.onChangeFns = this.onChangeFns.filter(f => f !== fn)
        }
    }

    getStructure() {
        const SPACING = 200
        const nodes = this.transformers.map((t, i) => ({
            id: 'node-' + i,
            type: 'transformer',
            data: { label: t.name, fields: t.fields, element: t },
            position: { x: SPACING * (i + 1), y: 0 }
        }))

        const alwaysNodes = [{
            id: 'start',
            type: 'start',
            data: { label: 'START' },
            position: { x: 0, y: 0 }
        }, {
            id: 'end',
            type: 'end',
            data: { label: 'END' },
            position: { x: SPACING * (this.transformers.length + 1), y: 0 }
        }]

        const edges = this.transformers.map((_, i) => ({
            id: 'edge-' + i,
            source: 'node-' + i,
            target: 'node-' + (i + 1)
        }))
        edges.pop()

        const alwaysEdges = [{
            id: 'edge-start',
            source: 'start',
            target: 'node-0'
        }, {
            id: 'edge-end',
            source: 'node-' + (this.transformers.length - 1),
            target: 'end'
        }]

        return { nodes: [...nodes, ...alwaysNodes], edges: [...edges, ...alwaysEdges] }
    }

    get name(): string {
        return 'TransformerManager'
    }

    /**
     * Add a transformer to the pipeline
     * @param transformer 
     */
    addTransformer(transformer: Transformer) {
        this.transformers.push(transformer)
        this.transformersMap.set(transformer.id, transformer)
        this.onChangeFns.forEach(t => t())
    }

    /**
     * Remove a transformer to the pipeline
     * @param transformer 
     */
    removeTransformer(transformer: Transformer) {
        this.transformers = this.transformers.filter(t => t !== transformer)
        this.transformersMap.delete(transformer.id)
        this.onChangeFns.forEach(t => t())
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