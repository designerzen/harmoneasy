import AudioBus from '../source/audio'
import OutputTB303 from '../../../packages/audiobus/io/outputs/output-tb303'
import OutputMoog from '../../../packages/audiobus/io/outputs/output-moog'
import SynthOscillator from '../../../packages/audiobus/instruments/oscillators/synth-oscillator'

export async function measureOutputs() {
    const bus = new AudioBus(0.5)
    await bus.loaded
    const context = bus.audioContext
    const analyser = context.createAnalyser()
    analyser.fftSize = 2048
    bus.output.connect(analyser)
    const results: { name: string; rms: number; peak: number }[] = []
    const oscillator = new SynthOscillator(context)
    oscillator.output.connect(bus.mixer)
    const outputs = [oscillator, new OutputTB303(context, bus.mixer), new OutputMoog(context, bus.mixer)]
    try {
        for (const output of outputs) {
            if (output instanceof OutputTB303 || output instanceof OutputMoog) await output.connect()
            await output.noteOn(57, 80)
            const samples = new Float32Array(analyser.fftSize)
            let squares = 0, count = 0, peak = 0
            for (let i = 0; i < 50; i++) {
                await new Promise(resolve => setTimeout(resolve, 10))
                analyser.getFloatTimeDomainData(samples)
                for (const value of samples) { squares += value * value; peak = Math.max(peak, Math.abs(value)); count++ }
            }
            results.push({ name: output === oscillator ? 'Oscillator' : output.name, rms: Math.sqrt(squares / count), peak })
            output.allNotesOff()
            await new Promise(resolve => setTimeout(resolve, 1100))
        }
        return results
    } finally {
        for (const output of outputs) {
            if (output instanceof OutputTB303 || output instanceof OutputMoog) await output.destroy()
        }
        await context.close()
    }
}
