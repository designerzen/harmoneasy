// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	MIDI_NOTES_SCHEMA,
	promptBrowserAI,
	validateMidiNotes
} from "../../../packages/audiobus/io/browser-ai"
import InputPromptAI from "../../../packages/audiobus/io/inputs/input-prompt-ai"
import InputPromptAISpeech from "../../../packages/audiobus/io/inputs/input-prompt-ai-speech"
import {
	harmonyMapping,
	ID_BROWSER_AI,
	TransformerBrowserAI
} from "../../../packages/audiobus/io/transformers/transformer-browser-ai"
import { tranformerFactory } from "../../../packages/audiobus/io/transformer-factory"
import { INPUT_EVENT } from "../../../packages/audiobus/event-constants"
import { NOTE_ON, NOTE_OFF } from "../../../packages/audiobus/commands"
import { createAudioCommand } from "../../../packages/audiobus/audio-command-factory"

const session = { prompt: vi.fn(), destroy: vi.fn() }
const api = { availability: vi.fn(), create: vi.fn() }
const devices: Array<{ destroy(): void }> = []
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
	it("plays in audio seconds and cancels future notes while releasing held notes", async () => {
		const input = new InputPromptAI({ now: () => 10, bpm: 120 })
		devices.push(input)
		const receive = vi.fn()
		input.addEventListener(INPUT_EVENT, (event) => receive((event as any).command))
		await input.generateSequenceFromPrompt("C major")
		expect(receive).toHaveBeenLastCalledWith(
			expect.objectContaining({ type: NOTE_ON, number: 60, startAt: 10 })
		)
		input.stopGeneration()
		expect(receive).toHaveBeenLastCalledWith(
			expect.objectContaining({ type: NOTE_OFF, number: 60 })
		)
		await vi.runAllTimersAsync()
		expect(receive).toHaveBeenCalledTimes(2)
	})
	it("ignores generation completed after removal and surfaces invalid model output", async () => {
		const input = new InputPromptAI()
		devices.push(input)
		const panel = await input.createGui(),
			receive = vi.fn()
		input.addEventListener(INPUT_EVENT, receive)
		session.prompt.mockResolvedValue("[60.5]")
		await input.generateSequenceFromPrompt("C major")
		expect(panel.querySelector("[role=status]")!.textContent).toContain("MIDI notes")
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
		resolve("[60, 63, 67]")
		await pending
		expect(receive).not.toHaveBeenCalled()
	})
	it("routes drum patterns to channel ten", async () => {
		const input = new InputPromptAI({ mode: "drums" })
		devices.push(input)
		const receive = vi.fn()
		input.addEventListener(INPUT_EVENT, (event) => receive((event as any).command))
		session.prompt.mockResolvedValue("[36, 38]")
		await input.generateSequenceFromPrompt("rock beat")
		expect(receive).toHaveBeenLastCalledWith(
			expect.objectContaining({ number: 36, channel: 10 })
		)
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