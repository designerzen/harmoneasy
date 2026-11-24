// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { alignLoopToBeats } from "../../../packages/audiobus/io/outputs/loop-alignment"
import { loopSourceBpm } from "../../../packages/audiobus/io/outputs/loop-player-settings"
import OutputLoopPlayer from "../../../packages/audiobus/io/outputs/output-loop-player"
import { defineDevice, deviceDefinition } from "../../../packages/audiobus/io/device-definition"
import { LOOP_PLAYER } from "../../../packages/audiobus/io/outputs/output-types"
import {
	applyKeyToTransformers,
	countKeyTransformers
} from "../../../packages/audiobus/io/transformers/apply-key"
import { TransformerChordifier } from "../../../packages/audiobus/io/transformers/transformer-chordifier"
import { TransformerHarmoniser } from "../../../packages/audiobus/io/transformers/transformer-harmoniser"
import { TransformerKeyTraveller } from "../../../packages/audiobus/io/transformers/transformer-key-traveller"
import { TransformerScaleExplorer } from "../../../packages/audiobus/io/transformers/transformer-scale-explorer"
import { AEOLIAN_INTERVALS, IONIAN_INTERVALS } from "../../../packages/audiobus/tuning/intervals"
import type { TrackAnalysis } from "../../../packages/audiobus/analysis/essentia-features"
import {
	analyseImportedLoop,
	askAnalysisChoices,
	harmonyForKey,
	describeAnalysis,
	planAnalysis,
	type TempoControl
} from "../source/services/audio-analysis-apply"
import { createMediaImporter } from "../source/services/media-import"

const mocks = vi.hoisted(() => ({
	analyse: vi.fn(),
	input: vi.fn(),
	output: vi.fn()
}))
vi.mock("../../../packages/audiobus/analysis/essentia-client", () => ({
	analyseAudioBuffer: mocks.analyse
}))
vi.mock("../../../packages/audiobus/io/input-factory", () => ({ createInputById: mocks.input }))
vi.mock("../../../packages/audiobus/io/output-factory", () => ({
	createOutputById: mocks.output
}))

const analysis = (overrides: Partial<TrackAnalysis> = {}): TrackAnalysis => ({
	duration: 10,
	bpm: 98.04,
	bpmConfidence: 2,
	beats: [0.2, 0.81],
	key: 2,
	keyName: "D",
	scale: "minor",
	keyStrength: 0.72,
	loudness: -14,
	loudnessRange: 5,
	danceability: 1.2,
	...overrides
})
const tempoControl = (
	bpm = 120,
	canSet = true
): TempoControl & { set: ReturnType<typeof vi.fn> } => ({
	get: () => bpm,
	canSet: () => canSet,
	set: vi.fn()
})
/** A transformer-shaped object: type, options and a setConfig that records what it was given. */
const fake = (type: string, options: Record<string, unknown>) => {
	const transformer = {
		type,
		options,
		setConfig: vi.fn((key: string, value: unknown) => {
			options[key] = value
		})
	}
	return transformer
}

afterEach(() => {
	document.body.replaceChildren()
	vi.restoreAllMocks()
})

describe("loop alignment", () => {
	const sourceBpm = (region: NonNullable<ReturnType<typeof alignLoopToBeats>>) =>
		loopSourceBpm({ ...region, mode: "slice" })

	it("starts on the first beat and picks whole bars that match the detected tempo", () => {
		const region = alignLoopToBeats({ bpm: 120, beats: [0.04, 0.54, 1.04] }, 8.04)!
		expect(region).toMatchObject({ start: 0.04, loopBeats: 16 })
		expect(region.end).toBeCloseTo(8.04)
		expect(sourceBpm(region)).toBeCloseTo(120)

		const slower = alignLoopToBeats({ bpm: 98, beats: [0.2] }, 10)!
		expect(slower.loopBeats).toBe(16)
		expect(slower.end).toBeCloseTo(0.2 + (16 * 60) / 98)
		expect(sourceBpm(slower)).toBeCloseTo(98)
	})
	it("uses the largest of 4, 8, 16 or 32 beats that the audio holds, and caps at 32", () => {
		expect(alignLoopToBeats({ bpm: 120 }, 9.9)!.loopBeats).toBe(16)
		expect(alignLoopToBeats({ bpm: 120 }, 60)!.loopBeats).toBe(32)
		expect(alignLoopToBeats({ bpm: 120 }, 4.1)!.loopBeats).toBe(8)
		expect(alignLoopToBeats({ bpm: 120 }, 2.1)!.loopBeats).toBe(4)
	})
	it("keeps whole beats for audio shorter than a bar", () => {
		const region = alignLoopToBeats({ bpm: 120 }, 1.5)!
		expect(region).toEqual({ start: 0, end: 1.5, loopBeats: 3 })
		expect(sourceBpm(region)).toBeCloseTo(120)
	})
	it("never ends past the audio, so a hair-short file is a hair off the tempo", () => {
		const region = alignLoopToBeats({ bpm: 120, beats: [0.04] }, 8)!
		expect(region.loopBeats).toBe(16)
		expect(region.end).toBe(8)
		expect(sourceBpm(region)).toBeCloseTo(120.6, 1)
	})
	it("ignores unusable beats and refuses audio without a beat", () => {
		expect(alignLoopToBeats({ bpm: 120, beats: [NaN, -1, 99, 0.3] }, 8)!.start).toBe(0.3)
		expect(alignLoopToBeats({ bpm: 120, beats: [99] }, 8)!.start).toBe(0)
		expect(alignLoopToBeats({ bpm: 120 }, 0.3)).toBeUndefined()
		expect(alignLoopToBeats({ bpm: 0 }, 8)).toBeUndefined()
		expect(alignLoopToBeats({ bpm: NaN }, 8)).toBeUndefined()
		expect(alignLoopToBeats({ bpm: 120 }, 0)).toBeUndefined()
	})
})

describe("Loop Player analysis", () => {
	const audioContext = (duration: number) => {
		const param = () => ({
			value: 0,
			setValueAtTime: vi.fn(),
			linearRampToValueAtTime: vi.fn(),
			cancelScheduledValues: vi.fn()
		})
		return {
			currentTime: 0,
			state: "running",
			destination: {},
			createGain: vi.fn(() => ({ gain: param(), connect: vi.fn(), disconnect: vi.fn() })),
			resume: vi.fn(async () => {}),
			decodeAudioData: vi.fn(async () => ({
				duration,
				length: duration * 8000,
				sampleRate: 8000,
				numberOfChannels: 1,
				getChannelData: () => new Float32Array(1)
			}))
		}
	}
	const outputs: OutputLoopPlayer[] = []
	const player = async (duration = 10, options: Record<string, unknown> = {}) => {
		const context = audioContext(duration)
		const output = new OutputLoopPlayer({
			audioContext: context,
			mixer: {},
			mode: "slice",
			...options
		})
		outputs.push(output)
		await output.loadSample(new Uint8Array([1, 2, 3]).buffer, "break.wav")
		return { context, output }
	}
	afterEach(() => outputs.splice(0).forEach((output) => output.destroy()))

	it("aligns the loop to the detected beats and saves the result without the beat list", async () => {
		const { context, output } = await player()
		const source = analysis({ bpm: 120, beats: [0.5, 1, 1.5] })
		expect(output.applyAnalysis(source)).toBe(true)
		expect(output.options).toMatchObject({ start: 0.5, loopBeats: 16 })
		expect(output.options.end).toBeCloseTo(8.5)
		expect(output.sourceBpm).toBeCloseTo(120)

		defineDevice(output, { factory: "output", type: LOOP_PLAYER })
		const saved = JSON.parse(JSON.stringify(deviceDefinition(output)))
		expect(saved.options.analysis).toEqual({
			bpm: 120,
			bpmConfidence: 2,
			key: 2,
			keyName: "D",
			scale: "minor",
			keyStrength: 0.72
		})
		const restored = new OutputLoopPlayer({
			...saved.options,
			audioContext: context,
			mixer: {}
		})
		outputs.push(restored)
		await vi.waitFor(() => expect(restored.sourceBpm).toBeCloseTo(120))
		expect(restored.detected).toMatchObject({ bpm: 120, key: 2, scale: "minor" })
	})
	it("shows the detected tempo and key in the panel", async () => {
		const { output } = await player()
		const panel = await output.createGui()
		output.applyAnalysis(analysis({ bpm: 98 }), { align: false })
		expect(panel.textContent).toContain("Detected 98 BPM, D minor")
	})
	it("can record the analysis without moving the loop", async () => {
		const { output } = await player()
		expect(output.applyAnalysis(analysis(), { align: false })).toBe(false)
		expect(output.options).toMatchObject({ start: 0, end: 10, loopBeats: 4 })
		expect(output.detected?.bpm).toBe(98.04)
	})
	it("forgets the analysis when other audio is loaded, and ignores bad saved data", async () => {
		const { output } = await player()
		output.applyAnalysis(analysis())
		await output.loadSample(new Uint8Array([4]).buffer, "other.wav")
		expect(output.detected).toBeUndefined()
		expect(output.applyAnalysis({ bpm: NaN } as any)).toBe(false)
		const { output: junk } = await player(10, { analysis: { bpm: "fast", key: 40 } })
		expect(junk.detected).toBeUndefined()
	})
})

describe("key mapping", () => {
	const dMinor = { key: 2, scale: "minor" } as const
	const cMajor = { key: 0, scale: "major" } as const

	it("sets root and scale intervals on a Harmoniser", () => {
		const harmoniser = new TransformerHarmoniser({ root: 7, mode: [...AEOLIAN_INTERVALS] })
		expect(applyKeyToTransformers([harmoniser], dMinor)).toEqual([harmoniser.type])
		expect(harmoniser.options).toMatchObject({ root: 2, mode: AEOLIAN_INTERVALS })
		applyKeyToTransformers([harmoniser], { key: 10, scale: "major" })
		expect(harmoniser.options).toMatchObject({ root: 10, mode: IONIAN_INTERVALS })
		expect(harmoniser.notesInScale.has(10 + 12)).toBe(true)
		expect(harmoniser.notesInScale.has(11 + 12)).toBe(false)
	})
	it("counts the Chordifier from A", () => {
		const chordifier = new TransformerChordifier()
		applyKeyToTransformers([chordifier], dMinor)
		// D is five semitones above A
		expect(chordifier.options).toMatchObject({ root: 5, mode: "aeolian" })
		applyKeyToTransformers([chordifier], cMajor)
		expect(chordifier.options).toMatchObject({ root: 3, mode: "ionian" })
	})
	it("sets key and mode on the tonal progression family, unless they follow the shared key", () => {
		const local = new TransformerKeyTraveller({ key: 5, mode: "major" })
		const shared = new TransformerKeyTraveller({ source: "shared", key: 5, mode: "major" })
		expect(applyKeyToTransformers([local, shared], dMinor)).toHaveLength(1)
		expect(local.options).toMatchObject({ key: 2, mode: "minor" })
		expect(shared.options).toMatchObject({ key: 5, mode: "major" })
	})
	it("sets root and scale name on a Magenta-shaped transformer, keeping a chromatic scale", () => {
		const melody = fake("Magenta-Melody", { root: 0, scale: "dorian" })
		const free = fake("Magenta-Melody", { root: 0, scale: "chromatic" })
		applyKeyToTransformers([melody, free], dMinor)
		expect(melody.options).toEqual({ root: 2, scale: "minor" })
		expect(free.options).toEqual({ root: 2, scale: "chromatic" })
	})
	it("leaves alone transformers it cannot map safely", () => {
		const chromatic = new TransformerHarmoniser({
			root: 3,
			mode: Array.from({ length: 12 }, (_, i) => i)
		})
		const explorer = new TransformerScaleExplorer()
		const transposer = fake("Transposer", { semitones: 3 })
		const unconfigurable = { type: "Odd", options: { root: 1, mode: [0, 2] } }
		const options = JSON.stringify(explorer.options)
		expect(
			applyKeyToTransformers([chromatic, explorer, transposer, unconfigurable, {}], dMinor)
		).toEqual([])
		expect(chromatic.options.root).toBe(3)
		expect(JSON.stringify(explorer.options)).toBe(options)
		expect(transposer.setConfig).not.toHaveBeenCalled()
	})
	it("counts the transformers a key would change without changing them", () => {
		const harmoniser = new TransformerHarmoniser({ root: 7 })
		const transformers = [
			harmoniser,
			new TransformerChordifier(),
			fake("Latch", { mode: "toggle" })
		]
		expect(countKeyTransformers(transformers)).toBe(2)
		expect(harmoniser.options.root).toBe(7)
	})
})

describe("analysis dialog plan", () => {
	const context = (overrides = {}) => ({
		tempo: tempoControl(120),
		duration: 10,
		keyTransformers: 3,
		...overrides
	})

	it("summarises the detection", () => {
		expect(describeAnalysis(analysis())).toBe(
			"Detected 98 BPM (good confidence) · D minor (strength 0.72)"
		)
		expect(describeAnalysis(analysis({ bpm: 98.26, bpmConfidence: 0.4 }))).toContain(
			"98.3 BPM (poor confidence)"
		)
		expect(describeAnalysis(analysis({ bpmConfidence: 1.2 }))).toContain("fair")
		expect(describeAnalysis(analysis({ bpmConfidence: 4 }))).toContain("excellent")
	})
	it("ticks everything for a confident result", () => {
		const plan = planAnalysis(analysis(), context())
		expect(plan.tempo).toMatchObject({ label: "Set project tempo to 98 BPM", checked: true })
		expect(plan.align).toMatchObject({ label: "Align loop to detected beats", checked: true })
		expect(plan.key).toMatchObject({
			label: "Set key of 3 transformers to D minor",
			checked: true
		})
		expect([plan.tempo, plan.align, plan.key].map((option) => option.reason)).toEqual([
			undefined,
			undefined,
			undefined
		])
	})
	it("changes tempo and loop by default only at confidence 1 or more", () => {
		expect(planAnalysis(analysis({ bpmConfidence: 1 }), context()).tempo.checked).toBe(true)
		const plan = planAnalysis(analysis({ bpmConfidence: 0.99 }), context())
		expect(plan.tempo).toMatchObject({ checked: false, reason: undefined })
		expect(plan.align).toMatchObject({ checked: false, reason: undefined })
	})
	it("leaves the key alone for a weak estimate", () => {
		expect(planAnalysis(analysis({ keyStrength: 0.49 }), context()).key.checked).toBe(false)
		expect(planAnalysis(analysis({ keyStrength: 0.5 }), context()).key.checked).toBe(true)
	})
	it("disables the tempo with a reason under an external clock or without a tempo control", () => {
		for (const tempo of [tempoControl(120, false), undefined]) {
			const plan = planAnalysis(analysis(), context({ tempo }))
			expect(plan.tempo.checked).toBe(false)
			expect(plan.tempo.reason).toMatch(/external clock/)
		}
	})
	it("disables the tempo when it is out of range or already set", () => {
		expect(planAnalysis(analysis({ bpm: 400 }), context()).tempo.reason).toMatch(
			/outside 10–303/
		)
		expect(planAnalysis(analysis({ bpm: 5 }), context()).tempo.checked).toBe(false)
		const same = planAnalysis(analysis(), context({ tempo: tempoControl(98) })).tempo
		expect(same).toMatchObject({
			checked: false,
			reason: "The project tempo is already 98 BPM."
		})
	})
	it("disables the key when the chain has nothing to set, and the loop when the audio is too short", () => {
		const plan = planAnalysis(analysis(), context({ keyTransformers: 0, duration: 0.2 }))
		expect(plan.key).toMatchObject({
			checked: false,
			label: "Set key of transformers to D minor"
		})
		expect(plan.key.reason).toMatch(/No transformer/)
		expect(plan.align).toMatchObject({ checked: false })
		expect(plan.align.reason).toMatch(/too short/)
		expect(planAnalysis(analysis(), context({ keyTransformers: 1 })).key.label).toBe(
			"Set key of 1 transformer to D minor"
		)
	})
})

describe("analysis dialog", () => {
	beforeEach(() => {
		vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(
			function (this: HTMLDialogElement) {
				this.setAttribute("open", "")
			}
		)
		vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(
			function (this: HTMLDialogElement) {
				this.removeAttribute("open")
				this.dispatchEvent(new Event("close"))
			}
		)
	})
	const plan = () =>
		planAnalysis(analysis(), { tempo: tempoControl(98), duration: 10, keyTransformers: 2 })
	const button = (name: string) =>
		[...document.querySelectorAll("button")].find((item) => item.textContent === name)!

	it("labels every choice, explains disabled ones and focuses Apply", async () => {
		const result = askAnalysisChoices(plan())
		const dialog = document.querySelector("dialog")!
		expect(dialog.getAttribute("aria-labelledby")).toBe(dialog.querySelector("h2")!.id)
		expect(dialog.textContent).toContain(
			"Detected 98 BPM (good confidence) · D minor (strength 0.72)"
		)
		const [tempo, align, key] = [...dialog.querySelectorAll("input")]
		expect(tempo.closest("label")!.textContent).toContain("Set project tempo to 98 BPM")
		expect(tempo.disabled).toBe(true)
		expect(
			dialog.querySelector(`#${tempo.getAttribute("aria-describedby")}`)!.textContent
		).toBe("The project tempo is already 98 BPM.")
		expect([align.checked, key.checked]).toEqual([true, true])
		expect(button("Apply").autofocus).toBe(true)
		button("Dismiss").click()
		await result
	})
	it("resolves with the ticked choices on Apply and removes the dialog", async () => {
		const result = askAnalysisChoices(plan())
		document.querySelectorAll("input")[2].click()
		button("Apply").click()
		await expect(result).resolves.toEqual({
			tempo: false,
			align: true,
			key: false,
			harmony: false
		})
		expect(document.querySelector("dialog")).toBeNull()
	})
	it("resolves with nothing on Dismiss or Escape", async () => {
		const dismissed = askAnalysisChoices(plan())
		button("Dismiss").click()
		await expect(dismissed).resolves.toBeUndefined()
		const escaped = askAnalysisChoices(plan())
		// Escape cancels the modal dialog, which closes it without a button
		document.querySelector("dialog")!.close()
		await expect(escaped).resolves.toBeUndefined()
		expect(document.querySelector("dialog")).toBeNull()
	})
})

describe("analysing an imported loop", () => {
	const buffer = { duration: 10 }
	const target = (overrides: Record<string, unknown> = {}) => {
		const harmoniser = new TransformerHarmoniser({ root: 0 })
		const output = {
			audioBuffer: buffer as unknown,
			applyAnalysis: vi.fn(() => true)
		}
		const chain = {
			transformers: [harmoniser, fake("Latch", { mode: "toggle" })],
			isDestroyed: false,
			dispatchEvent: vi.fn()
		}
		const tempo = tempoControl(120)
		return { output, chain, tempo, harmoniser, ...overrides } as any
	}
	beforeEach(() => {
		mocks.analyse.mockReset()
		mocks.analyse.mockResolvedValue(analysis())
	})

	it("applies the chosen tempo, loop alignment and key", async () => {
		const { output, chain, tempo, harmoniser } = target()
		const ask = vi.fn(async () => ({ tempo: true, align: true, key: true }))
		await analyseImportedLoop({ output, chain, tempo }, ask)
		expect(mocks.analyse).toHaveBeenCalledWith(buffer)
		expect(ask.mock.calls[0][0].summary).toContain("98 BPM")
		expect(tempo.set).toHaveBeenCalledWith(98)
		expect(output.applyAnalysis).toHaveBeenCalledWith(analysis(), { align: false })
		expect(output.applyAnalysis).toHaveBeenLastCalledWith(analysis())
		expect(harmoniser.options).toMatchObject({ root: 2, mode: AEOLIAN_INTERVALS })
		expect(chain.dispatchEvent).toHaveBeenCalledOnce()
		expect(chain.dispatchEvent.mock.calls[0][0].type).toBe("configurationChanged")
	})
	it("applies only what was ticked", async () => {
		const { output, chain, tempo, harmoniser } = target()
		await analyseImportedLoop(
			{ output, chain, tempo },
			vi.fn(async () => ({ tempo: false, align: false, key: false }))
		)
		expect(tempo.set).not.toHaveBeenCalled()
		expect(output.applyAnalysis).toHaveBeenCalledOnce()
		expect(harmoniser.options.root).toBe(0)
		expect(chain.dispatchEvent).not.toHaveBeenCalled()
	})
	it("does not set the tempo when the clock became external after the dialog opened", async () => {
		const { output, chain } = target()
		let canSet = true
		const tempo = { get: () => 120, canSet: () => canSet, set: vi.fn() }
		await analyseImportedLoop(
			{ output, chain, tempo },
			vi.fn(async () => {
				canSet = false
				return { tempo: true, align: false, key: false }
			})
		)
		expect(tempo.set).not.toHaveBeenCalled()
	})
	it("applies nothing on dismiss, and nothing to a loop replaced during analysis", async () => {
		const dismissed = target()
		await analyseImportedLoop(
			dismissed,
			vi.fn(async () => undefined)
		)
		expect(dismissed.tempo.set).not.toHaveBeenCalled()

		const replaced = target()
		mocks.analyse.mockImplementationOnce(async () => {
			replaced.output.audioBuffer = { duration: 3 }
			return analysis()
		})
		const ask = vi.fn()
		await analyseImportedLoop(replaced, ask)
		expect(ask).not.toHaveBeenCalled()
		expect(replaced.output.applyAnalysis).not.toHaveBeenCalled()
	})
	it("skips the dialog when there is nothing to offer", async () => {
		const { output } = target()
		const chain = { transformers: [], isDestroyed: false, dispatchEvent: vi.fn() }
		const ask = vi.fn()
		// An external clock and no key transformers leave only the loop alignment, which is still offered
		await analyseImportedLoop({ output, chain, tempo: tempoControl(120, false) } as any, ask)
		expect(ask).toHaveBeenCalledOnce()
		ask.mockClear()
		// Audio too short to align leaves nothing at all
		output.audioBuffer = { duration: 0.2 }
		mocks.analyse.mockResolvedValue(analysis({ bpm: 98 }))
		await analyseImportedLoop({ output, chain, tempo: tempoControl(120, false) } as any, ask)
		expect(ask).not.toHaveBeenCalled()
		expect(output.applyAnalysis).toHaveBeenCalledWith(expect.anything(), { align: false })
	})
	it("does not analyse when no audio is loaded", async () => {
		const { output, chain } = target()
		output.audioBuffer = undefined
		await analyseImportedLoop({ output, chain }, vi.fn())
		expect(mocks.analyse).not.toHaveBeenCalled()
	})
})

describe("media import with analysis", () => {
	const chain = {}
	let output: any, manager: any
	beforeEach(() => {
		vi.resetAllMocks()
		output = {
			connect: vi.fn(),
			destroy: vi.fn(),
			loadSample: vi.fn(),
			audioBuffer: { duration: 10 },
			applyAnalysis: vi.fn()
		}
		mocks.output.mockResolvedValue(output)
		manager = {
			activeChain: chain,
			deviceOptions: { mixer: {} },
			audioContext: { resume: vi.fn() },
			addDevice: vi.fn()
		}
	})
	const wav = () => new File(["RIFF0000WAVEdata"], "loop.dat")

	it("still adds the loop when analysis fails", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		mocks.analyse.mockRejectedValue(new Error("WASM unavailable"))
		await expect(createMediaImporter(manager)(wav())).resolves.toBeUndefined()
		expect(manager.addDevice).toHaveBeenCalledWith(chain, output, "output")
		await vi.waitFor(() =>
			expect(warn).toHaveBeenCalledWith("Audio analysis unavailable", expect.any(Error))
		)
		expect(output.destroy).not.toHaveBeenCalled()
	})
	it("does not wait for analysis to finish", async () => {
		mocks.analyse.mockReturnValue(new Promise(() => {}))
		await createMediaImporter(manager)(wav())
		expect(manager.addDevice).toHaveBeenCalledOnce()
		expect(mocks.analyse).toHaveBeenCalledWith(output.audioBuffer)
	})
	it("analyses only after the device is added, and never when decoding fails", async () => {
		mocks.analyse.mockReturnValue(new Promise(() => {}))
		manager.addDevice.mockImplementation(() => expect(mocks.analyse).not.toHaveBeenCalled())
		await createMediaImporter(manager)(wav())
		mocks.analyse.mockClear()
		output.loadSample.mockRejectedValue(new Error("Unsupported codec"))
		await expect(createMediaImporter(manager)(wav())).rejects.toThrow("Unsupported codec")
		expect(mocks.analyse).not.toHaveBeenCalled()
	})
})
describe("shared harmony from the detected key", () => {
	const harmonyControl = (
		current = { root: 0, scale: 2741, chord: 145 },
		{ external = false, sections = false } = {}
	) => ({
		get: vi.fn(() => current),
		external: vi.fn(() => external),
		sections: vi.fn(() => sections),
		set: vi.fn()
	})
	const context = (harmony?: ReturnType<typeof harmonyControl>) => ({
		tempo: tempoControl(120),
		harmony,
		duration: 10,
		keyTransformers: 1,
		fileName: "groove.wav"
	})

	it("rotates the scale and tonic triad to the detected key", () => {
		// D natural minor: D E F G A Bb C; D minor triad: D F A
		const dMinor = [2, 4, 5, 7, 9, 10, 0].reduce((mask, pc) => mask | (1 << pc), 0)
		const triad = [2, 5, 9].reduce((mask, pc) => mask | (1 << pc), 0)
		expect(harmonyForKey({ key: 2, scale: "minor" })).toEqual({
			root: 2,
			scale: dMinor,
			chord: triad
		})
		expect(harmonyForKey({ key: 0, scale: "major" })).toEqual({
			root: 0,
			scale: 2741,
			chord: 145
		})
	})
	it("is offered but never ticked by default, because it changes every chain", () => {
		const option = planAnalysis(analysis(), context(harmonyControl())).harmony
		expect(option).toMatchObject({
			label: "Set the shared harmony to D minor, the key detected in “groove.wav” (affects every chain)",
			checked: false,
			reason: undefined
		})
	})
	it("says which file and method the key came from", () => {
		expect(planAnalysis(analysis(), context(harmonyControl())).source).toBe(
			"Measured from “groove.wav” by Essentia: the tempo from its beat tracker, the key by matching the audio’s pitch content against major and minor key profiles."
		)
		const long = planAnalysis(analysis(), { ...context(), duration: 400, fileName: undefined })
		expect(long.source).toMatch(/^Measured from the first 3 minutes of the dropped audio/)
	})
	it("shows the source in the dialog", async () => {
		const result = askAnalysisChoices(planAnalysis(analysis(), context(harmonyControl())))
		expect(document.querySelector("dialog")!.textContent).toContain(
			"Measured from “groove.wav”"
		)
		;[...document.querySelectorAll("button")]
			.find((item) => item.textContent === "Dismiss")!
			.click()
		await result
	})
	it("explains why it cannot be chosen", () => {
		expect(planAnalysis(analysis(), context()).harmony.reason).toMatch(/unavailable/)
		expect(
			planAnalysis(analysis(), context(harmonyControl(undefined, { external: true }))).harmony
				.reason
		).toMatch(/external source/)
		expect(
			planAnalysis(analysis(), context(harmonyControl(undefined, { sections: true }))).harmony
				.reason
		).toMatch(/Song sections/)
		const already = harmonyControl(harmonyForKey({ key: 2, scale: "minor" }))
		expect(planAnalysis(analysis(), context(already)).harmony.reason).toBe(
			"The shared harmony is already D minor."
		)
	})
	it("sets the shared harmony only when ticked", async () => {
		mocks.analyse.mockReset()
		mocks.analyse.mockResolvedValue(analysis())
		const output = {
			audioBuffer: { duration: 10 } as unknown,
			applyAnalysis: vi.fn(() => true)
		}
		const chain = { transformers: [], isDestroyed: false, dispatchEvent: vi.fn() }
		const harmony = harmonyControl()
		const choices = { tempo: false, align: false, key: false, harmony: false }
		await analyseImportedLoop(
			{ output, chain, harmony } as any,
			vi.fn(async () => choices)
		)
		expect(harmony.set).not.toHaveBeenCalled()
		await analyseImportedLoop(
			{ output, chain, harmony } as any,
			vi.fn(async () => ({ ...choices, harmony: true }))
		)
		expect(harmony.set).toHaveBeenCalledWith(harmonyForKey({ key: 2, scale: "minor" }))
	})
	it("shows the choice in the dialog", async () => {
		const result = askAnalysisChoices(planAnalysis(analysis(), context(harmonyControl())))
		const boxes = [...document.querySelectorAll("dialog input")] as HTMLInputElement[]
		expect(boxes).toHaveLength(4)
		expect(boxes[3].checked).toBe(false)
		expect(boxes[3].closest("label")!.textContent).toContain("shared harmony to D minor")
		boxes[3].click()
		;[...document.querySelectorAll("button")]
			.find((item) => item.textContent === "Apply")!
			.click()
		await expect(result).resolves.toMatchObject({ harmony: true })
	})
})