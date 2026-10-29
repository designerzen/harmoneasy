import { expect, it } from "vitest"
import {
	TransformerNoteReverb,
	ID_NOTE_REVERB
} from "../../../packages/audiobus/io/transformers/transformer-note-reverb"
import { tranformerFactory } from "../../../packages/audiobus/io/transformer-factory"
import { NOTE_ON, NOTE_OFF } from "../../../packages/audiobus/commands"
import type { IAudioCommand } from "../../../packages/audiobus/audio-command-interface"

const note = (type = NOTE_ON, velocity = 100) =>
	({
		type,
		velocity,
		number: 60,
		channel: 2,
		startAt: 0,
		time: 10,
		endAt: 0.1,
		from: "keyboard"
	}) as IAudioCommand

it("registers the transformer and preserves the original while generating softer timed echoes", () => {
	const transformer = tranformerFactory(ID_NOTE_REVERB, { repeats: 3, delay: 250, decay: 0.5 })
	expect(transformer).toBeInstanceOf(TransformerNoteReverb)
	const original = note()
	const result = transformer.transform([original], {} as any)
	expect(result[0]).toBe(original)
	expect(result.map((command) => command.velocity)).toEqual([100, 50, 25, 12])
	expect(result.map((command) => command.startAt)).toEqual([0, 0.25, 0.5, 0.75])
	expect(result[1]).toMatchObject({ channel: 2, number: 60, from: "keyboard", endAt: 0.35 })
	expect(original.velocity).toBe(100)
})

it("echoes releases arriving in a separate batch with matching intervals", () => {
	const transformer = new TransformerNoteReverb({ repeats: 2, delay: 250 })
	transformer.transform([note()], {} as any)
	const release = { ...note(NOTE_OFF, 0), startAt: 0.2, endAt: 0 }
	const result = transformer.transform([release], {} as any)
	expect(result.map((command) => command.startAt)).toEqual([0.2, 0.45, 0.7])
	expect(
		result.every(
			(command) => command.type === NOTE_OFF && command.velocity === 0 && command.endAt === 0
		)
	).toBe(true)
})

it("parses UI values, bypasses disabled effects and leaves other commands unchanged", () => {
	const transformer = new TransformerNoteReverb()
	transformer.setConfig("repeats", "2")
	transformer.setConfig("decay", "0.5")
	const control = { ...note(), type: "control-change" }
	expect(transformer.transform([control], {} as any)).toEqual([control])
	expect(
		transformer.transform([note(NOTE_ON, 1)], {} as any).map((command) => command.velocity)
	).toEqual([1, 1, 1])
	expect(
		transformer
			.transform([note(NOTE_ON, 0)], {} as any)
			.every((command) => command.velocity === 0)
	).toBe(true)
	transformer.setConfig("enabled", "0")
	const commands = [note()]
	expect(transformer.transform(commands, {} as any)).toBe(commands)
})