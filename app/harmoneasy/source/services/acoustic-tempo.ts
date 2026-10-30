import { EVENT_ENDED } from "audiobus/event-constants"
/** Tap/reference tempo disambiguates offbeats and half/double-time interpretations. */
export class AcousticTempoTracker {
	private last?: number
	private intervals: number[] = []
	confidence = 0
	constructor(public bpm: number) {}
	onset(time: number): number | undefined {
		if (!Number.isFinite(time)) {
			return
		}
		const previous = this.last
		if (previous !== undefined && time - previous < 0.14) {
			return
		}
		this.last = time
		if (previous === undefined || time - previous > 3) {
			this.intervals = []
			this.confidence = 0
			return
		}
		let interval = time - previous
		const reference = 60 / this.bpm
		while (interval > reference * 1.5) {
			interval /= 2
		}
		while (interval < reference * 0.66) {
			interval *= 2
		}
		this.intervals.push(interval)
		if (this.intervals.length > 8) {
			this.intervals.shift()
		}
		if (this.intervals.length < 3) {
			return
		}
		const sorted = [...this.intervals].sort((a, b) => a - b)
		const median = sorted[Math.floor(sorted.length / 2)]
		const deviation =
			this.intervals.reduce((sum, n) => sum + Math.abs(n - median), 0) /
			this.intervals.length /
			median
		this.confidence = Math.max(0, 1 - deviation * 4) * Math.min(1, this.intervals.length / 6)
		if (this.confidence < 0.55) {
			return
		}
		const target = Math.max(20, Math.min(400, 60 / median))
		this.bpm += Math.max(
			-this.bpm * 0.025,
			Math.min(this.bpm * 0.025, (target - this.bpm) * 0.2)
		)
		return this.bpm
	}
	reset(bpm = this.bpm): void {
		this.bpm = bpm
		this.last = undefined
		this.intervals = []
		this.confidence = 0
	}
	status(time: number): string {
		if (this.last === undefined) {
			return "Listening for a clear pulse"
		}
		if (time - this.last > 3) {
			this.confidence = 0
			return "No pulse; holding the last tempo"
		}
		return `${Math.round(this.confidence * 100)}% confidence · ${this.bpm.toFixed(1)} BPM`
	}
}

export class AcousticTempoFollower {
	private stream?: MediaStream
	private source?: MediaStreamAudioSourceNode
	private analyser?: AnalyserNode
	private frame = 0
	private generation = 0
	private floor = 0.002
	private armed = true
	private tracker: AcousticTempoTracker
	active = false
	threshold = 2.5
	constructor(
		private context: AudioContext,
		private getBpm: () => number,
		private accept: (bpm: number) => void,
		private status: (message: string) => void,
		private allowed: () => boolean
	) {
		this.tracker = new AcousticTempoTracker(getBpm())
	}
	async start(): Promise<void> {
		this.stop()
		const generation = ++this.generation
		try {
			if (!this.allowed()) {
				throw new Error("Choose Internal clock before acoustic following")
			}
			if (!navigator.mediaDevices?.getUserMedia) {
				throw new Error(
					"Microphone capture is unavailable in this browser; use a secure connection"
				)
			}
			await this.context.resume()
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
			})
			if (generation !== this.generation) {
				stream.getTracks().forEach((track) => track.stop())
				return
			}
			this.stream = stream
			this.source = this.context.createMediaStreamSource(stream)
			this.analyser = this.context.createAnalyser()
			this.analyser.fftSize = 1024
			this.source.connect(this.analyser)
			this.active = true
			this.floor = 0.002
			this.armed = true
			this.tracker.reset(this.getBpm())
			for (const track of stream.getTracks()) {
				track.addEventListener(
					EVENT_ENDED,
					() => {
						this.stop()
						this.status("Microphone disconnected; holding tempo")
					},
					{ once: true }
				)
			}
			const data = new Float32Array(this.analyser.fftSize)
			const sample = () => {
				if (!this.active) {
					return
				}
				if (!this.allowed() || document.hidden) {
					this.stop()
					this.status("Acoustic following stopped")
					return
				}
				this.analyser!.getFloatTimeDomainData(data)
				const rms = Math.sqrt(data.reduce((sum, n) => sum + n * n, 0) / data.length)
				const threshold = Math.max(0.008, this.floor * this.threshold)
				const time = performance.now() / 1000
				if (Math.abs(this.getBpm() - this.tracker.bpm) > 0.1) {
					this.tracker.reset(this.getBpm())
				}
				if (this.armed && rms > threshold) {
					const bpm = this.tracker.onset(time)
					if (bpm !== undefined) {
						this.accept(bpm)
					}
					this.armed = false
				}
				if (rms < threshold * 0.7) {
					this.armed = true
				}
				this.floor += (Math.max(0.001, rms) - this.floor) * (rms < this.floor ? 0.15 : 0.01)
				this.status(this.tracker.status(time))
				this.frame = requestAnimationFrame(sample)
			}
			this.frame = requestAnimationFrame(sample)
		} catch (error) {
			if (generation === this.generation) {
				this.stop()
				throw error
			}
		}
	}
	stop(): void {
		this.generation++
		this.active = false
		cancelAnimationFrame(this.frame)
		this.source?.disconnect()
		this.analyser?.disconnect()
		this.stream?.getTracks().forEach((track) => track.stop())
		this.source = undefined
		this.analyser = undefined
		this.stream = undefined
	}
}