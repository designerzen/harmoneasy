import { createReverbImpulseResponse } from "audiobus/effects/reverb"
import { connectCLAPMixer } from "audiobus/instruments/clap/clap-mixer"
import { setAudioDestination } from "audiobus/audio-destination"
import { EVENT_POINTER_DOWN, EVENT_KEY_DOWN } from "audiobus/event-constants"

export default class AudioBus extends EventTarget {
	#audioContext: AudioContext
	#mixer: GainNode
	#reverb: ConvolverNode
	#output: GainNode

	loaded: Promise<void>

	get audioContext(): AudioContext {
		return this.#audioContext
	}

	get mixer(): GainNode {
		return this.#mixer
	}

	get reverb(): ConvolverNode {
		return this.#reverb
	}

	get output(): GainNode {
		return this.#output
	}

	get hasAudioWorklets() {
		return !!this.#audioContext.audioWorklet
	}

	set volume(value: number) {
		this.#output.gain.value = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
	}

	constructor(initialVolume: number = 1, waitForActivation: boolean = true) {
		super()

		// Create AudioContext - only called after user interaction
		const context = new (window.AudioContext || (window as any).webkitAudioContext)()

		const mixer: GainNode = context.createGain()

		const reverb = context.createConvolver()
		reverb.buffer = createReverbImpulseResponse(context, 1, 7)

		// save for later use
		this.#audioContext = context
		this.#mixer = mixer
		this.#reverb = reverb
		this.#output = context.createGain()
		setAudioDestination(context, this.#output)
		this.volume = initialVolume

		// Split after insert effects so the dry path cannot bypass the effect rack.
		const effectsOutput = context.createGain()
		const dry = context.createGain()
		const wet = context.createGain()
		dry.gain.value = 0.85
		wet.gain.value = 0.15
		connectCLAPMixer(mixer, effectsOutput)
		effectsOutput.connect(dry)
		dry.connect(this.#output)
		effectsOutput.connect(reverb)
		reverb.connect(wet)
		wet.connect(this.#output)
		this.#output.connect(context.destination)

		// Resume if suspended (required by browser autoplay policy)
		// This must complete before AudioWorklet can be used
		if (waitForActivation) {
			this.loaded = this.resumeContext()
		} else {
			// Direct preset links can build their UI before the browser permits sound.
			// The first playing gesture resumes the context without another start dialog.
			const unlock = () => {
				void this.resumeContext().then(() => {
					if (context.state === "running") {
						document.removeEventListener(EVENT_POINTER_DOWN, unlock, true)
						document.removeEventListener(EVENT_KEY_DOWN, unlock, true)
					}
				})
			}
			document.addEventListener(EVENT_POINTER_DOWN, unlock, true)
			document.addEventListener(EVENT_KEY_DOWN, unlock, true)
			unlock()
			this.loaded = Promise.resolve()
		}
	}

	private async resumeContext(): Promise<void> {
		if (this.#audioContext.state === "suspended") {
			try {
				await this.#audioContext.resume()
				console.info("AudioContext resumed")
			} catch (err) {
				console.warn("Failed to resume AudioContext:", err)
			}
		}
	}
}