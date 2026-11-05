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

import OutputPinkTrombone from "../../../packages/audiobus/io/outputs/output-pink-trombone"
import OutputSuperSonic from "../../../packages/audiobus/io/outputs/output-supersonic"
import OutputSiON from "../../../packages/audiobus/io/outputs/output-sion"
import Output303 from "../../../packages/audiobus/io/outputs/output-303"
import OutputYoshimi from "../../../packages/audiobus/io/outputs/output-yoshimi"
import OpenDAWVaporisateur from "../../../packages/audiobus/instruments/openDAW/opendaw-vaporisateur"

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

export async function measureOutputs(includeSharedMemory = true, only = "") {
	const bus = new AudioBus(0.5)
	await bus.loaded
	const context = bus.audioContext
	const url = URL.createObjectURL(
		new Blob(
			[
				`
 registerProcessor("level-capture", class extends AudioWorkletProcessor {
  constructor() { super(); this.port.onmessage = () => { this.remaining = sampleRate * 0.6; this.squares = this.count = this.peak = 0 } }
  process(inputs) {
   const samples = inputs[0]?.[0]
   if (this.remaining && samples) {
    for (const value of samples) {
     this.squares += value * value; this.peak = Math.max(this.peak, Math.abs(value)); this.count++
     if (--this.remaining === 0) { this.port.postMessage({rms: Math.sqrt(this.squares / this.count), peak: this.peak}); break }
    }
   }
   return true
  }
 })`
			],
			{ type: "application/javascript" }
		)
	)
	await context.audioWorklet.addModule(url)
	URL.revokeObjectURL(url)
	const capture = new AudioWorkletNode(context, "level-capture")
	const mute = context.createGain()
	mute.gain.value = 0
	bus.output.connect(capture).connect(mute).connect(context.destination)
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
	const vaporisateur = new OpenDAWVaporisateur(context)
	vaporisateur.output.connect(bus.mixer)
	const pink = new OutputPinkTrombone({ audioContext: context })
	const outputs = [
		oscillator,
		...instruments,
		new OutputTB303(context, bus.mixer),
		new OutputMoog(context, bus.mixer),
		new Output303({ audioContext: context, mixer: bus.mixer }),
		...(includeSharedMemory ? [vaporisateur, new OutputSuperSonic(bus.mixer)] : []),
		new OutputYoshimi(context, undefined, bus.mixer),
		new OutputSiON({ audioContext: context, mixer: bus.mixer }),
		pink,
		new OutputMetronome(context),
		kick,
		snare
	]
	try {
		for (const output of outputs) {
			if (only && output.name !== only) {
				continue
			}
			if (
				output instanceof OutputTB303 ||
				output instanceof OutputMoog ||
				output instanceof OutputYoshimi ||
				output instanceof OpenDAWVaporisateur ||
				output instanceof OutputSuperSonic ||
				output instanceof OutputPinkTrombone
			) {
				try {
					await output.connect()
				} catch (error) {
					console.log(JSON.stringify(results))
					throw error
				}
			}
			console.log("Measuring", output.name)
			// Warm lazy engines before measuring so network and module loading cannot
			// change the duration of the reference phrase.
			await output.noteOn(57, 80)
			await new Promise((resolve) => setTimeout(resolve, 600))
			output.allNotesOff()
			await new Promise((resolve) => setTimeout(resolve, 1200))
			const measured = new Promise<{ rms: number; peak: number }>((resolve) => {
				capture.port.onmessage = (event) => resolve(event.data)
			})
			capture.port.postMessage("capture")
			await output.noteOn(57, 80)
			results.push({
				name: output === oscillator ? "Oscillator" : output.name,
				...(await measured)
			})
			output.allNotesOff()
			await new Promise((resolve) => setTimeout(resolve, 1100))
		}
		drums.destroy()
		return results
	} finally {
		for (const output of outputs) {
			if ("destroy" in output && typeof output.destroy === "function") {
				await output.destroy()
			}
		}
		capture.disconnect()
		await context.close()
	}
}