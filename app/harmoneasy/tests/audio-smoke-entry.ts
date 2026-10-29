import AudioBus from "../source/audio"
import OutputTB303 from "../../../packages/audiobus/io/outputs/output-tb303"
import OutputMoog from "../../../packages/audiobus/io/outputs/output-moog"
import SynthOscillator from "../../../packages/audiobus/instruments/oscillators/synth-oscillator"
import PolySynth from "../../../packages/audiobus/instruments/polyphonic"
import ToneSynth from "../../../packages/audiobus/instruments/tone/tone-synth"
import ToneMonoSynth from "../../../packages/audiobus/instruments/tone/tone-mono-synth"
import ToneFMSynth from "../../../packages/audiobus/instruments/tone/tone-fm-synth"
import TonePluck from "../../../packages/audiobus/instruments/tone/tone-pluck-string"
import OutputMetronome from "../../../packages/audiobus/io/outputs/output-metronome"
import { PercussionSynth } from "../../../packages/audiobus/instruments/percussion/percussion-synth"

export async function measurePolyphony() {
	const results = []
	for (const notes of [[57], Array.from({ length: 24 }, (_, i) => 48 + i)]) {
		const context = new OfflineAudioContext(2, 48000, 48000)
		const synth = new PolySynth(context as unknown as AudioContext, {
			class: SynthOscillator,
			attack: 0.01,
			shape: "square"
		})
		synth.output.connect(context.destination)
		await Promise.resolve()
		for (const note of notes) {
			await synth.noteOn(note, 127)
		}
		const buffer = await context.startRendering()
		const samples = buffer.getChannelData(0)
		let peak = 0,
			squares = 0
		for (const value of samples) {
			peak = Math.max(peak, Math.abs(value))
			squares += value * value
		}
		results.push({ voices: notes.length, peak, rms: Math.sqrt(squares / samples.length) })
	}
	return results
}

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
	const poly = new PolySynth(context)
	const instruments = [
		poly,
		new ToneSynth(context),
		new ToneMonoSynth(context),
		new ToneFMSynth(context),
		new TonePluck(context)
	]
	for (const instrument of instruments) {
		instrument.output.connect(bus.mixer)
	}
	const drums = new PercussionSynth(context, bus.mixer)
	const kick = {
		name: "Drum kick",
		noteOn: () =>
			drums.trigger({ part: "kick", velocity: 80 / 127, triggerAt: context.currentTime }),
		allNotesOff: () => drums.allNotesOff()
	}
	const snare = {
		...kick,
		name: "Drum snare",
		noteOn: () =>
			drums.trigger({ part: "snare", velocity: 80 / 127, triggerAt: context.currentTime })
	}
	const outputs = [
		oscillator,
		...instruments,
		new OutputTB303(context, bus.mixer),
		new OutputMoog(context, bus.mixer),
		new OutputMetronome(context),
		kick,
		snare
	]
	try {
		for (const output of outputs) {
			if (output instanceof OutputTB303 || output instanceof OutputMoog) {
				await output.connect()
			}
			await output.noteOn(57, 80)
			const samples = new Float32Array(analyser.fftSize)
			let squares = 0,
				count = 0,
				peak = 0
			for (let i = 0; i < 50; i++) {
				await new Promise((resolve) => setTimeout(resolve, 10))
				analyser.getFloatTimeDomainData(samples)
				for (const value of samples) {
					squares += value * value
					peak = Math.max(peak, Math.abs(value))
					count++
				}
			}
			results.push({
				name: output === oscillator ? "Oscillator" : output.name,
				rms: Math.sqrt(squares / count),
				peak
			})
			output.allNotesOff()
			await new Promise((resolve) => setTimeout(resolve, 1100))
		}
		drums.destroy()
		return results
	} finally {
		for (const output of outputs) {
			if (output instanceof OutputTB303 || output instanceof OutputMoog) {
				await output.destroy()
			}
		}
		await context.close()
	}
}