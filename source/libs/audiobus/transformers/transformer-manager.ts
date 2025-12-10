/**
 * TRANSFORMER -----------------------------------------------
 * GOBOTS IN DISGUISE
 */
import { Transformer } from "./abstract-transformer.ts"
import { TransformerHarmoniser } from "./transformer-harmoniser.ts"
import { TransformerTransposer } from "./transformer-transposer.ts"
import { ID_QUANTISE, TransformerQuantise } from "./transformer-quantise.ts"

import type Timer from "../timing/timer.ts"
import type { FieldConfig, TransformerInterface } from "./interface-transformer.ts"
import type { IAudioCommand } from "../audio-command-interface.ts"

type Callback = () => void

const EVENT_TRANSFORMERS_UPDATED = "EVENT_TRANSFORMERS_UPDATED"
const EVENT_TRANSFORMERS_ADDED = "EVENT_TRANSFORMER_ADDED"
const EVENT_TRANSFORMERS_REMOVED = "EVENT_TRANSFORMER_REMOVED"

const DEFAULT_TRANSFORMERS = [
    new TransformerTransposer()
]

export class TransformerManager extends EventTarget implements TransformerInterface {
     
    public id: string = Transformer.getUniqueID()
    public name: string = 'TransformerManager'
    public timer:Timer|undefined // Reference to AudioTimer for BPM-synced transformers

    private onChangeFns: Callback[] = []

    private transformersMap:Map<string, Array<Transformer> > = new Map()
    private transformers: Array<Transformer> = []

    // FIXME: Make a compositie of all the transformers
    get fields(): FieldConfig[] {
        return []
    }

    get isQuantised():boolean{
        return this.transformersMap.has(ID_QUANTISE) && this.quantiseTransformer?.isEnabled
    }

    get quantiseTransformer():TransformerQuantise|undefined{
        // NB. it doesn't matter how many you add, they shouldn't double up
        return this.transformersMap.get(ID_QUANTISE)?.[0] as TransformerQuantise
    }

    get quantiseFidelity():number{
        return this.quantiseTransformer?.options.step ?? 0
    }
  
    constructor(initialTransformers?: Array<Transformer>=DEFAULT_TRANSFORMERS) {
        super()
        this.setTransformers([ ...this.transformers, ...(initialTransformers??[]) ])     
    }
    
    /**
     * Append to the end of the queue the specified transformer
     * @param transformerToAdd 
     */
    appendTransformer(transformerToAdd: Transformer, dispatchEvents:boolean=true ) {
        const collection:Transformer[] = this.transformersMap.has(transformerToAdd.type) ? [...this.transformersMap.get(transformerToAdd.type), transformerToAdd] : [transformerToAdd]
        this.transformersMap.set(transformerToAdd.type, collection )
		transformerToAdd.index = this.transformers.push(transformerToAdd) - 1
        this.onChangeFns.forEach(t => t())
        if (dispatchEvents)
        {
            this.dispatchEvent( new CustomEvent(EVENT_TRANSFORMERS_ADDED) )
            this.dispatchEvent( new CustomEvent(EVENT_TRANSFORMERS_UPDATED) )
        }
    }

    /**
     * Remove a transformer to the pipeline
     * @param transformerToRemove 
     */
    removeTransformer(transformerToRemove: Transformer) {
        this.transformers = this.transformers.filter(transformer => transformer.uuid !== transformerToRemove.uuid)
        
		transformerToRemove.index = -1

        // Update the map: filter out the removed transformer, delete key if no more exist
        const remaining = this.transformersMap.get(transformerToRemove.type)?.filter(t => t.uuid !== transformerToRemove.uuid)
        if (remaining && remaining.length > 0) {
            this.transformersMap.set(transformerToRemove.type, remaining)
        } else {
            this.transformersMap.delete(transformerToRemove.type)
        }

        this.onChangeFns.forEach(t => t())
        this.dispatchEvent( new CustomEvent(EVENT_TRANSFORMERS_REMOVED) )
        this.dispatchEvent( new CustomEvent(EVENT_TRANSFORMERS_UPDATED) )
    }

    /**
     * Overwrite the qhole transformers queue stack
     * @param transformers 
     */
    setTransformers(transformers: Array<Transformer>): void {
        this.clear()
        transformers.forEach( (transformer:Transformer) => this.appendTransformer( transformer, false) )
        this.dispatchEvent( new CustomEvent(EVENT_TRANSFORMERS_UPDATED) )
    }

    /**
     * 
     * @param id 
     * @returns specific registered Transformer
     */
    getTransformer( id:string ): Transformer|undefined {
        return this.transformersMap.get(id)
    }

    /**
     * 
     * @returns All transformers
     */
    getTransformers(): Array<Transformer> {
        return this.transformers
    }

    // GUI stuff
    getStructure() {

        // Calculate positions with better spacing and centering
        const HORIZONTAL_SPACING = 280
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

	// FIXME: This is done in a very slow fashion creating a whole new sequence everytime
    moveOneStepBefore(el: Transformer) {
        
        const index:number = this.transformers.indexOf(el)
        if (index <= 0) return // already at the start or not found

        const newList = [...this.transformers]
        // swap el with the one before it
        const temp = newList[index - 1]
        newList[index - 1] = newList[index]
        newList[index] = temp

        this.setTransformers(newList)
    }

	// FIXME: This is done in a very slow fashion creating a whole new sequence everytime
    moveOneStepAfter(el: Transformer) {
        const idx = this.transformers.indexOf(el)
        if (idx === -1 || idx >= this.transformers.length - 1) return // end or not found

        const newList = [...this.transformers]
        // swap el with the one after it
        const temp = newList[idx + 1]
        newList[idx + 1] = newList[idx]
        newList[idx] = temp

        this.setTransformers(newList)
    }

    /**
     * INTERFACE :
     * Advance through every single registered transformer and pass the
     * command
     * @param commands
     * @returns IAudioCommand
     */
    transform(commands: IAudioCommand[], timer:Timer ) {
        return this.transformers.reduce((v, t) => t.transform(v, timer), commands)
    }

    /**
     * INTERFACE :
     * Reset the state of all Transformers
     */
    reset():void{
       this.transformers.forEach(t => t.reset())
    }

    clear(){
        this.transformers = []
        this.transformersMap = new Map()
    }

    onChange(fn: () => void) {
        this.onChangeFns.push(fn)
        return () => {
            this.onChangeFns = this.onChangeFns.filter(f => f !== fn)
        }
    }
}