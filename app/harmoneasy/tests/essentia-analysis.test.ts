import { createRequire } from "node:module"
import { beforeAll, describe, expect, it } from "vitest"
import {
	ANALYSIS_SAMPLE_RATE,
	analyseTrack,
	createFrameAnalyser,
	pitchClassFromName
} from "../../../packages/audiobus/analysis/essentia-features"
import {
	chordNotes,
	estimateKey,
	matchChord
} from "../../../packages/audiobus/analysis/chroma-harmony"
import { StreamFramer } from "../../../packages/audiobus/analysis/stream-framer"
import {
	analyseAudioBuffer,
	createAnalysisStream,
	setEssentiaWorkerFactory
} from "../../../packages/audiobus/analysis/essentia-client"

// The ES build expects a browser or worker; Node loads the CommonJS build.
const require = createRequire(new URL("../../../packages/audiobus/package.json", import.meta.url))
let essentia: any

beforeAll(() => {
	const { EssentiaWASM, Essentia } = require("essentia.js")
	essentia = new Essentia(EssentiaWASM)
})

const rate = ANALYSIS_SAMPLE_RATE
const tone = (frequencies: number[], seconds: number, sampleRate = rate) => {
	const samples = new Float32Array(Math.round(seconds * sampleRate))
	for (let i = 0; i < samples.length; i++) {
		for (const frequency of frequencies) {
			samples[i] +=
				(0.2 * Math.sin((2 * Math.PI * frequency * i) / sampleRate)) / frequencies.length
		}
	}
	return samples
}
const addClicks = (samples: Float32Array, bpm: number) => {
	let seed = 1
	for (let start = 0; start < samples.length; start += Math.round((60 / bpm) * rate)) {
		for (let k = 0; k < 800 && start + k < samples.length; k++) {
			seed = (seed * 16807) % 2147483647
			samples[start + k] += ((seed / 2147483647) * 2 - 1) * Math.exp(-k / 120)
		}
	}
	return samples
}

describe("analyseTrack", () => {
	it("finds tempo, beats and key of a clicked A minor triad", () => {
		const samples = addClicks(tone([220, 261.63, 329.63], 8), 120)
		const result = analyseTrack(essentia, [samples])
		expect(result.bpm).toBeCloseTo(120, 0)
		expect(result.beats.length).toBeGreaterThan(8)
		expect(result.keyName).toBe("A")
		expect(result.key).toBe(9)
		expect(result.scale).toBe("minor")
		expect(result.duration).toBeCloseTo(8, 1)
		expect(result.loudness).toBeLessThan(0)
	})
})

describe("createFrameAnalyser", () => {
	it("tracks pitch, chroma, onsets and spectral features", () => {
		const analyser = createFrameAnalyser(essentia, {
			sampleRate: rate,
			frameSize: 2048,
			features: ["pitch", "chroma", "onset", "spectral"]
		})
		const a4 = tone([440], 0.05)
		const result = analyser.analyse(a4.subarray(0, 2048), 0)
		expect(result.pitch!.frequency).toBeCloseTo(440, -1)
		expect(result.pitch!.confidence).toBeGreaterThan(0.8)
		expect(result.chroma!.indexOf(Math.max(...result.chroma!))).toBe(9)
		expect(result.spectral!.mfcc).toHaveLength(13)
		expect(result.spectral!.centroid).toBeGreaterThan(0)
		expect(result.spectral!.centroid).toBeLessThan(1)

		const quiet = new Float32Array(2048)
		const onsets = [
			quiet,
			quiet,
			quiet,
			quiet,
			quiet,
			addClicks(new Float32Array(2048), 60)
		].map((frame, index) => analyser.analyse(frame, index).onset!.detected)
		expect(onsets).toEqual([false, false, false, false, false, true])
		analyser.dispose()
	})
})

describe("chroma harmony", () => {
	it("matches triads and keys", () => {
		const chroma = new Array(12).fill(0.05)
		for (const pc of [2, 5, 9]) {
			chroma[pc] = 1
		}
		expect(matchChord(chroma)).toMatchObject({ root: 2, quality: "minor" })
		expect(chordNotes({ root: 2, quality: "minor" })).toEqual([2, 5, 9])
		expect(matchChord(new Array(12).fill(0))).toBeUndefined()

		const cMajorScale = new Array(12).fill(0)
		for (const [pc, weight] of [
			[0, 3],
			[2, 1],
			[4, 2],
			[5, 1],
			[7, 2.5],
			[9, 1],
			[11, 1]
		]) {
			cMajorScale[pc] = weight
		}
		expect(estimateKey(cMajorScale)).toMatchObject({ root: 0, scale: "major" })
		expect(pitchClassFromName("Bb")).toBe(10)
		expect(pitchClassFromName("F#")).toBe(6)
	})
})

describe("StreamFramer", () => {
	it("emits overlapping frames across chunk boundaries", () => {
		const framer = new StreamFramer(4, 2)
		const ramp = Float32Array.from({ length: 9 }, (_, i) => i)
		const frames = [...framer.push(ramp.subarray(0, 3)), ...framer.push(ramp.subarray(3))]
		expect(frames.map(({ offset }) => offset)).toEqual([0, 2, 4])
		expect(Array.from(frames[2].frame)).toEqual([4, 5, 6, 7])
	})
})

describe("essentia client", () => {
	class FakeWorker {
		sent: any[] = []
		private listener?: (event: { data: unknown }) => void
		addEventListener(_: string, listener: any) {
			this.listener = listener
		}
		postMessage(message: any) {
			this.sent.push(message)
			if (message.type === "analyse-track") {
				queueMicrotask(() =>
					this.listener?.({
						data: { type: "track-result", id: message.id, result: { bpm: 99 } }
					})
				)
			}
			if (message.type === "stream-samples") {
				queueMicrotask(() =>
					this.listener?.({
						data: {
							type: "frame-result",
							id: message.id,
							frames: [{ time: 0, rms: 1 }]
						}
					})
				)
			}
		}
		terminate() {}
	}

	it("sends 44.1 kHz audio and streams frames", async () => {
		const fake = new FakeWorker()
		setEssentiaWorkerFactory(() => fake as any)
		const data = tone([440], 1)
		const buffer = {
			duration: 1,
			sampleRate: rate,
			numberOfChannels: 1,
			getChannelData: () => data
		} as unknown as AudioBuffer
		await expect(analyseAudioBuffer(buffer, { maxSeconds: 0.5 })).resolves.toEqual({ bpm: 99 })
		expect(fake.sent[0].channels[0]).toHaveLength(rate / 2)

		const received: unknown[] = []
		const stream = createAnalysisStream({ sampleRate: rate, features: ["onset"] }, (frames) =>
			received.push(...frames)
		)
		stream.push(new Float32Array(16))
		await new Promise((resolve) => setTimeout(resolve))
		expect(received).toEqual([{ time: 0, rms: 1 }])
		stream.stop()
		expect(fake.sent.at(-1)).toMatchObject({ type: "stream-stop" })
	})
})