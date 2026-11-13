import { describe, expect, it } from "vitest"
import { TransformerArpeggiator } from "../../../packages/audiobus/io/transformers/transformer-arpeggiator"
import { musicalCommand } from "../../../packages/audiobus/io/event-clip"
import { NOTE_ON } from "../../../packages/audiobus/commands/commands"

const noteOn = (number: number) =>
	musicalCommand({ type: NOTE_ON, number, velocity: 100, channel: 1, from: "keys", startAt: 0 })
const clock = (now = 0) => ({ now, BPM: 120 }) as never

const playedNotes = (config: Record<string, unknown>) => {
	const arpeggiator = new TransformerArpeggiator({ rate: "1/16", collect: 0, ...config })
	return [
		...arpeggiator.transform([noteOn(60), noteOn(64)], clock()),
		...arpeggiator.tick(2, clock(2))
	]
		.filter((command) => command.type === NOTE_ON)
		.map((command) => command.number)
}

describe("TransformerArpeggiator harp pattern", () => {
	it("climbs four octaves whatever the octaves setting", () => {
		const up = playedNotes({ pattern: "up", octaves: 1 })
		const harp = playedNotes({ pattern: "harp", octaves: 1 })
		expect(up).toEqual([60, 64])
		expect(harp).toEqual([60, 64, 72, 76, 84, 88, 96, 100])
	})

	it("offers harp as a pattern option", () => {
		const field = new TransformerArpeggiator().fields.find((f) => f.name === "pattern")
		expect(((field?.values ?? []) as { value: string }[]).map((v) => v.value)).toContain("harp")
	})
})