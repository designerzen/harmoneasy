/**
 * TRANSFORMER -----------------------------------------------
 * GOBOTS IN DISGUISE
 */
import type { AudioCommandInterface } from "../audio-command-interface.ts"
import { Transformer } from "./abstract-transformer.ts"
import { IdentityTransformer } from "./id-transformer.ts"
import { TransformerHarmoniser } from "./transformer-harmoniser.ts"
import { TransformerTransposer } from "./transformer-transposer.ts"
import { ID_QUANTISE, TransformerQuantise } from "./transformer-quantise.ts"
import type { TransformerInterface } from "./trqansformer-interface.ts"
import { TransformerRandomiser } from "./transformer-randomiser.ts"
import type Timer from "../timing/timer.ts"

type Callback = () => void

const EVENT_TRANSFORMERS_UPDATED = "EVENT_TRANSFORMERS_UPDATED"

export class TransformerManager extends EventTarget implements TransformerInterface {
     
    public name: string = 'TransformerManager'
    public timer: any = null // Reference to AudioTimer for BPM-synced transformers

    private transformers: Array<Transformer> = [
        new IdentityTransformer({}),
        new TransformerTransposer(),
        new TransformerHarmoniser(),
        new TransformerRandomiser()
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
        super()
        this.setTransformers([ ...this.transformers, ...(initialTransformers??[]) ])     
    }
    
    /**
     * Add a transformer to the pipeline
     * @param transformerToAdd 
     */
    addTransformer(transformerToAdd: Transformer) {
        this.transformers.push(transformerToAdd)
        this.transformersMap.set(transformerToAdd.id, transformerToAdd)
        this.onChangeFns.forEach(t => t())
        this.dispatchEvent( new CustomEvent(EVENT_TRANSFORMERS_UPDATED) )
    }

    /**
     * Remove a transformer to the pipeline
     * @param transformerToRemove 
     */
    removeTransformer(transformerToRemove: Transformer) {
        this.transformers = this.transformers.filter(transformer => transformer !== transformerToRemove)
        this.transformersMap.delete(transformerToRemove.id)
        this.onChangeFns.forEach(t => t())
        this.dispatchEvent( new CustomEvent(EVENT_TRANSFORMERS_UPDATED) )
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
        this.dispatchEvent( new CustomEvent(EVENT_TRANSFORMERS_UPDATED) )
    }

    /**
     * 
     * @param id 
     * @returns 
     */
    getTransformer( id:string ): Transformer|undefined {
        return this.transformersMap.get(id)
    }

    /**
     * 
     * @returns 
     */
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

        const alwaysEdges = this.transformers.length <= 0 ? [{ id: 'connect', source: 'start', target: 'end'}] : [{
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

    moveOneStepBefore(el: Transformer) {
        const idx = this.transformers.indexOf(el)
        if (idx <= 0) return // already at the start or not found

        const newList = [...this.transformers]
        // swap el with the one before it
        [newList[idx - 1], newList[idx]] = [newList[idx], newList[idx - 1]]

        this.setTransformers(newList)
    }

    moveOneStepAfter(el: Transformer) {
        const idx = this.transformers.indexOf(el)
        if (idx === -1 || idx >= this.transformers.length - 1) return // end or not found

        const newList = [...this.transformers]
        // swap el with the one after it
        [newList[idx + 1], newList[idx]] = [newList[idx], newList[idx + 1]]

        this.setTransformers(newList)
    }


    /**
     * INTERFACE :
     * Advance through every single registered transformer and pass the
     * command
     * @param command
     * @returns AudioCommandInterface
     */
    transform(command: AudioCommandInterface[], timer:Timer ) {
        console.log('TRANSFORM', command)
       return this.transformers.reduce((v, t) => t.transform(v, timer), command)
    }

    onChange(fn: () => void) {
        this.onChangeFns.push(fn)
        return () => {
            this.onChangeFns = this.onChangeFns.filter(f => f !== fn)
        }
    }
}