/**
 * TRANSFORMER MANAGER WITH WORKER SUPPORT -----------------------------------------------
 * Delegates transform operations to Web Workers to avoid blocking the main thread
 */
import { compress, decompress } from 'lz-string'
import TRANSFORM_WORKER_URI from './transform-worker.js?url'

import { Transformer } from "./robots/abstract-transformer.ts"
import { TransformerHarmoniser } from "./robots/transformer-harmoniser.ts"
import { TransformerTransposer } from "./robots/transformer-transposer.ts"
import { ID_QUANTISE, TransformerQuantise } from "./robots/transformer-quantise.ts"

import type Timer from "../timing/timer.ts"
import type { FieldConfig, ITransformer } from "./robots/interface-transformer.ts"
import type { IAudioCommand } from "../audio-command-interface.ts"

type Callback = () => void

const EVENT_TRANSFORMERS_UPDATED = "EVENT_TRANSFORMERS_UPDATED"
const EVENT_TRANSFORMERS_ADDED = "EVENT_TRANSFORMER_ADDED"
const EVENT_TRANSFORMERS_REMOVED = "EVENT_TRANSFORMER_REMOVED"

const DEFAULT_TRANSFORMERS = [
    new TransformerHarmoniser()
]

interface TransformRequest {
    id: string
    commands: IAudioCommand[]
    timer: Timer
    resolve: (commands: IAudioCommand[]) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
}

export class TransformerManagerWorker extends EventTarget implements ITransformer {
     
    public id: string = Transformer.getUniqueID()
    public name: string = 'TransformerManager'
    public timer: Timer | undefined

    private onChangeFns: Callback[] = []
    private worker: Worker | null = null
    private transformRequestMap: Map<string, TransformRequest> = new Map()
    private requestIdCounter: number = 0
    private pendingTransforms: TransformRequest[] = []
    private isWorkerReady: boolean = false
    private workerInitPromise: Promise<void>

    #transformersMap: Map<string, Array<Transformer>> = new Map()
    #transformers: Array<Transformer> = []

    // Worker pool configuration
    private readonly WORKER_TIMEOUT = 5000 // 5 seconds

    get fields(): FieldConfig[] {
        return this.#transformers.flatMap(t => t.config)
    }

    get isQuantised(): boolean {
        return this.#transformersMap.has(ID_QUANTISE) && this.quantiseTransformer?.isEnabled
    }

    get quantiseTransformer(): TransformerQuantise | undefined {
        return this.#transformersMap.get(ID_QUANTISE)?.[0] as TransformerQuantise
    }

    get quantiseFidelity(): number {
        return this.quantiseTransformer?.options.step ?? 0
    }

    get description(): string {
        return "Transformers Manager (Worker):\n" + this.#transformers.map(t => t.description).join('\n')
    }

    get activeTransformers() {
        return this.#transformers
    }

    get quantity() {
        return this.#transformers.length
    }
  
    constructor(initialTransformers?: Array<Transformer> = DEFAULT_TRANSFORMERS) {
        super()
        this.setTransformers([...this.#transformers, ...(initialTransformers ?? [])])
        this.workerInitPromise = this.initializeWorker()
    }
    
    /**
     * Initialize the Web Worker
     */
    private initializeWorker(): Promise<void> {
        return new Promise((resolve) => {
            try {
                // Create worker from the bundled worker URI
                // Using ?url pattern for Vite bundling
				const url = new URL( TRANSFORM_WORKER_URI, import.meta.url )
                this.worker = new Worker( url, { type: 'module' })

                this.worker.onmessage = (event) => this.handleWorkerMessage(event)
                this.worker.onerror = (error) => {
                    console.error('Worker error:', {
                        message: error.message,
                        filename: error.filename,
                        lineno: error.lineno
                    })
                    this.handleWorkerError(error as ErrorEvent)
                }

                // Send initial transformer states to worker
                this.syncTransformersToWorker()
                this.isWorkerReady = true
                console.log('Worker initialized successfully')
                resolve()
            } catch (error) {
                console.warn('Failed to create worker, falling back to main thread', error)
                this.isWorkerReady = false
                // Fallback: transforms will run on main thread
                resolve()
            }
        })
    }

    /**
     * Sync current transformer states to the worker
     */
    private syncTransformersToWorker(): void {
        if (!this.worker) {
            console.warn('[TransformerManagerWorker] No worker available, skipping sync')
            return
        }

        const transformerStates: Record<string, string> = {}
        this.#transformers.forEach(transformer => {
            transformerStates[transformer.uuid] = transformer.exportConfig()
        })

        this.worker.postMessage({
            id: 'init',
            type: 'init',
            transformerStates: JSON.stringify(transformerStates)
        })
    }

    /**
     * Handle messages from the worker
     */
    private handleWorkerMessage(event: MessageEvent): void {
        const { id, commands, error } = event.data

        const request = this.transformRequestMap.get(id)
        if (!request) return

        this.transformRequestMap.delete(id)
        clearTimeout(request.timeout)

        if (error) {
            request.reject(new Error(error))
        } else {
            request.resolve(commands)
        }
    }

    /**
     * Handle worker errors
     */
    private handleWorkerError(error: ErrorEvent): void {
        // Reject all pending requests
        this.transformRequestMap.forEach((request) => {
            clearTimeout(request.timeout)
            request.reject(new Error(`Worker error: ${error.message}`))
        })
        this.transformRequestMap.clear()

        // Attempt to recover
        this.isWorkerReady = false
        this.worker?.terminate()
        this.worker = null
        this.workerInitPromise = this.initializeWorker()
    }

    /**
     * Append to the end of the queue the specified transformer
     */
    appendTransformer(transformerToAdd: Transformer, dispatchEvents: boolean = true) {
        const collection: Transformer[] = this.#transformersMap.has(transformerToAdd.type)
            ? [...this.#transformersMap.get(transformerToAdd.type)!, transformerToAdd]
            : [transformerToAdd]
        this.#transformersMap.set(transformerToAdd.type, collection)
        transformerToAdd.index = this.#transformers.push(transformerToAdd) - 1
        this.onChangeFns.forEach(t => t())

        // Sync to worker
        this.syncTransformersToWorker()

        if (dispatchEvents) {
            this.dispatchEvent(new CustomEvent(EVENT_TRANSFORMERS_ADDED))
            this.dispatchEvent(new CustomEvent(EVENT_TRANSFORMERS_UPDATED))
        }
    }

    /**
     * Remove a transformer from the pipeline
     */
    removeTransformer(transformerToRemove: Transformer) {
        this.#transformers = this.#transformers.filter(transformer => transformer.uuid !== transformerToRemove.uuid)
        transformerToRemove.index = -1

        const remaining = this.#transformersMap.get(transformerToRemove.type)?.filter(t => t.uuid !== transformerToRemove.uuid)
        if (remaining && remaining.length > 0) {
            this.#transformersMap.set(transformerToRemove.type, remaining)
        } else {
            this.#transformersMap.delete(transformerToRemove.type)
        }

        this.onChangeFns.forEach(t => t())

        // Sync to worker
        this.syncTransformersToWorker()

        this.dispatchEvent(new CustomEvent(EVENT_TRANSFORMERS_REMOVED))
        this.dispatchEvent(new CustomEvent(EVENT_TRANSFORMERS_UPDATED))
    }

    /**
     * Overwrite the whole transformers queue stack
     */
    setTransformers(transformers: Array<Transformer>): void {
        this.clear()
        transformers.forEach((transformer: Transformer) => this.appendTransformer(transformer, false))
        this.dispatchEvent(new CustomEvent(EVENT_TRANSFORMERS_UPDATED))
    }

    /**
     * Get specific registered Transformer
     */
    getTransformer(id: string): Transformer | undefined {
        return this.#transformersMap.get(id)?.[0]
    }

    /**
     * Get all transformers
     */
    getTransformers(): Array<Transformer> {
        return this.#transformers
    }

    /**
     * Move transformer one step before
     */
    moveOneStepBefore(el: Transformer) {
        const index: number = this.#transformers.indexOf(el)
        if (index <= 0) return

        const newList = [...this.#transformers]
        const temp = newList[index - 1]
        newList[index - 1] = newList[index]
        newList[index] = temp

        this.setTransformers(newList)
    }

    /**
     * Move transformer one step after
     */
    moveOneStepAfter(el: Transformer) {
        const idx = this.#transformers.indexOf(el)
        if (idx === -1 || idx >= this.#transformers.length - 1) return

        const newList = [...this.#transformers]
        const temp = newList[idx + 1]
        newList[idx + 1] = newList[idx]
        newList[idx] = temp

        this.setTransformers(newList)
    }

    /**
     * INTERFACE:
     * Run transforms asynchronously
     * Returns a Promise that resolves to the transformed commands
     * Defers to next tick to avoid blocking
     */
    async transform(commands: IAudioCommand[], timer: Timer): Promise<IAudioCommand[]> {
        // wait unti Worker is available
		await this.workerInitPromise

        // Try worker if available and initialized
        if (this.isWorkerReady && this.worker) {
            try {
                return await this.transformViaWorker(commands, timer)
            } catch (error) {
                console.warn('Worker transform failed, falling back to main thread:', error)
                // Fallback on error
            }
        }

        // Fallback: defer to main thread on next tick to avoid blocking
        return this.transformMainThreadAsync(commands, timer)
    }

    /**
     * Fallback: Transform on main thread (synchronous)
     */
    private transformMainThread(commands: IAudioCommand[], timer: Timer): IAudioCommand[] {
        return this.#transformers.reduce((v, t) => t.transform(v, timer), commands)
    }

    /**
     * Fallback: Transform on main thread (asynchronous - defers to next tick)
     */
    private transformMainThreadAsync(commands: IAudioCommand[], timer: Timer): Promise<IAudioCommand[]> {
        return new Promise((resolve) => {
            // Use requestIdleCallback if available, otherwise setTimeout
            const defer = typeof requestIdleCallback !== 'undefined' ? requestIdleCallback : (cb: () => void) => setTimeout(cb, 0)
            
            defer(() => {
                try {
                    const result = this.transformMainThread(commands, timer)
                    resolve(result)
                } catch (error) {
                    console.error('Transform error:', error)
                    // Return untransformed commands on error
                    resolve(commands)
                }
            })
        })
    }

    /**
     * Send transform request to worker and wait for response
     */
    private transformViaWorker(commands: IAudioCommand[], timer: Timer): Promise<IAudioCommand[]> {
        return new Promise((resolve, reject) => {
            const id = `transform-${++this.requestIdCounter}`

            const timeout = setTimeout(() => {
                this.transformRequestMap.delete(id)
                console.warn(`Transform request ${id} timed out, falling back to main thread`)
                resolve(this.transformMainThread(commands, timer))
            }, this.WORKER_TIMEOUT)

            const request: TransformRequest = {
                id,
                commands,
                timer,
                resolve,
                reject,
                timeout
            }

            this.transformRequestMap.set(id, request)

            try {
                // Serialize timer to send to worker (only essential properties)
                const timerData = {
                    bpm: timer.bpm,
                    BPM: timer.bpm,
                    now: timer.now,
                    startTime: timer.startTime
                }

                this.worker!.postMessage({
                    id,
                    type: 'transform',
                    commands,
                    timerData
                },[])

            } catch (error) {
                clearTimeout(timeout)
                this.transformRequestMap.delete(id)
                console.warn('Failed to post to worker, falling back to main thread', error)
                resolve(this.transformMainThread(commands, timer))
            }
        })
    }

    /**
     * INTERFACE:
     * Reset the state of all Transformers
     */
    reset(): void {
        this.#transformers.forEach(t => t.reset())

        if (this.worker && this.isWorkerReady) {
            try {
                this.worker.postMessage({ id: 'reset', type: 'reset' })
            } catch (error) {
                console.warn('Failed to send reset to worker:', error)
            }
        }
    }

    exportConfig(): string {
        return JSON.stringify(this.#transformers.map(t => t.exportConfig()))
    }

    importData(encoded: string): void {
        const compressed = atob(encoded)
        const json = decompress(compressed)
        // Implementation would go here
    }

    exportData(): string {
        const json = this.exportConfig()
        const compressed = compress(json)
        return btoa(compressed)
    }

    clear(): void {
        this.#transformers = []
        this.#transformersMap = new Map()
    }

    onChange(fn: () => void) {
        this.onChangeFns.push(fn)
        return () => {
            this.onChangeFns = this.onChangeFns.filter(f => f !== fn)
        }
    }

    /**
     * Cleanup: terminate the worker when the manager is destroyed
     */
    destroy(): void {
        if (this.worker) {
            this.worker.terminate()
            this.worker = null
            this.isWorkerReady = false
        }

        // Reject any pending transforms
        this.transformRequestMap.forEach(request => {
            clearTimeout(request.timeout)
            request.reject(new Error('TransformerManager destroyed'))
        })
        this.transformRequestMap.clear()
    }
}
