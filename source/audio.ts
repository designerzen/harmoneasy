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

	constructor() {
		super()
	}

	initialise( initialVolume:number=1 ) {
		const context = new AudioContext()

		const mixer: GainNode = context.createGain()
		mixer.gain.value = initialVolume
	
		const reverb = context.createConvolver()
		reverb.buffer = createReverbImpulseResponse( context, 1, 7 )

		mixer.connect(reverb)
		reverb.connect( context.destination)

		// save for later use
		this.#audioContext = context
		this.#mixer = mixer
		this.#reverb = reverb

		return { context, mixer, reverb }
	}
}