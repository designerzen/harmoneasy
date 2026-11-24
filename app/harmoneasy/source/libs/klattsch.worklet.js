import { FormantSynth } from "klattsch/engine/synth-core.js"

// Stop processing completed or released notes so auditioning cannot leave DSP running.
class KlattschProcessor extends AudioWorkletProcessor {
	constructor({ processorOptions }) {
		super()
		this.synths = processorOptions.voices.map(
			({ schedule }) => new FormantSynth({ sampleRate, schedule })
		)
		this.remaining = Math.ceil((processorOptions.totalMs * sampleRate) / 1000)
		this.port.onmessage = () => {
			this.remaining = 0
		}
	}

	process(_inputs, outputs) {
		if (this.remaining <= 0) {
			return false
		}
		outputs.forEach((channels, index) => this.synths[index].process(channels[0]))
		this.remaining -= outputs[0][0].length
		if (this.remaining <= 0) {
			this.port.postMessage("ended")
			return false
		}
		return true
	}
}

registerProcessor("harmoneasy-klattsch", KlattschProcessor)