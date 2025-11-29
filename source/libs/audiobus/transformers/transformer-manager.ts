/**
 * TRANSFORMER -----------------------------------------------
 * 
 */
import type { AudioCommandInterface } from "../audio-command-interface.ts"
import { Transformer } from "./abstract-transformer.ts"
import { IdentityTransformer } from "./id-transformer.ts"
import { TransformerHarmoniser } from "./transformer-harmoniser.ts"
import { ID_QUANTISE, TransformerQuantise } from "./transformer-quantise.ts"
import { TransformerTransposer } from "./transformer-transposer.ts"

type Callback = () => void

export class TransformerManager extends Transformer<{}> {
     
    public name: string = 'TransformerManager'
   
    private transformers: Array<Transformer> = [
        new IdentityTransformer({}),
        new TransformerTransposer(),
        new TransformerHarmoniser()
    ]

    private transformersMap:Map<string, Transformer> = new Map()
    private onChangeFns: Callback[] = []

    get isQuantised(){
        return this.transformersMap.has(ID_QUANTISE)
    }

    get quantiseTransformer():TransformerQuantise|undefined{
        return this.transformersMap.get(ID_QUANTISE) as TransformerQuantise
    }
  
    get quantiseFidelity():number{
        return this.quantiseTransformer?.options.step ?? 0
    }
  
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
     * Add a transformer to the pipeline
     * @param transformerToAdd 
     */
    addTransformer(transformerToAdd: Transformer) {
        this.transformers.push(transformerToAdd)
        this.transformersMap.set(transformerToAdd.id, transformerToAdd)
        this.onChangeFns.forEach(t => t())
    }

    /**
     * Remove a transformer to the pipeline
     * @param transformerToRemove 
     */
    removeTransformer(transformerToRemove: Transformer) {
        this.transformers = this.transformers.filter(transformer => transformer !== transformerToRemove)
        this.transformersMap.delete(transformerToRemove.id)
        this.onChangeFns.forEach(t => t())
    }

    /**
     * Overwrite the qhole transformers queue stack
     * @param transformers 
     */
    setTransformers(transformers: Array<Transformer>): void {
        this.transformers = transformers
        this.transformersMap = new Map()
        this.transformers.forEach( (transformer:Transformer) => this.transformersMap.set(transformer.id, transformer) )
        this.onChangeFns.forEach(t => t())
    }

    getTransformer( id:string ): Transformer {
        return this.transformersMap.get(id)
    }

    getTransformers(): Array<Transformer> {
        return this.transformers
    }

    getStructure() {
        // Calculate positions with better spacing and centering
        const HORIZONTAL_SPACING = 250
        const NODE_HEIGHT = 100

        const nodes = this.transformers.map((t, i) => ({
            id: 'node-' + i,
            type: 'transformer',
            data: { label: t.name, fields: t.fields, element: t },
            position: { x: HORIZONTAL_SPACING * (i + 1), y: NODE_HEIGHT }
        }))

        const alwaysNodes = [{
            id: 'start',
            type: 'start',
            data: { label: 'START' },
            position: { x: 0, y: NODE_HEIGHT }
        }, {
            id: 'end',
            type: 'end',
            data: { label: 'END' },
            position: { x: HORIZONTAL_SPACING * (this.transformers.length + 1), y: NODE_HEIGHT }
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

    /**
     * INTERFACE : 
     * Advance through every single registered transformer and pass the
     * command 
     * @param command 
     * @returns AudioCommandInterface
     */
    transform(command: AudioCommandInterface[]) {
       return this.transformers.reduce((v, t) => t.transform(v), command)
    }

    
    onChange(fn: () => void) {
        this.onChangeFns.push(fn)
        return () => {
            this.onChangeFns = this.onChangeFns.filter(f => f !== fn)
        }
    }
}