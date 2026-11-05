/** Passive stereo taps. No nodes or animation callbacks exist while stopped. */
export function createMixerMeter(host: HTMLElement, source: () => AudioNode | undefined) {
	const lanes = [0, 1].map(() => {
		const lane = document.createElement("span")
		lane.className = "mixer-meter-lane"
		const fill = document.createElement("span")
		fill.className = "mixer-meter-fill"
		const peak = document.createElement("span")
		peak.className = "mixer-meter-peak"
		lane.append(fill, peak)
		host.append(lane)
		return { fill, peak, level: -60, held: -60, holdUntil: 0 }
	})
	host.classList.add("mixer-meter")
	host.setAttribute("role", "meter")
	host.setAttribute("aria-label", "Output level in dBFS")
	host.setAttribute("aria-valuemin", "-60")
	host.setAttribute("aria-valuemax", "0")
	host.setAttribute("aria-valuenow", "-60")
	let node: AudioNode | undefined
	let splitter: ChannelSplitterNode | undefined
	let analysers: AnalyserNode[] = []
	let buffers: Float32Array<ArrayBuffer>[] = []
	let previous = 0,
		clippedUntil = 0
	const decibels = (value: number) => Math.max(-60, 20 * Math.log10(Math.max(0.001, value)))
	const detach = () => {
		if (node && splitter) {
			try {
				node.disconnect(splitter)
			} catch {
				/* The Output may already be destroyed. */
			}
		}
		splitter?.disconnect()
		analysers.forEach((analyser) => analyser.disconnect())
		node = undefined
		splitter = undefined
		analysers = []
		buffers = []
	}
	return {
		read(now: number) {
			const candidate = source()
			const current = candidate?.context.state === "closed" ? undefined : candidate
			if (current !== node) {
				detach()
				if (current?.context?.createAnalyser && current.context.state !== "closed") {
					node = current
					splitter = current.context.createChannelSplitter(2)
					analysers = lanes.map((_, channel) => {
						const analyser = current.context.createAnalyser()
						analyser.fftSize = 1024
						splitter!.connect(analyser, channel)
						return analyser
					})
					buffers = analysers.map((analyser) => new Float32Array(analyser.fftSize))
					current.connect(splitter)
				}
			}
			const elapsed = Math.min(0.1, previous ? (now - previous) / 1000 : 1 / 30)
			previous = now
			let maximum = -60
			lanes.forEach((lane, channel) => {
				let energy = 0,
					peak = 0
				if (analysers[channel]) {
					analysers[channel].getFloatTimeDomainData(buffers[channel])
					for (const sample of buffers[channel]) {
						energy += sample * sample
						peak = Math.max(peak, Math.abs(sample))
					}
				}
				const rms = decibels(Math.sqrt(energy / (buffers[channel]?.length || 1)))
				lane.level +=
					(rms - lane.level) * (1 - Math.exp(-elapsed / (rms > lane.level ? 0.06 : 0.3)))
				const peakDb = decibels(peak)
				if (peakDb >= lane.held) {
					lane.held = peakDb
					lane.holdUntil = now + 1000
				} else if (now > lane.holdUntil) {
					lane.held = Math.max(-60, lane.held - elapsed * 18)
				}
				if (peak >= 1) {
					clippedUntil = now + 1500
				}
				lane.fill.style.clipPath = `inset(${100 - (lane.level + 60) / 0.6}% 0 0)`
				lane.peak.style.bottom = `${Math.min(100, (lane.held + 60) / 0.6)}%`
				maximum = Math.max(maximum, peakDb)
			})
			host.classList.toggle("is-clipping", now < clippedUntil)
			host.setAttribute("aria-valuenow", String(Math.min(0, Math.round(maximum))))
			host.setAttribute(
				"aria-valuetext",
				now < clippedUntil ? "Clipping" : `${maximum.toFixed(1)} dBFS peak`
			)
		},
		stop() {
			detach()
			previous = clippedUntil = 0
			host.classList.remove("is-clipping")
			host.setAttribute("aria-valuenow", "-60")
			for (const lane of lanes) {
				lane.level = lane.held = -60
				lane.holdUntil = 0
				lane.fill.style.clipPath = "inset(100% 0 0)"
				lane.peak.style.bottom = "0%"
			}
		}
	}
}