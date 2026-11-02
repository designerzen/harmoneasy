import type { VisualiserSource } from "control-surface/types"
import type { IAudioOutput } from "audiobus/io/outputs/output-interface"
import { deviceId } from "audiobus/io/device-definition"

/** Passive output taps are created only when a visible visualiser requests samples. */
export function surfaceAudioSources(outputs: readonly IAudioOutput[]) {
	const disposers: (() => void)[] = []
	const sources: VisualiserSource[] = []
	for (const output of outputs) {
		const initial = output.output as AudioNode | undefined
		if (!output.hasAudioOutput?.() && !initial?.context?.createAnalyser) {
			continue
		}
		let node: AudioNode | undefined, analyser: AnalyserNode | undefined
		let waveform: Float32Array<ArrayBuffer>, frequency: Uint8Array<ArrayBuffer>
		const spectrum = new Float32Array(128)
		const detach = () => {
			if (node && analyser) {
				try {
					node.disconnect(analyser)
				} catch {
					/* Engine already removed its output. */
				}
			}
			analyser?.disconnect()
			analyser = undefined
			node = undefined
		}
		disposers.push(detach)
		sources.push({
			id: `audio:${deviceId(output)}`,
			sourceId: deviceId(output),
			label: `${output.name} audio`,
			kinds: ["waveform", "spectrum", "level"],
			read(kind) {
				const current = output.output as AudioNode | undefined
				if (!current?.context?.createAnalyser || current.context.state === "closed") {
					detach()
					return undefined
				}
				if (node !== current || !analyser) {
					detach()
					node = current
					analyser = current.context.createAnalyser()
					analyser.fftSize = 1024
					analyser.smoothingTimeConstant = 0.65
					waveform = new Float32Array(analyser.fftSize)
					frequency = new Uint8Array(analyser.frequencyBinCount)
					node.connect(analyser)
				}
				analyser.getFloatTimeDomainData(waveform)
				let energy = 0
				for (const value of waveform) {
					energy += value * value
				}
				const level = Math.min(1, Math.sqrt(energy / waveform.length))
				if (kind === "spectrum") {
					analyser.getByteFrequencyData(frequency)
					for (let i = 0; i < spectrum.length; i++) {
						const start = Math.floor(
								Math.exp((i / spectrum.length) * Math.log(frequency.length)) - 1
							),
							end = Math.max(
								start + 1,
								Math.ceil(
									Math.exp(
										((i + 1) / spectrum.length) * Math.log(frequency.length)
									) - 1
								)
							)
						let peak = 0
						for (let bin = start; bin < Math.min(end, frequency.length); bin++) {
							peak = Math.max(peak, frequency[bin] / 255)
						}
						spectrum[i] = peak
					}
				}
				return { samples: kind === "waveform" ? waveform : spectrum, level }
			}
		})
	}
	return {
		sources,
		destroy() {
			disposers.forEach((dispose) => dispose())
		}
	}
}