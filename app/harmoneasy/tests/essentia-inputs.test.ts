// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import InputMicrophoneMelody from "../../../packages/audiobus/io/inputs/input-microphone-melody"
import InputMicrophoneChords from "../../../packages/audiobus/io/inputs/input-microphone-chords"
import InputMicrophoneTimbre from "../../../packages/audiobus/io/inputs/input-microphone-timbre"
import {
	INPUT_EVENT,
	EVENT_ERROR,
	EVENT_HARMONY_CHANGED
} from "../../../packages/audiobus/events/event-constants"
import {
	NOTE_ON,
	NOTE_OFF,
	PITCH_BEND,
	CONTROL_CHANGE
} from "../../../packages/audiobus/commands/commands"
import type { FrameFeatures } from "../../../packages/audiobus/analysis/essentia-features"
import type { IAudioCommand } from "../../../packages/audiobus/commands/audio-command-interface"
import { INPUT_DEFINITIONS } from "../../../packages/audiobus/io/input-definitions"
import { INPUT_FACTORIES } from "../../../packages/audiobus/io/input-factory"
import { interpretSetupDescription } from "../source/services/setup-interpreter"
import { WIZARD_INPUTS } from "../source/services/setup-designer"
import { elementIcon } from "../source/components/graph/element-icons"
import { INPUT_GUIDANCE } from "../source/components/graph/device-card"

const capture = vi.hoisted(() => ({ load: vi.fn(), create: vi.fn() }))
vi.mock("../../../packages/audiobus/io/inputs/load-capture-worklet", () => ({
	loadCaptureWorklet: capture.load
}))
vi.mock("../../../packages/audiobus/analysis/essentia-client", () => ({
	createAnalysisStream: capture.create
}))

afterEach(() => {
	vi.unstubAllGlobals()
	vi.clearAllMocks()
})

function commands(
	input: InputMicrophoneMelody | InputMicrophoneChords | InputMicrophoneTimbre
): IAudioCommand[] {
	const result: IAudioCommand[] = []
	input.addEventListener(INPUT_EVENT, (event) =>
		result.push((event as CustomEvent<IAudioCommand>).detail)
	)
	return result
}

const pitch = (midi: number, rms = 0.1, confidence = 0.95): FrameFeatures => ({
	time: 0,
	rms,
	pitch: { frequency: 440 * 2 ** ((midi - 69) / 12), confidence }
})
const chroma = (time: number, notes: number[], rms = 0.1): FrameFeatures => ({
	time,
	rms,
	chroma: Array.from({ length: 12 }, (_, pc) => (notes.includes(pc) ? 1 : 0))
})
const spectral = (centroid: number, rms = 0.1, flux = 0.5, loudness = 0.3): FrameFeatures => ({
	time: 0,
	rms,
	spectral: { centroid, flux, loudness, mfcc: [] }
})

describe("Essentia microphone melody", () => {
	it("requires stable confident frames, bends one held note, and releases after quiet frames", () => {
		const input = new InputMicrophoneMelody()
		const sent = commands(input)
		input.processFrames([pitch(69), pitch(70), pitch(69), pitch(69, 0.001)])
		expect(sent).toHaveLength(0)
		input.processFrames([pitch(69), pitch(69.1)])
		expect(sent.filter((c) => c.type === NOTE_ON).map((c) => c.number)).toEqual([69])
		input.processFrames([pitch(69.25)])
		expect(sent.at(-1)).toMatchObject({ type: PITCH_BEND, number: 69, value: 9216 })
		input.processFrames([pitch(71)])
		expect(sent.filter((c) => c.type === NOTE_OFF)).toHaveLength(0)
		input.processFrames([pitch(71)])
		expect(sent.filter((c) => c.type === NOTE_OFF).map((c) => c.number)).toEqual([69])
		expect(sent.filter((c) => c.type === NOTE_ON).map((c) => c.number)).toEqual([69, 71])
		input.processFrames(Array.from({ length: 3 }, () => pitch(71, 0.1, 0.1)))
		expect(sent.filter((c) => c.type === NOTE_OFF)).toHaveLength(1)
		input.processFrames([pitch(71, 0)])
		expect(sent.at(-1)).toMatchObject({ type: NOTE_OFF, number: 71 })
	})
	it("treats unusable pitches as bad frames so a held note still releases", () => {
		const input = new InputMicrophoneMelody({ stableFrames: 1, releaseFrames: 2 })
		const sent = commands(input)
		input.processFrames([pitch(60)])
		const bad = (frequency: number): FrameFeatures => ({
			time: 0,
			rms: 0.1,
			pitch: { frequency, confidence: 0.95 }
		})
		input.processFrames([bad(0), bad(NaN)])
		expect(sent.at(-1)).toMatchObject({ type: NOTE_OFF, number: 60 })
		input.processFrames([pitch(60), bad(1e9), bad(-50)])
		expect(sent.filter((c) => c.type === NOTE_OFF)).toHaveLength(2)
	})
	it("ignores frames without pitch features", () => {
		const input = new InputMicrophoneMelody({ stableFrames: 1 })
		const sent = commands(input)
		input.processFrames([{ time: 0, rms: 0.5 }])
		expect(sent).toHaveLength(0)
	})
	it("cancels a pending note change and resets bend on stop", () => {
		const input = new InputMicrophoneMelody({ stableFrames: 1 })
		const sent = commands(input)
		input.processFrames([pitch(60), pitch(60.3)])
		input.stop()
		expect(sent.slice(-2)).toMatchObject([
			{ type: NOTE_OFF, number: 60 },
			{ type: PITCH_BEND, value: 8192 }
		])
		const count = sent.length
		input.stop()
		expect(sent).toHaveLength(count)
		input.processFrames([pitch(62)])
		expect(sent.at(-1)).toMatchObject({ type: NOTE_ON, number: 62 })
	})
})

describe("Essentia microphone chords", () => {
	it("requires a sustained chord candidate, voices triads upwards, and releases on silence and stop", () => {
		const input = new InputMicrophoneChords({ smoothingFrames: 1, minHoldSeconds: 0.1 })
		const sent = commands(input)
		input.processFrames([chroma(0, [0, 4, 7]), chroma(0.05, [0, 4, 7])])
		expect(sent).toHaveLength(0)
		input.processFrames([chroma(0.11, [0, 4, 7])])
		expect(sent.map((c) => c.number)).toEqual([60, 64, 67])
		input.processFrames([
			chroma(0.2, [7, 11, 2]),
			chroma(0.25, [0, 4, 7]),
			chroma(0.3, [7, 11, 2])
		])
		expect(sent).toHaveLength(3)
		input.processFrames([chroma(0.41, [7, 11, 2])])
		expect(sent.slice(3).map((c) => [c.type, c.number])).toEqual([
			[NOTE_OFF, 60],
			[NOTE_OFF, 64],
			[NOTE_OFF, 67],
			[NOTE_ON, 67],
			[NOTE_ON, 71],
			[NOTE_ON, 74]
		])
		input.processFrames([chroma(0.5, [], 0), chroma(0.71, [], 0)])
		expect(sent.filter((c) => c.type === NOTE_OFF)).toHaveLength(6)
		input.processFrames([chroma(1, [0, 3, 7]), chroma(1.11, [0, 3, 7])])
		input.stop()
		expect(sent.slice(-3).map((c) => [c.type, c.number])).toEqual([
			[NOTE_OFF, 60],
			[NOTE_OFF, 63],
			[NOTE_OFF, 67]
		])
	})
	it("smooths chroma, rejects low scores, and notifies key changes", () => {
		const input = new InputMicrophoneChords({
			smoothingFrames: 2,
			minHoldSeconds: 0,
			scoreThreshold: 0.95
		})
		const sent = commands(input)
		const changed = vi.fn()
		input.addEventListener(EVENT_HARMONY_CHANGED, changed)
		input.processFrames([
			chroma(
				0,
				Array.from({ length: 12 }, (_, i) => i)
			)
		])
		expect(sent).toHaveLength(0)
		input.processFrames([chroma(0.1, [0, 4, 7])])
		expect(sent).toHaveLength(0)
		input.processFrames([chroma(0.2, [0, 4, 7])])
		expect(sent).toHaveLength(3)
		expect(input.currentKey).toMatchObject({ root: 0, scale: "major" })
		expect(changed).toHaveBeenCalled()
		input.stop()
		expect(input.currentKey).toBeUndefined()
	})
})

describe("Essentia microphone key following", () => {
	const keyFrame = (time: number, root: number): FrameFeatures => {
		const weights: Record<number, number> = {
			0: 1,
			4: 0.7,
			7: 0.8,
			2: 0.4,
			5: 0.4,
			9: 0.4,
			11: 0.4
		}
		const chroma = new Array<number>(12).fill(0)
		for (const [interval, weight] of Object.entries(weights)) {
			chroma[(root + Number(interval)) % 12] = weight
		}
		return { time, rms: 0.1, chroma }
	}
	it("lets the key follow a modulation once old evidence decays", () => {
		const input = new InputMicrophoneChords({ keyDecay: 0.8 })
		const frames = (from: number, count: number, root: number) =>
			Array.from({ length: count }, (_, i) => keyFrame(from + i * 0.01, root))
		input.processFrames(frames(0, 40, 0))
		expect(input.currentKey).toMatchObject({ root: 0, scale: "major" })
		input.processFrames(frames(1, 80, 7))
		expect(input.currentKey).toMatchObject({ root: 7, scale: "major" })
	})
	it("keeps the whole history when decay is disabled", () => {
		const input = new InputMicrophoneChords({ keyDecay: 1 })
		input.processFrames(Array.from({ length: 200 }, (_, i) => keyFrame(i * 0.01, 0)))
		input.processFrames(Array.from({ length: 100 }, (_, i) => keyFrame(2 + i * 0.01, 7)))
		expect(input.currentKey).toMatchObject({ root: 0, scale: "major" })
	})
})

describe("Essentia microphone timbre", () => {
	it("holds brightness and flux below the rms gate while expression keeps following", () => {
		const input = new InputMicrophoneTimbre({
			rmsGate: 0.05,
			brightness: { smoothing: 0 },
			expression: { smoothing: 0 },
			flux: { smoothing: 0 }
		})
		const sent = commands(input)
		input.processFrames([spectral(0.25, 0.1, 0.5)])
		expect(sent.map((c) => [c.number, c.value])).toEqual([
			[74, 64],
			[11, 64],
			[1, 64]
		])
		input.processFrames([spectral(0.5, 0.02, 1)])
		expect(sent.slice(3).map((c) => [c.number, c.value])).toEqual([[11, 13]])
	})
	it("scales loudness expression by default and ignores non-numeric CC targets", () => {
		const input = new InputMicrophoneTimbre({
			expressionSource: "loudness",
			expression: { smoothing: 0 },
			flux: { cc: Number.NaN }
		})
		const sent = commands(input)
		input.processFrames([spectral(0, 0.1, 0.5, 6)])
		expect(sent.find((c) => c.number === 11)?.value).toBe(64)
		expect(sent.map((c) => c.number)).not.toContain(Number.NaN)
		expect(sent.filter((c) => c.number !== 74 && c.number !== 11)).toHaveLength(0)
	})
	it("maps ranges, clamps, smooths and deduplicates integer CC values", () => {
		const input = new InputMicrophoneTimbre({
			brightness: {
				cc: 71,
				inputMin: 0.2,
				inputMax: 0.8,
				outputMin: 20,
				outputMax: 100,
				smoothing: 0.5
			},
			expression: { smoothing: 0 },
			flux: { smoothing: 0 }
		})
		const sent = commands(input)
		input.processFrames([spectral(0.2)])
		expect(sent.map((c) => [c.type, c.number, c.value])).toEqual([
			[CONTROL_CHANGE, 71, 20],
			[CONTROL_CHANGE, 11, 64],
			[CONTROL_CHANGE, 1, 64]
		])
		input.processFrames([spectral(0.2)])
		expect(sent).toHaveLength(3)
		input.processFrames([spectral(1)])
		expect(sent.at(-1)).toMatchObject({ number: 71, value: 60 })
		input.processFrames([spectral(1, 1, -1)])
		expect(sent.slice(-3).map((c) => [c.number, c.value])).toEqual([
			[71, 80],
			[11, 127],
			[1, 0]
		])
		input.stop()
		input.processFrames([spectral(0.2)])
		expect(sent.slice(-3).map((c) => c.value)).toEqual([20, 64, 64])
	})
	it("can use spectral loudness for expression", () => {
		const input = new InputMicrophoneTimbre({
			expressionSource: "loudness",
			expression: { inputMax: 1, smoothing: 0 }
		})
		const sent = commands(input)
		input.processFrames([spectral(0, 0, 0, 0.5)])
		expect(sent.find((c) => c.number === 11)?.value).toBe(64)
	})
})

describe("Essentia input capture lifecycle and registration", () => {
	it.each(["melody", "chords", "timbre"])(
		"registers microphone-%s with attribution and requirements",
		async (kind) => {
			const id = `microphone-${kind}`
			expect(INPUT_DEFINITIONS[id]).toMatchObject({
				attribution: { license: "AGPL-3.0" },
				type: "audio"
			})
			const factory = INPUT_FACTORIES.find((f) => f.id === id)!
			expect(factory.requires).toEqual(
				expect.arrayContaining(["mediaDevices", "audioWorklet", "workers", "webAssembly"])
			)
			const input = await factory.create()
			expect(input.name).toBe(id)
			input.destroy()
		}
	)

	it("reports missing microphone errors", async () => {
		vi.stubGlobal("navigator", {})
		const input = new InputMicrophoneMelody({ audioContext: {} })
		const failed = vi.fn()
		input.addEventListener(EVENT_ERROR, failed)
		await expect(input.connect()).rejects.toThrow("Microphone unavailable")
		expect(input.error?.message).toBe("Microphone unavailable")
		expect(input.isConnected).toBe(false)
		expect(failed).toHaveBeenCalledOnce()
	})

	it("captures samples, stops analysis, releases tracks and nodes, and preserves the shared context", async () => {
		const stop = vi.fn()
		const stream = { push: vi.fn(), stop: vi.fn() }
		capture.create.mockReturnValue(stream)
		const source = { connect: vi.fn(), disconnect: vi.fn() }
		const node = {
			connect: vi.fn(),
			disconnect: vi.fn(),
			port: { onmessage: null as any, close: vi.fn() }
		}
		vi.stubGlobal(
			"AudioWorkletNode",
			// A function expression, since the input constructs it with new
			// oxlint-disable-next-line prefer-arrow-callback
			vi.fn(function () {
				return node
			})
		)
		vi.stubGlobal("navigator", {
			mediaDevices: {
				getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] })
			}
		})
		const context = {
			sampleRate: 48000,
			createMediaStreamSource: vi.fn(() => source),
			destination: {},
			close: vi.fn()
		}
		const input = new InputMicrophoneMelody({ audioContext: context })
		await input.connect()
		expect(capture.create.mock.calls[0][0]).toMatchObject({
			sampleRate: 48000,
			frameSize: 2048,
			hopSize: 512,
			features: ["pitch"]
		})
		const samples = new Float32Array(512)
		node.port.onmessage({ data: samples })
		expect(stream.push).toHaveBeenCalledWith(samples)
		input.stop()
		expect(stream.stop).toHaveBeenCalledOnce()
		expect(source.disconnect).toHaveBeenCalledOnce()
		expect(node.disconnect).toHaveBeenCalledOnce()
		expect(node.port.close).toHaveBeenCalledOnce()
		expect(stop).toHaveBeenCalledOnce()
		expect(context.close).not.toHaveBeenCalled()
	})

	const wire = () => {
		const stop = vi.fn()
		const stream = { push: vi.fn(), stop: vi.fn() }
		capture.create.mockReturnValue(stream)
		const source = { connect: vi.fn(), disconnect: vi.fn() }
		const node = {
			connect: vi.fn(),
			disconnect: vi.fn(),
			port: { onmessage: null as any, close: vi.fn() }
		}
		vi.stubGlobal(
			"AudioWorkletNode",
			// A function expression, since the input constructs it with new
			// oxlint-disable-next-line prefer-arrow-callback
			vi.fn(function () {
				return node
			})
		)
		const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] })
		vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } })
		const context = {
			sampleRate: 44100,
			state: "running",
			resume: vi.fn().mockResolvedValue(undefined),
			createMediaStreamSource: vi.fn(() => source),
			destination: {}
		}
		return { stop, stream, source, node, getUserMedia, context }
	}

	it("resumes a suspended context and shares one pending connection", async () => {
		const { context, getUserMedia } = wire()
		context.state = "suspended"
		const input = new InputMicrophoneMelody({ audioContext: context })
		const first = input.connect()
		expect(input.connect()).toBe(first)
		await first
		expect(context.resume).toHaveBeenCalledOnce()
		expect(getUserMedia).toHaveBeenCalledOnce()
		expect(input.isConnected).toBe(true)
		expect(await input.connect()).toBeTypeOf("function")
		expect(getUserMedia).toHaveBeenCalledOnce()
		input.destroy()
	})

	it("reports a denied microphone and stays disconnected", async () => {
		const { context, getUserMedia } = wire()
		getUserMedia.mockRejectedValue(new Error("Permission denied"))
		const input = new InputMicrophoneChords({ audioContext: context })
		const failed = vi.fn()
		input.addEventListener(EVENT_ERROR, failed)
		await expect(input.connect()).rejects.toThrow("Permission denied")
		expect(input.error?.message).toBe("Permission denied")
		expect(input.isConnected).toBe(false)
		expect(failed).toHaveBeenCalledOnce()
		expect(capture.create).not.toHaveBeenCalled()
	})

	it("does not report a permission error that arrives after stop", async () => {
		const { context, getUserMedia } = wire()
		let deny!: (error: Error) => void
		getUserMedia.mockReturnValue(
			new Promise((_, reject) => {
				deny = reject
			})
		)
		const input = new InputMicrophoneTimbre({ audioContext: context })
		const failed = vi.fn()
		input.addEventListener(EVENT_ERROR, failed)
		const pending = input.connect()
		await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce())
		input.stop()
		deny(new Error("Permission denied"))
		await expect(pending).resolves.toBeTypeOf("function")
		expect(failed).not.toHaveBeenCalled()
		expect(input.error).toBeUndefined()
	})

	it("can be restarted after stop and releases the first capture only once", async () => {
		const { context, stop, getUserMedia } = wire()
		const input = new InputMicrophoneMelody({ audioContext: context })
		await input.connect()
		input.stop()
		await input.connect()
		expect(getUserMedia).toHaveBeenCalledTimes(2)
		expect(stop).toHaveBeenCalledTimes(1)
		input.stop()
		expect(stop).toHaveBeenCalledTimes(2)
	})

	it("releases the microphone and held notes when the analysis stream fails to start or errors", async () => {
		const { context, stop } = wire()
		capture.create.mockImplementationOnce(() => {
			throw new Error("worker unavailable")
		})
		const input = new InputMicrophoneMelody({ audioContext: context, stableFrames: 1 })
		const sent = commands(input)
		await expect(input.connect()).rejects.toThrow("worker unavailable")
		expect(stop).toHaveBeenCalledOnce()
		expect(input.isConnected).toBe(false)

		let fail!: (error: Error) => void
		capture.create.mockImplementationOnce((_options, _frames, onError) => {
			fail = onError
			return { push: vi.fn(), stop: vi.fn() }
		})
		await input.connect()
		input.processFrames([pitch(64)])
		expect(sent.at(-1)).toMatchObject({ type: NOTE_ON, number: 64 })
		fail(new Error("analysis crashed"))
		expect(sent.at(-1)).toMatchObject({ type: NOTE_OFF, number: 64 })
		expect(input.isConnected).toBe(false)
		expect(input.error?.message).toBe("analysis crashed")
		expect(stop).toHaveBeenCalledTimes(2)
	})

	it("only analyses frames while listening", async () => {
		const { context } = wire()
		let deliver!: (frames: FrameFeatures[]) => void
		capture.create.mockImplementationOnce((_options, onFrames) => {
			deliver = onFrames
			return { push: vi.fn(), stop: vi.fn() }
		})
		const input = new InputMicrophoneMelody({ audioContext: context, stableFrames: 1 })
		const sent = commands(input)
		await input.connect()
		deliver([pitch(60)])
		expect(sent.at(-1)).toMatchObject({ type: NOTE_ON, number: 60 })
		input.stop()
		const count = sent.length
		deliver([pitch(62)])
		expect(sent).toHaveLength(count)
	})

	it("releases a microphone granted after stop without connecting it", async () => {
		const stop = vi.fn()
		let grant!: (media: unknown) => void
		const getUserMedia = vi.fn(
			() =>
				new Promise((resolve) => {
					grant = resolve
				})
		)
		vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } })
		const input = new InputMicrophoneMelody({ audioContext: {} })
		const pending = input.connect()
		await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce())
		input.stop()
		grant({ getTracks: () => [{ stop }] })
		await pending
		expect(stop).toHaveBeenCalledOnce()
		expect(input.isConnected).toBe(false)
	})
})

describe("Essentia microphone input setup registration", () => {
	it.each([
		["hum to play a melody", "microphone-melody"],
		["I want the microphone melody", "microphone-melody"],
		["follow the chords I play", "microphone-chords"],
		["voice to cc", "microphone-timbre"]
	])("reads %j as %s only", (text, id) => {
		expect(interpretSetupDescription(text).answers.inputs).toEqual([id])
	})
	it.each(["microphone-melody", "microphone-chords", "microphone-timbre"])(
		"offers %s in the wizard, guidance and icons",
		(id) => {
			expect(WIZARD_INPUTS.map((item) => item.id)).toContain(id)
			expect(INPUT_GUIDANCE[id as keyof typeof INPUT_GUIDANCE]).toBeDefined()
			expect(elementIcon("input", id)).toBe(elementIcon("input", "microphone-pitch"))
		}
	)
})