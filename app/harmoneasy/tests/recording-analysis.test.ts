// @vitest-environment happy-dom
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { encodeWave } from "../../../packages/audiobus/io/recording/recording-format"
import {
	analyseTake,
	bpmConfidenceLabel,
	formatTakeAnalysis,
	normalisationGain,
	normaliseWave
} from "../source/services/recording-analysis"
import { createRecordingControls } from "../source/services/recording-dialog"

const { analyseAudioBuffer, convertAudioMedia } = vi.hoisted(() => ({
	analyseAudioBuffer: vi.fn(),
	convertAudioMedia: vi.fn()
}))

vi.mock("../../../packages/audiobus/analysis/essentia-client", () => ({
	analyseAudioBuffer
}))
vi.mock("../../../packages/audiobus/io/media/audio-media", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../../packages/audiobus/io/media/audio-media")>()),
	convertAudioMedia
}))
vi.mock("../../../packages/audiobus/io/recording/audio-recording", async () => {
	const { RECORDING_STATE_CHANGED, encodeWave } =
		await import("../../../packages/audiobus/io/recording/recording-format")
	return {
		getAudioRecording: () => {
			const blobs = { 16: takeWave(16), 32: takeWave(32) } as Record<number, Blob>
			return new (class extends EventTarget {
				state = "idle"
				frames = 0
				sampleRate = TAKE_RATE
				storage = "opfs"
				error = ""
				duration = 1
				ready = Promise.resolve()
				get hasTake() {
					return this.frames > 0
				}
				change() {
					this.dispatchEvent(new Event(RECORDING_STATE_CHANGED))
				}
				async start() {
					this.frames = 0
					this.state = "recording"
					this.change()
				}
				async stop() {
					this.frames = TAKE_RATE
					this.state = "idle"
					this.change()
				}
				wave = vi.fn(async (bits: number) => blobs[bits])
				exportAudio = vi.fn(async () => new Blob(["encoded"], { type: "audio/webm" }))
				encode = encodeWave
			})()
		}
	}
})

const TAKE_RATE = 48000
/** One second whose first sample is 0.25, the take's peak; the rest sits at 0.1. */
function takeWave(bits: 16 | 32) {
	const left = new Float32Array(TAKE_RATE).fill(0.1)
	left[0] = 0.25
	return encodeWave([left, left.slice()], TAKE_RATE, bits)
}
const analysis = (overrides = {}) => ({
	duration: 1,
	bpm: 120,
	bpmConfidence: 2,
	beats: [],
	key: 9,
	keyName: "A",
	scale: "minor" as const,
	keyStrength: 0.72,
	loudness: -20,
	loudnessRange: 6.1,
	danceability: 1.42,
	...overrides
})

class FakeAudioBuffer {
	channels: Float32Array[]
	length: number
	sampleRate: number
	constructor({ numberOfChannels, length, sampleRate }: Record<string, number>) {
		this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length))
		this.length = length
		this.sampleRate = sampleRate
	}
	copyToChannel(data: Float32Array, channel: number) {
		this.channels[channel].set(data)
	}
}

beforeEach(() => {
	vi.stubGlobal("AudioBuffer", FakeAudioBuffer)
	analyseAudioBuffer.mockReset().mockResolvedValue(analysis())
	convertAudioMedia.mockReset().mockResolvedValue(undefined)
})
afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
	document.body.replaceChildren()
	delete (window as any).showSaveFilePicker
})

describe("summary formatting", () => {
	it("words the tempo confidence by Essentia's bands", () => {
		expect(
			[0.5, 1, 1.2, 1.5, 2, 3.5, 4].map((confidence) => bpmConfidenceLabel(confidence))
		).toEqual(["poor", "poor", "fair", "fair", "good", "good", "excellent"])
	})

	it("summarises tempo, key, loudness and danceability compactly", () => {
		expect(formatTakeAnalysis(analysis({ bpm: 127.46 }))).toEqual([
			{ label: "Tempo", value: "127.5 BPM (good confidence)" },
			{ label: "Key", value: "A minor (72% strength)" },
			{ label: "Loudness", value: "-20.0 LUFS · range 6.1 LU" },
			{ label: "Danceability", value: "1.42" }
		])
	})

	it("reports missing tempo and silence plainly", () => {
		const rows = formatTakeAnalysis(analysis({ bpm: 0, loudness: -70 }))
		expect(rows[0].value).toBe("Not detected")
		expect(rows[2].value).toBe("Silent")
	})
})

describe("normalisationGain", () => {
	it("raises a quiet take to the target", () => {
		const result = normalisationGain({ loudness: -20, peak: 0.1 }, -14)
		expect(result.gainDb).toBeCloseTo(6)
		expect(result.gain).toBeCloseTo(10 ** (6 / 20))
		expect(result.limitedByPeak).toBe(false)
	})

	it("lowers a loud take", () => {
		expect(normalisationGain({ loudness: -8, peak: 0.5 }, -14).gainDb).toBeCloseTo(-6)
	})

	it("caps the gain so the peak stays at or below -1 dBFS", () => {
		// Peak at -2 dBFS leaves only 1 dB of headroom for the 6 dB wanted.
		const peak = 10 ** (-2 / 20)
		const result = normalisationGain({ loudness: -20, peak }, -14)
		expect(result.limitedByPeak).toBe(true)
		expect(result.gainDb).toBeCloseTo(1)
		expect(20 * Math.log10(peak * result.gain)).toBeCloseTo(-1)
	})

	it("leaves silence alone", () => {
		expect(normalisationGain({ loudness: -70, peak: 0 }, -14)).toEqual({
			gainDb: 0,
			gain: 1,
			limitedByPeak: false
		})
	})
})

describe("analyseTake", () => {
	it("measures the peak over the whole take but analyses only the first seconds", async () => {
		const left = new Float32Array(TAKE_RATE).fill(0.1)
		left[40000] = -0.9
		const blob = encodeWave([left, left], TAKE_RATE, 32)
		const result = await analyseTake({ wave: async () => blob }, { maxSeconds: 0.5 })
		expect(result.peak).toBeCloseTo(0.9)
		expect(result.takeDuration).toBeCloseTo(1)
		expect(result.bpm).toBe(120)
		const buffer = analyseAudioBuffer.mock.calls[0][0] as FakeAudioBuffer
		expect(buffer.length).toBe(TAKE_RATE / 2)
		expect(buffer.sampleRate).toBe(TAKE_RATE)
		expect(buffer.channels[0][1]).toBeCloseTo(0.1)
		expect(analyseAudioBuffer.mock.calls[0][1]).toEqual({ maxSeconds: 0.5 })
	})

	it("caches the result per take and retries after a failure", async () => {
		const blob = takeWave(32)
		const recording = { wave: vi.fn(async () => blob) }
		const first = await analyseTake(recording)
		expect(await analyseTake(recording)).toBe(first)
		expect(analyseAudioBuffer).toHaveBeenCalledTimes(1)
		await analyseTake({ wave: async () => takeWave(32) })
		expect(analyseAudioBuffer).toHaveBeenCalledTimes(2)

		const other = takeWave(32)
		analyseAudioBuffer.mockRejectedValueOnce(new Error("WASM failed to load"))
		await expect(analyseTake({ wave: async () => other })).rejects.toThrow(
			"WASM failed to load"
		)
		await expect(analyseTake({ wave: async () => other })).resolves.toMatchObject({ bpm: 120 })
	})

	it("rejects audio that is not a retained take", async () => {
		await expect(
			analyseTake({ wave: async () => new Blob(["audio"], { type: "audio/wav" }) })
		).rejects.toThrow("expected audio format")
	})
})

describe("normaliseWave", () => {
	const samples = async (blob: Blob, bits: 16 | 32) => {
		const bytes = await blob.arrayBuffer()
		const view = new DataView(bytes)
		const offset = bits === 32 ? 92 : 80
		return {
			offset,
			size: bytes.byteLength,
			first:
				bits === 32 ? view.getFloat32(offset, true) : view.getInt16(offset, true) / 32767,
			second:
				bits === 32
					? view.getFloat32(offset + 8, true)
					: view.getInt16(offset + 4, true) / 32767
		}
	}

	it("scales a 32-bit take", async () => {
		const result = await samples(await normaliseWave(takeWave(32), 32, 2), 32)
		expect(result.first).toBeCloseTo(0.5)
		expect(result.second).toBeCloseTo(0.2)
		expect(result.size).toBe(92 + TAKE_RATE * 8)
	})

	it("scales into a 16-bit file with the matching header", async () => {
		const blob = await normaliseWave(takeWave(32), 16, 2)
		const result = await samples(blob, 16)
		expect(result.first).toBeCloseTo(0.5, 3)
		expect(result.second).toBeCloseTo(0.2, 3)
		expect(result.size).toBe(80 + TAKE_RATE * 4)
	})
})

describe("recording dialog analysis", () => {
	const button = (id: string) => document.querySelector<HTMLButtonElement>(`#${id}`)!
	const element = (id: string) => document.querySelector<HTMLElement>(`#${id}`)!
	const recordTake = async () => {
		const recording = createRecordingControls({} as AudioContext, {} as AudioNode)
		await recording.ready
		button("btn-record").click()
		button("btn-record").click()
		await vi.waitFor(() => expect(button("recording-save").disabled).toBe(false))
		return recording
	}
	const captureSave = () => {
		const chunks: Uint8Array[] = []
		;(window as any).showSaveFilePicker = vi.fn().mockResolvedValue({
			createWritable: async () => new WritableStream({ write: (chunk) => chunks.push(chunk) })
		})
		return async () => {
			await vi.waitFor(() =>
				expect(element("recording-status").textContent).toContain("saved")
			)
			const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
			let offset = 0
			for (const chunk of chunks) {
				bytes.set(chunk, offset)
				offset += chunk.length
			}
			return new DataView(bytes.buffer)
		}
	}
	beforeEach(() => {
		const markup = new DOMParser().parseFromString(
			readFileSync(resolve("index.html"), "utf8"),
			"text/html"
		)
		document.body.replaceChildren(
			markup.querySelector("#midi-transport-control")!.cloneNode(true),
			markup.querySelector("#recording-dialog")!.cloneNode(true)
		)
		vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:take")
		vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
		vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {})
		vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {})
	})

	it("analyses a new take and caches it for the Analyse button", async () => {
		await recordTake()
		await vi.waitFor(() => expect(element("recording-analysis-summary").hidden).toBe(false))
		const text = element("recording-analysis-summary").textContent
		expect(text).toContain("120.0 BPM (good confidence)")
		expect(text).toContain("A minor")
		expect(text).toContain("-20.0 LUFS · range 6.1 LU")
		expect(text).toContain("Suggested gain+6.0 dB to reach -14 LUFS")
		expect(element("recording-analysis-status").textContent).toBe("Analysis complete.")
		button("recording-analyse").click()
		await vi.waitFor(() => expect(button("recording-analyse").disabled).toBe(false))
		expect(analyseAudioBuffer).toHaveBeenCalledTimes(1)
	})

	it("keeps recording and saving working when analysis fails", async () => {
		analyseAudioBuffer.mockRejectedValue(new Error("Essentia WASM failed to load"))
		const recording = await recordTake()
		await vi.waitFor(() =>
			expect(element("recording-analysis-status").textContent).toContain(
				"Analysis unavailable"
			)
		)
		expect(element("recording-analysis-status").textContent).toContain("WASM failed")
		expect(element("recording-analysis-summary").hidden).toBe(true)
		expect(button("recording-analyse").disabled).toBe(false)
		expect(recording.hasTake).toBe(true)
		const saved = captureSave()
		button("recording-save").click()
		await saved()
		expect(element("recording-status").textContent).toContain("Recording saved")
		button("recording-close").click()
		button("btn-record").click()
		await vi.waitFor(() => expect(recording.state).toBe("recording"))
	})

	it("saves a normalised copy, capping the gain at -1 dBFS", async () => {
		const recording = await recordTake()
		await vi.waitFor(() => expect(element("recording-analysis-summary").hidden).toBe(false))
		const saved = captureSave()
		document.querySelector<HTMLInputElement>("#recording-normalise")!.checked = true
		document.querySelector<HTMLSelectElement>("#recording-format")!.value = "32"
		button("recording-save").click()
		const view = await saved()
		// -20 LUFS to -14 LUFS is +6 dB; the 0.25 peak (-12 dBFS) leaves 11 dB of headroom.
		expect(view.getFloat32(92, true)).toBeCloseTo(0.25 * 10 ** (6 / 20), 4)
		expect(element("recording-status").textContent).toContain("Normalised: +6.0 dB")

		// A hotter target would need +16 dB, so the peak ceiling limits it to +11.04 dB.
		const target = document.querySelector<HTMLInputElement>("#recording-normalise-target")!
		target.value = "-4"
		button("recording-save").click()
		await vi.waitFor(() => expect(element("recording-status").textContent).toContain("limited"))
		expect(recording.wave).toHaveBeenCalledWith(32)
	})

	it("normalises compressed exports from the scaled take", async () => {
		const recording = await recordTake()
		await vi.waitFor(() => expect(element("recording-analysis-summary").hidden).toBe(false))
		;(window as any).showSaveFilePicker = vi
			.fn()
			.mockResolvedValue({ createWritable: async () => new WritableStream() })
		document.querySelector<HTMLInputElement>("#recording-normalise")!.checked = true
		document.querySelector<HTMLSelectElement>("#recording-format")!.value = "webm"
		button("recording-save").click()
		await vi.waitFor(() => expect(convertAudioMedia).toHaveBeenCalled())
		const [blob, format] = convertAudioMedia.mock.calls[0]
		expect(format).toBe("webm")
		expect(blob.size).toBe(92 + TAKE_RATE * 8)
		expect(recording.exportAudio).not.toHaveBeenCalled()
	})

	it("saves unchanged and says so when loudness cannot be measured for normalising", async () => {
		const recording = await recordTake()
		await vi.waitFor(() => expect(element("recording-analysis-summary").hidden).toBe(false))
		// A different blob forces a fresh measurement, which fails.
		;(recording as any).wave = vi.fn(async () => new Blob(["broken"], { type: "audio/wav" }))
		const saved = captureSave()
		document.querySelector<HTMLInputElement>("#recording-normalise")!.checked = true
		document.querySelector<HTMLSelectElement>("#recording-format")!.value = "16"
		button("recording-save").click()
		await saved()
		expect(element("recording-status").textContent).toContain("Recording saved")
		expect(element("recording-status").textContent).toContain("Not normalised")
		expect(recording.hasTake).toBe(true)
	})
})