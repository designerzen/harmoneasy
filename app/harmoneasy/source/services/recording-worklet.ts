import { RECORDING_PROCESSOR, RECORDING_START, RECORDING_STOP, RECORDING_DATA } from './recording-format'

declare const AudioWorkletProcessor: { new(): { port: MessagePort } }
declare function registerProcessor(name: string, processor: unknown): void

class RecordingProcessor extends AudioWorkletProcessor {
    private recording = false
    private samples = new Float32Array(8192)
    private offset = 0

    constructor() {
        super()
        this.port.onmessage = ({ data }) => {
            if (data === RECORDING_START) this.recording = true
            if (data === RECORDING_STOP) {
                this.recording = false
                this.flush()
                this.port.postMessage({ type: RECORDING_STOP })
            }
        }
    }

    private flush() {
        if (!this.offset) return
        const samples = this.samples.slice(0, this.offset)
        this.port.postMessage({ type: RECORDING_DATA, samples }, [samples.buffer])
        this.offset = 0
    }

    process(inputs: Float32Array[][]): boolean {
        if (!this.recording) return true
        const channels = inputs[0]
        const length = channels?.[0]?.length ?? 128
        for (let i = 0; i < length; i++) {
            this.samples[this.offset++] = channels?.[0]?.[i] ?? 0
            this.samples[this.offset++] = (channels?.[1] ?? channels?.[0])?.[i] ?? 0
            if (this.offset === this.samples.length) this.flush()
        }
        return true
    }
}
registerProcessor(RECORDING_PROCESSOR, RecordingProcessor)
