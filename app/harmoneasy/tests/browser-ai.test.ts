// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	MIDI_NOTES_SCHEMA,
	promptBrowserAI,
	validateMidiNotes
} from "../../../packages/audiobus/io/browser-ai"
import InputPromptAI from "../../../packages/audiobus/io/inputs/input-prompt-ai"
import {
	describeMusicalContext,
	noteName,
	noteNumber,
	parseFugue
} from "../../../packages/audiobus/io/ai-fugue"
import InputPromptAISpeech from "../../../packages/audiobus/io/inputs/input-prompt-ai-speech"
import {
	harmonyMapping,
	ID_BROWSER_AI,
	TransformerBrowserAI
} from "../../../packages/audiobus/io/transformers/transformer-browser-ai"
import { tranformerFactory } from "../../../packages/audiobus/io/transformer-factory"
import { INPUT_EVENT } from "../../../packages/audiobus/events/event-constants"
import { NOTE_ON, NOTE_OFF } from "../../../packages/audiobus/commands/commands"
import { createAudioCommand } from "../../../packages/audiobus/commands/audio-command-factory"

const session = { prompt: vi.fn(), destroy: vi.fn() }
const api = { availability: vi.fn(), create: vi.fn() }
const devices: Array<{ destroy(): void }> = []
const PATTERN =
	'{"beats": 4, "notes": [{"beat": 0, "note": "C4", "duration": 1, "velocity": 110}, {"beat": 1, "note": "E4", "duration": 1}, {"beat": 2, "note": 67, "duration": 2}]}'
const voicings = Array.from({ length: 12 }, () => [0, 4, 7])
beforeEach(() => {
	vi.useFakeTimers()
	api.availability.mockResolvedValue("available")
	api.create.mockResolvedValue(session)
	session.prompt.mockResolvedValue("[60, 62, 64]")
	vi.stubGlobal("LanguageModel", api)
})
afterEach(() => {
	devices.splice(0).forEach((device) => device.destroy())
	vi.useRealTimers()
	vi.resetAllMocks()
	vi.unstubAllGlobals()
})

describe("browser native AI", () => {
	it("checks matching capabilities, constrains JSON and releases the session", async () => {
		const controller = new AbortController()
		expect(await promptBrowserAI("C major", MIDI_NOTES_SCHEMA, controller.signal)).toEqual([
			60, 62, 64
		])
		expect(api.create.mock.lastCall![0]).toMatchObject(api.availability.mock.lastCall![0])
		expect(session.prompt).toHaveBeenCalledWith("C major", {
			signal: controller.signal,
			responseConstraint: MIDI_NOTES_SCHEMA
		})
		expect(session.destroy).toHaveBeenCalledOnce()
	})
	it("fails clearly on unsupported devices without creating sessions", async () => {
		api.availability.mockResolvedValue("unavailable")
		await expect(promptBrowserAI("x", {}, new AbortController().signal)).rejects.toThrow(
			"unavailable on this device"
		)
		expect(api.create).not.toHaveBeenCalled()
		vi.stubGlobal("LanguageModel", undefined)
		await expect(promptBrowserAI("x", {}, new AbortController().signal)).rejects.toThrow(
			"Prompt API"
		)
	})
	it("destroys a malformed response session and rejects invalid MIDI", async () => {
		session.prompt.mockResolvedValue("not JSON")
		await expect(promptBrowserAI("x", {}, new AbortController().signal)).rejects.toThrow()
		expect(session.destroy).toHaveBeenCalledOnce()
		for (const value of [[], [128], [1.5], ["60"], Array(65).fill(60)]) {
			expect(() => validateMidiNotes(value)).toThrow()
		}
	})
	it("discards a result if cancelled while the model is being created", async () => {
		let resolve!: (value: typeof session) => void
		api.create.mockReturnValue(
			new Promise((done) => {
				resolve = done
			})
		)
		const controller = new AbortController(),
			result = promptBrowserAI("x", {}, controller.signal)
		await vi.waitFor(() => expect(api.create).toHaveBeenCalled())
		controller.abort()
		resolve(session)
		await expect(result).rejects.toThrow()
		expect(session.prompt).not.toHaveBeenCalled()
		expect(session.destroy).toHaveBeenCalled()
	})
})

describe("native prompt input", () => {
	it("captures speech as plain text, waits for a user gesture and aborts on panel removal", async () => {
		const recognition = {
			start: vi.fn(),
			stop: vi.fn(),
			abort: vi.fn(),
			onresult: undefined as any
		}
		vi.stubGlobal(
			"webkitSpeechRecognition",
			class {
				constructor() {
					return recognition
				}
			}
		)
		const input = new InputPromptAISpeech()
		devices.push(input)
		const panel = await input.createGui()
		expect(await input.createGui()).toBe(panel)
		recognition.onresult({
			resultIndex: 0,
			results: [{ 0: { transcript: "<img src=x onerror=alert(1)>" }, isFinal: true }]
		})
		expect(panel.querySelector("#transcript-preview")!.textContent).toContain("<img")
		expect(panel.querySelector("#transcript-preview img")).toBeNull()
		expect(api.create).not.toHaveBeenCalled()
		await input.destroyGui()
		expect(recognition.abort).toHaveBeenCalled()
		expect(await input.createGui()).not.toBe(panel)
	})
	it("previews a generated pattern with rhythm and releases held notes on stop", async () => {
		const input = new InputPromptAI({ now: () => 10, bpm: 120 })
		devices.push(input)
		const receive = vi.fn()
		input.addEventListener(INPUT_EVENT, (event) => receive((event as any).command))
		session.prompt.mockResolvedValue(PATTERN)
		await input.generateSequenceFromPrompt("C major")
		expect(receive).toHaveBeenLastCalledWith(
			expect.objectContaining({ type: NOTE_ON, number: 60, velocity: 110, startAt: 10 })
		)
		input.stopGeneration()
		expect(receive).toHaveBeenLastCalledWith(
			expect.objectContaining({ type: NOTE_OFF, number: 60 })
		)
		await vi.advanceTimersByTimeAsync(2000)
		expect(receive).toHaveBeenCalledTimes(2)
	})
	it("ignores generation completed after removal and surfaces invalid model output", async () => {
		const input = new InputPromptAI()
		devices.push(input)
		const panel = await input.createGui(),
			receive = vi.fn()
		input.addEventListener(INPUT_EVENT, receive)
		session.prompt.mockResolvedValue(
			'{"beats": 4, "notes": [{"beat": 0, "note": "H9", "duration": 1}]}'
		)
		await input.generateSequenceFromPrompt("C major")
		expect(panel.querySelector("[role=status]")!.textContent).toContain("invalid note")
		expect(receive).not.toHaveBeenCalled()
		let resolve!: (value: string) => void
		session.prompt.mockReturnValue(
			new Promise((done) => {
				resolve = done
			})
		)
		const pending = input.generateSequenceFromPrompt("C minor")
		await vi.waitFor(() => expect(session.prompt).toHaveBeenCalledTimes(2))
		input.destroy()
		resolve(PATTERN)
		await pending
		expect(receive).not.toHaveBeenCalled()
	})
	it("routes drum patterns to channel ten and sends the kit's pads as context", async () => {
		const input = new InputPromptAI({ mode: "drums" })
		devices.push(input)
		input.setMusicalContext({ drumPads: [{ name: "Kick", note: 35 }] })
		const receive = vi.fn()
		input.addEventListener(INPUT_EVENT, (event) => receive((event as any).command))
		session.prompt.mockResolvedValue(
			'{"beats": 1, "notes": [{"beat": 0, "note": 35, "duration": 0.25}]}'
		)
		await input.generateSequenceFromPrompt("rock beat")
		expect(session.prompt.mock.lastCall![0]).toContain("Kick 35")
		expect(receive).toHaveBeenLastCalledWith(
			expect.objectContaining({ number: 35, channel: 10 })
		)
	})
	it("starts on the next transport bar, loops, and swaps a new pattern on a boundary", async () => {
		const input = new InputPromptAI({ pattern: JSON.parse(PATTERN) })
		devices.push(input)
		const played: Array<[string, number]> = []
		input.addEventListener(INPUT_EVENT, (event) => {
			const { type, number } = (event as any).command
			played.push([type, number])
		})
		input.startClock()
		input.setMusicalBeat(1.5)
		input.setMusicalBeat(3.9)
		expect(played).toEqual([])
		input.setMusicalBeat(4)
		input.setMusicalBeat(5)
		input.setMusicalBeat(6.5)
		expect(played).toEqual([
			[NOTE_ON, 60],
			[NOTE_OFF, 60],
			[NOTE_ON, 64],
			[NOTE_OFF, 64],
			[NOTE_ON, 67]
		])
		input.setMusicalBeat(8)
		expect(played.slice(-2)).toEqual([
			[NOTE_OFF, 67],
			[NOTE_ON, 60]
		])
		session.prompt.mockResolvedValue(
			'{"beats": 2, "notes": [{"beat": 0, "note": "D4", "duration": 1}]}'
		)
		await input.generateSequenceFromPrompt("next")
		input.setMusicalBeat(9)
		expect(played.at(-1)).toEqual([NOTE_ON, 64])
		input.setMusicalBeat(12)
		expect(played.slice(-2)).toEqual([
			[NOTE_OFF, 64],
			[NOTE_ON, 62]
		])
		input.stopClock()
		expect(played.at(-1)).toEqual([NOTE_OFF, 62])
	})
})

describe("AI fugue patterns", () => {
	it("parses note names and numbers, trims to the loop and sorts by beat", () => {
		expect(noteNumber("C4")).toBe(60)
		expect(noteNumber("Bb3")).toBe(58)
		expect(noteNumber("C#-1")).toBe(1)
		expect(noteName(61)).toBe("C#4")
		expect(
			parseFugue({
				beats: 2,
				notes: [
					{ beat: 1.5, note: "E4", duration: 2 },
					{ beat: 0, note: 48, duration: 0.5, velocity: 90 },
					{ beat: 3, note: "G4", duration: 1 }
				]
			})
		).toEqual({
			beats: 2,
			notes: [
				{ beat: 0, number: 48, duration: 0.5, velocity: 90 },
				{ beat: 1.5, number: 64, duration: 0.5, velocity: 100 }
			]
		})
		for (const value of [
			[60],
			{ beats: 0, notes: [] },
			{ beats: 4, notes: [{ beat: 0, note: "C4" }] },
			{ beats: 4, notes: [{ beat: 0, note: 128, duration: 1 }] },
			{ beats: 2, notes: [{ beat: 3, note: 60, duration: 1 }] }
		]) {
			expect(() => parseFugue(value)).toThrow()
		}
	})
	it("describes the key, followed chords and instruments, but no key for drums", () => {
		const context = {
			// D natural minor as absolute pitch classes C D E F G A B♭.
			harmony: { root: 2, scale: 1717, chord: 0 },
			progression: [{ name: "Dm", root: 2, mask: 0, beats: 4 }],
			outputs: ["Moog"]
		}
		const text = describeMusicalContext(context, "melody", 96)
		expect(text).toContain("Tempo 96 BPM")
		expect(text).toContain("Key: D natural minor (C D E F G A Bb)")
		expect(text).toContain("Dm (4 beats)")
		expect(text).toContain("Played by: Moog")
		const drums = describeMusicalContext(context, "drums", 96)
		expect(drums).not.toContain("Key:")
		expect(drums).toContain("Kick 36")
	})
})

describe("browser AI harmony transformer", () => {
	it("generates only on request and round trips its prepared harmony without inference", async () => {
		const transformer = tranformerFactory(ID_BROWSER_AI)
		devices.push(transformer)
		expect(transformer).toBeInstanceOf(TransformerBrowserAI)
		expect(api.create).not.toHaveBeenCalled()
		session.prompt.mockResolvedValue(JSON.stringify(voicings))
		await (transformer as TransformerBrowserAI).prepareHarmony()
		const config = JSON.parse(transformer.exportConfig()),
			restored = tranformerFactory(config.type, config)
		devices.push(restored)
		expect(restored.options.mapping).toBe(harmonyMapping(voicings))
		expect(api.create).toHaveBeenCalledOnce()
	})
	it("releases the original generated pitches even after the harmony changes", () => {
		const transformer = new TransformerBrowserAI({ mapping: harmonyMapping(voicings) })
		devices.push(transformer)
		const timer = { now: 10, bpm: 120 } as any
		const on = { ...createAudioCommand(NOTE_ON, 60, 10), channel: 1 }
		expect(transformer.transform([on], timer).map((command) => command.number)).toEqual([
			60, 64, 67
		])
		transformer.setConfig(
			"mapping",
			harmonyMapping(Array.from({ length: 12 }, () => [0, 3, 7]))
		)
		const off = { ...on, type: NOTE_OFF, velocity: 0, startAt: 11 }
		expect(
			transformer
				.transform([off], { ...timer, now: 11 })
				.map((command) => [command.type, command.number])
		).toEqual([
			[NOTE_OFF, 60],
			[NOTE_OFF, 64],
			[NOTE_OFF, 67]
		])
		expect(api.create).not.toHaveBeenCalled()
	})
	it("retains the previous harmony on failure and validates model intervals", async () => {
		const mapping = harmonyMapping(voicings),
			transformer = new TransformerBrowserAI({ mapping })
		devices.push(transformer)
		session.prompt.mockResolvedValue("[[0, 4]]")
		await transformer.prepareHarmony()
		expect(transformer.options.mapping).toBe(mapping)
		expect(transformer.status).toContain("failed")
		expect(() => harmonyMapping(Array.from({ length: 12 }, () => [25]))).toThrow()
	})
})