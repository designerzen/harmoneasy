import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { setEssentiaWorkerFactory } from "audiobus/analysis/essentia-client"
import { AcousticTempoFollower, AcousticTempoTracker } from "../source/services/acoustic-tempo"

class FakeWorker {
	sent: any[] = []
	listener?: (event: { data: any }) => void
	addEventListener(_: string, listener: any) {
		this.listener = listener
	}
	postMessage(message: any) {
		this.sent.push(message)
	}
	terminate() {}
	emit(message: any) {
		this.listener?.({
			data: { id: this.sent.find((item) => item.type === "stream-start").id, ...message }
		})
	}
}

let follower: AcousticTempoFollower
let worker: FakeWorker
let capture: any
let next: FrameRequestCallback
let level: number
let allowed: boolean
let context: any
let track: any
let source: any
let analyser: any
let status: ReturnType<typeof vi.fn>
let accept: ReturnType<typeof vi.fn>

beforeEach(() => {
	worker = new FakeWorker()
	setEssentiaWorkerFactory(() => worker as any)
	level = 0
	allowed = true
	vi.stubGlobal("document", { hidden: false })
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn((callback) => {
			next = callback
			return 1
		})
	)
	vi.stubGlobal("cancelAnimationFrame", vi.fn())
	vi.stubGlobal(
		"AudioWorkletNode",
		class {
			port = { onmessage: null, close: vi.fn() }
			connect = vi.fn()
			disconnect = vi.fn()
			constructor() {
				capture = this
			}
		}
	)
	track = { stop: vi.fn(), addEventListener: vi.fn() }
	vi.stubGlobal("navigator", {
		mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) }
	})
	source = { connect: vi.fn(), disconnect: vi.fn() }
	analyser = {
		fftSize: 1024,
		disconnect: vi.fn(),
		getFloatTimeDomainData: vi.fn((data: Float32Array) => data.fill(level))
	}
	context = {
		currentTime: 10,
		sampleRate: 48000,
		destination: {},
		resume: vi.fn(async () => {}),
		audioWorklet: { addModule: vi.fn(async () => {}) },
		createMediaStreamSource: vi.fn(() => source),
		createAnalyser: vi.fn(() => analyser)
	}
	status = vi.fn()
	accept = vi.fn()
	follower = new AcousticTempoFollower(
		context,
		() => 120,
		accept,
		status,
		() => allowed
	)
})
afterEach(() => {
	follower.stop()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe("Essentia acoustic tempo following", () => {
	it("uses capture-clock onsets independently of worker delivery latency", async () => {
		const onset = vi.spyOn(AcousticTempoTracker.prototype, "onset")
		follower.threshold = 3
		await follower.start()
		expect(worker.sent[0]).toMatchObject({
			type: "stream-start",
			options: {
				sampleRate: 48000,
				frameSize: 1024,
				hopSize: 512,
				features: ["onset"],
				onsetThreshold: 3
			}
		})
		const samples = new Float32Array(128)
		context.currentTime = 30
		capture.port.onmessage({ data: { samples, time: 10.1 } })
		expect(worker.sent.at(-1)).toMatchObject({ type: "stream-samples", samples })
		worker.emit({
			type: "frame-result",
			frames: [
				{ time: 0.25, rms: 1, onset: { detected: false, strength: 1 } },
				...[0, 0.5, 1, 1.5, 2].map((time) => ({
					time,
					rms: 1,
					onset: { detected: true, strength: 1 }
				}))
			]
		})
		expect(onset.mock.calls.map(([time]) => time)).toEqual([10.1, 10.6, 11.1, 11.6, 12.1])
		expect(accept).toHaveBeenCalledWith(120)
		expect(status).toHaveBeenCalledWith("No pulse; holding the last tempo")
		next(0)
		expect(analyser.getFloatTimeDomainData).not.toHaveBeenCalled()
	})

	it("stops analysis, releases capture and ignores late results", async () => {
		const onset = vi.spyOn(AcousticTempoTracker.prototype, "onset")
		await follower.start()
		const message = capture.port.onmessage
		follower.stop()
		expect(worker.sent.at(-1)).toMatchObject({ type: "stream-stop" })
		expect(capture.port.onmessage).toBeNull()
		expect(capture.port.close).toHaveBeenCalledOnce()
		expect(capture.disconnect).toHaveBeenCalledOnce()
		expect(analyser.disconnect).toHaveBeenCalledOnce()
		expect(track.stop).toHaveBeenCalledOnce()
		message({ data: { samples: new Float32Array(128), time: 11 } })
		worker.emit({ type: "frame-result", frames: [{ time: 0, onset: { detected: true } }] })
		expect(onset).not.toHaveBeenCalled()
		expect(follower.active).toBe(false)
	})

	it("falls back to energy detection if Essentia fails", async () => {
		await follower.start()
		worker.emit({ type: "error", message: "WASM failed" })
		expect(status).toHaveBeenCalledWith(
			"Essentia unavailable; using energy-based onset detection"
		)
		expect(worker.sent.at(-1)).toMatchObject({ type: "stream-stop" })
		expect(capture.disconnect).toHaveBeenCalledOnce()
		for (let beat = 0; beat < 5; beat++) {
			context.currentTime = 10 + beat * 0.5
			level = 0.1
			next(0)
			context.currentTime += 0.1
			level = 0
			next(0)
		}
		expect(accept).toHaveBeenCalledWith(120)
		expect(status.mock.calls.at(-1)?.[0]).toContain("Energy-based onset detection")
		expect(follower.active).toBe(true)
	})

	it("falls back if capture cannot be loaded", async () => {
		context.audioWorklet.addModule.mockRejectedValueOnce(new Error("unavailable"))
		await follower.start()
		expect(follower.active).toBe(true)
		next(0)
		expect(analyser.getFloatTimeDomainData).toHaveBeenCalledOnce()
		expect(status.mock.calls[0][0]).toContain("using energy-based")
	})

	it.each(["hidden", "not allowed", "ended"])("releases resources when %s", async (reason) => {
		await follower.start()
		if (reason === "hidden") {
			Object.assign(document, { hidden: true })
		}
		if (reason === "not allowed") {
			allowed = false
		}
		if (reason === "ended") {
			track.addEventListener.mock.calls[0][1]()
		}
		next(0)
		expect(follower.active).toBe(false)
		expect(track.stop).toHaveBeenCalledOnce()
		expect(worker.sent.at(-1)).toMatchObject({ type: "stream-stop" })
	})

	it("does not create capture after a cancelled worklet load", async () => {
		let resolve!: () => void
		context.audioWorklet.addModule.mockImplementationOnce(
			() =>
				new Promise<void>((done) => {
					resolve = done
				})
		)
		const start = follower.start()
		await vi.waitFor(() => expect(context.audioWorklet.addModule).toHaveBeenCalled())
		follower.stop()
		resolve()
		await start
		expect(worker.sent).toEqual([])
		expect(track.stop).toHaveBeenCalledOnce()
		expect(follower.active).toBe(false)
	})
})