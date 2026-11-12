import { describe, expect, it } from "vitest"
import {
	EMOJI_VOICING_EXPRESSIVE,
	TransformerEmoji
} from "../../../packages/audiobus/io/transformers/transformer-emoji"
import { musicalCommand } from "../../../packages/audiobus/io/event-clip"
import { NOTE_ON } from "../../../packages/audiobus/commands/commands"
import {
	EMOJI_EXPRESSIONS,
	getMusicalDetailsFromEmoji,
	getPrimaryIntervalsForEmoji
} from "../../../packages/audiobus/tuning/emotion-chords"

const note = (number: number, velocity = 100) =>
	musicalCommand({ type: NOTE_ON, number, velocity, channel: 1, from: "keys", startAt: 0 })
const timer = {} as never
const play = (config: Record<string, unknown>, number = 60) =>
	new TransformerEmoji(config).transform([note(number)], timer)
const numbers = (commands: { number: number }[]) => commands.map((c) => c.number)

describe("TransformerEmoji voicing", () => {
	it("defaults to simple and keeps the original chords for saved presets", () => {
		// a preset saved before the option existed
		expect(numbers(play({ emoji: "😄" }))).toEqual([60, 64, 67, 71])
		expect(numbers(play({ emoji: "😁" }))).toEqual([60, 67, 72])
		expect(numbers(play({ emoji: "😊" }))).toEqual([60, 64, 67])
		expect(numbers(play({ emoji: "🎸" }))).toEqual([60, 63, 65, 66, 67, 70])
	})

	it("scales velocity by the emotion in simple mode", () => {
		expect(play({ emoji: "😊" })[0].velocity).toBeCloseTo(90)
		expect(play({ emoji: "😴" })[0].velocity).toBeCloseTo(50)
	})

	it("uses the PhotoSYNTH mapping in expressive mode", () => {
		for (const emoji of ["😄", "😁", "😭", "😠", "🥰"]) {
			const expected = getMusicalDetailsFromEmoji(60, emoji)?.map((n) => n.noteNumber)
			expect(numbers(play({ emoji, voicing: EMOJI_VOICING_EXPRESSIVE }))).toEqual(expected)
		}
		expect(numbers(play({ emoji: "😄", voicing: "expressive" }))).toEqual([60, 64, 69, 74])
		expect(numbers(play({ emoji: "😭", voicing: "expressive" }))).toHaveLength(4)
		expect(numbers(play({ emoji: "😊", voicing: "expressive" }))).toEqual([60, 64, 69])
	})

	it("keeps the simple chord for emoji PhotoSYNTH does not define", () => {
		for (const emoji of ["😡", "🎸", "☮️", "😌"]) {
			expect(numbers(play({ emoji, voicing: "expressive" }))).toEqual(
				numbers(play({ emoji }))
			)
		}
	})

	it("transposes with the played note and keeps every note within MIDI range", () => {
		const high = play({ emoji: "😁", voicing: "expressive" }, 120)
		expect(numbers(high).every((n) => n >= 0 && n <= 127)).toBe(true)
		expect(numbers(play({ emoji: "😄", voicing: "expressive" }, 48))).toEqual([48, 52, 57, 62])
	})

	it("plays PhotoSYNTH-only emoji in both modes and lists them as options", () => {
		const emoji = EMOJI_EXPRESSIONS.EMOJI_HEART_BLUE
		const simple = numbers(play({ emoji }))
		expect(simple).toEqual(getPrimaryIntervalsForEmoji(emoji).map((i) => 60 + i))
		expect(numbers(play({ emoji, voicing: "expressive" }))).toHaveLength(3)
		const field = new TransformerEmoji().fields.find((f) => f.name === "emoji")
		expect(((field?.values ?? []) as { value: string }[]).map((v) => v.value)).toContain(emoji)
		expect(((field?.values ?? []) as { value: string }[]).length).toBeGreaterThan(40)
	})

	it("offers the voicing select with simple first", () => {
		const field = new TransformerEmoji().fields.find((f) => f.name === "voicing")
		expect(field).toMatchObject({ type: "select", default: "simple" })
		expect(((field?.values ?? []) as { value: string }[]).map((v) => v.value)).toEqual([
			"simple",
			"expressive"
		])
	})

	it("passes notes through when disabled", () => {
		const commands = [note(60)]
		expect(
			new TransformerEmoji({ enabled: false, voicing: "expressive" }).transform(
				commands,
				timer
			)
		).toBe(commands)
	})
})