/**
 * Web Worker for executing transformer operations
 * Runs transform methods off the main thread
 */

import { tranformerFactory } from './transformer-factory.ts'

interface TransformMessage {
    id: string
    type: 'transform' | 'init' | 'reset'
    commands?: any[]
    timerData?: {
        bpm: number
        now: number
        startTime: number
    }
    transformerStates?: string
}

interface TransformResponse {
    id: string
    commands: any[]
    error?: string
}

class TransformWorker {
    private transformerStates: Map<string, any> = new Map()
    private transformerInstances: Map<string, any> = new Map()

    constructor() {
        try {
            self.onmessage = (event: MessageEvent<TransformMessage>) => {
                self.postMessage({ id: 'debug-onmessage', debug: 'Worker received message', type: event.data.type, id: event.data.id })
                this.handleMessage(event.data)
            }
            console.log('[Worker] TransformWorker initialized')
        } catch (error) {
            console.error('[Worker] Initialization error:', error)
            throw error
        }
    }

    private handleMessage(message: TransformMessage): void {
        try {
            console.log('[Worker] handleMessage received:', { type: message.type, id: message.id })
            
            if (!message.id) {
                console.error('[Worker] Message missing id:', message)
                return
            }

            switch (message.type) {
                case 'transform':
                    console.log('[Worker] Processing transform message')
                    this.handleTransform(message)
                    break
                case 'init':
                    console.log('[Worker] Processing init message')
                    this.handleInit(message)
                    break
                case 'reset':
                    console.log('[Worker] Processing reset message')
                    this.handleReset(message)
                    break
                default:
                    console.warn('[Worker] Unknown message type:', message.type)
            }
        } catch (error) {
            console.error('[Worker] Error handling message:', error)
            self.postMessage({
                id: message.id,
                commands: [],
                error: (error as Error).message
            } as TransformResponse)
        }
    }

    private handleInit(message: TransformMessage): void {
        try {
            console.log('[Worker] handleInit called, transformerStates provided:', !!message.transformerStates)
            if (message.transformerStates) {
                console.log('[Worker] Clearing', this.transformerStates.size, 'old transformer states')
                console.log('[Worker] Clearing', this.transformerInstances.size, 'old transformer instances')
                
                // Clear previous transformer states - this is a full replacement
                this.transformerStates.clear()
                this.transformerInstances.clear()
                
                // Store serialized states for later initialization
                const states = JSON.parse(message.transformerStates)
                console.log('[Worker] Parsed', Object.keys(states).length, 'new transformer states:', {
                    uuids: Object.keys(states)
                })
                
                Object.entries(states).forEach(([id, state]) => {
                    this.transformerStates.set(id, state)
                })
                console.log('[Worker] After init, have', this.transformerStates.size, 'transformers')
            }
            // Init message doesn't require a response
        } catch (error) {
            console.error('[Worker] Error in handleInit:', error)
            // Don't throw - just log the error
        }
    }

    private handleTransform(message: TransformMessage): void {
        try {
            if (!message.commands || !message.timerData) {
                throw new Error('Missing commands or timer data in transform message')
            }

            const commands = message.commands
            // Create a minimal timer object with necessary properties
            const timer = {
                bpm: message.timerData.bpm,
                now: message.timerData.now,
                startTime: message.timerData.startTime
            }
            
            let result = commands

            // Apply each transformer in sequence
            for (const [transformerId, state] of this.transformerStates) {
                const transformer = this.getOrCreateTransformer(transformerId, state)
                if (transformer && transformer.options?.enabled !== false) {
                    result = transformer.transform(result, timer)
                }
            }

            self.postMessage({
                id: message.id,
                commands: result
            } as TransformResponse)
        } catch (error) {
            console.error('[Worker] Error in handleTransform:', error)
            self.postMessage({
                id: message.id,
                commands: [],
                error: (error as Error).message
            } as TransformResponse)
        }
    }

    private handleReset(message: TransformMessage): void {
        try {
            // Clear transformer instances to reset state
            this.transformerInstances.clear()
            console.log('[Worker] Reset complete')
            // Reset message doesn't require a response
        } catch (error) {
            console.error('[Worker] Error in handleReset:', error)
        }
    }

    private getOrCreateTransformer(transformerId: string, state: any): any {
        if (!this.transformerInstances.has(transformerId)) {
            try {
                const config = typeof state === 'string' ? JSON.parse(state) : state
                if (!config.type) {
                    console.warn(`[Worker] Transformer config missing type for ${transformerId}:`, config)
                    return null
                }
                const transformer = tranformerFactory(config.type, config)
                this.transformerInstances.set(transformerId, transformer)
                return transformer
            } catch (error) {
                console.error(`[Worker] Failed to create transformer ${transformerId}:`, error)
                return null
            }
        }
        return this.transformerInstances.get(transformerId)
    }
}

// Instantiate the worker
try {
    new TransformWorker()
    console.log('[Worker] TransformWorker instantiated successfully')
} catch (error) {
    console.error('[Worker] Failed to instantiate TransformWorker:', error)
    // Worker initialization failed - the main thread should handle the fallback
}
