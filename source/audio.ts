import { createReverbImpulseResponse } from "./libs/audiobus/effects/reverb"

export default class AudioBus extends EventTarget {
	
	#audioContext:AudioContext
	#mixer:GainNode
	#reverb:ConvolverNode

	get audioContext():AudioContext {
		return this.#audioContext
	}

	get mixer():GainNode {
		return this.#mixer
	}

	get reverb():ConvolverNode {
		return this.#reverb
	}

	set volume( value:number ) {
		this.#mixer.gain.value = value * 0.5
	}

	constructor() {
		super()
	}

	initialise( initialVolume:number=1 ) {
		const context = new AudioContext()

		const mixer: GainNode = context.createGain()
		
		const reverb = context.createConvolver()
		reverb.buffer = createReverbImpulseResponse( context, 1, 7 )

		mixer.connect(reverb)
		reverb.connect( context.destination)

		// save for later use
		this.#audioContext = context
		this.#mixer = mixer
		this.#reverb = reverb

		this.volume = initialVolume 
	
		return { context, mixer, reverb }
	}
}