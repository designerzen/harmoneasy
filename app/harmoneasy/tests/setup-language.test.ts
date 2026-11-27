// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import { interpretSetupWithAI } from "../source/services/setup-language"
import { interpretSetupDescription } from "../source/services/setup-interpreter"

afterEach(() => vi.unstubAllGlobals())

const suggestion = {
	goal: "genre",
	contextId: "jazz",
	inputs: ["gamepad"],
	feedback: "sound",
	pace: "slow",
	explanation: "Slow jazz with your game controller."
}

function mockModel(value: unknown) {
	const session = { prompt: vi.fn().mockResolvedValue(JSON.stringify(value)), destroy: vi.fn() }
	vi.stubGlobal("LanguageModel", {
		availability: vi.fn().mockResolvedValue("available"),
		create: vi.fn().mockResolvedValue(session)
	})
	return session
}

it("reads conversational corrections with local hints and returns a reviewable suggestion", async () => {
	const session = mockModel(suggestion)
	const description =
		"Um jazz, fast, no actually slow, without a keyboard, with my game controller"
	const status = vi.fn()
	const result = await interpretSetupWithAI(
		description,
		interpretSetupDescription(description),
		new AbortController().signal,
		status
	)
	expect(result.answers).toMatchObject({ inputs: ["gamepad"], pace: "slow", contextId: "jazz" })
	expect(result.source).toBe("ai")
	expect(result.summary).toBe(suggestion.explanation)
	const prompt = session.prompt.mock.calls[0][0]
	expect(prompt).toContain("use their final preference")
	expect(prompt).toContain(description)
	expect(prompt).toContain("A keyword reader")
	expect(status).toHaveBeenCalledWith("Reading your description…")
	expect(session.destroy).toHaveBeenCalledOnce()
})

it.each([
	{ ...suggestion, goal: "file" },
	{ ...suggestion, inputs: ["gamepad", "gamepad"] },
	{ ...suggestion, explanation: 123 },
	{ ...suggestion, explanation: "x".repeat(301) },
	{ ...suggestion, execute: "invented action" }
])("rejects unsupported or malformed suggestions", async (value) => {
	const session = mockModel(value)
	await expect(
		interpretSetupWithAI(
			"jazz",
			interpretSetupDescription("jazz"),
			new AbortController().signal,
			vi.fn()
		)
	).rejects.toThrow("supported setup")
	expect(session.destroy).toHaveBeenCalledOnce()
})

it("does not create a model session for a cancelled request", async () => {
	const session = mockModel(suggestion)
	const controller = new AbortController()
	controller.abort()
	await expect(
		interpretSetupWithAI("jazz", interpretSetupDescription("jazz"), controller.signal, vi.fn())
	).rejects.toThrow()
	expect(session.prompt).not.toHaveBeenCalled()
})