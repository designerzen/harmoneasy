import { createReverbImpulseResponse } from "audiobus/effects/reverb"

export default class AudioBus extends EventTarget {
	
	#audioContext:AudioContext
	#mixer:GainNode
	#reverb:ConvolverNode
	
	loaded:Promise<void>

	get audioContext():AudioContext {
		return this.#audioContext
	}

	get mixer():GainNode {
		return this.#mixer
	}

	get reverb():ConvolverNode {
		return this.#reverb
	}

	get hasAudioWorklets(){
		return !!this.#audioContext.audioWorklet
	}

	set volume( value:number ) {
		this.#mixer.gain.value = value * 0.5
	}

	constructor( initialVolume:number=1 ) {
		super()

		// Create AudioContext - only called after user interaction
		const context = new (window.AudioContext || (window as any).webkitAudioContext)()
		
		const mixer: GainNode = context.createGain()
		
		const reverb = context.createConvolver()
		reverb.buffer = createReverbImpulseResponse( context, 1, 7 )

		// save for later use
		this.#audioContext = context
		this.#mixer = mixer
		this.#reverb = reverb
		this.volume = initialVolume

		mixer.connect(reverb)
		reverb.connect( context.destination)

		// Resume if suspended (required by browser autoplay policy)
		// This must complete before AudioWorklet can be used
		this.loaded = this.resumeContext()
	}

	private async resumeContext(): Promise<void> {
		if (this.#audioContext.state === 'suspended') {
			try {
				await this.#audioContext.resume()
				console.info('AudioContext resumed')
			} catch (err) {
				console.warn('Failed to resume AudioContext:', err)
			}
		}
	}
}
