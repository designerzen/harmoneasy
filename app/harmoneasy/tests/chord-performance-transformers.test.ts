import { afterEach, describe, expect, it, vi } from "vitest"
import {
	tranformerFactory,
	TRANSFORMER_TYPE
} from "../../../packages/audiobus/io/transformer-factory"
import { TransformerHarp } from "../../../packages/audiobus/io/transformers/transformer-harp"
import { TransformerSlop } from "../../../packages/audiobus/io/transformers/transformer-slop"
import { TransformerChordArp } from "../../../packages/audiobus/io/transformers/transformer-chord-arp"
import {
	TransformerChordPattern,
	CHORD_PATTERNS
} from "../../../packages/audiobus/io/transformers/transformer-chord-pattern"
import { TransformerStrummer } from "../../../packages/audiobus/io/transformers/transformer-strummer"
import { createAudioCommand } from "../../../packages/audiobus/commands/audio-command-factory"
import { NOTE_ON, NOTE_OFF, CONTROL_CHANGE } from "../../../packages/audiobus/commands/commands"
import type { IAudioCommand } from "../../../packages/audiobus/commands/audio-command-interface"
import type { ITimerControl as Timer } from "netronome"

const clock = (now = 0, bpm = 120) => ({ now, bpm, BPM: bpm }) as Timer
const command = (type: string, pitch: number, at = 0, velocity = 100) =>
	Object.assign(createAudioCommand(type, pitch, at, "keyboard"), { channel: 1, velocity })
const on = (pitch = 60, at = 0, velocity = 100) => command(NOTE_ON, pitch, at, velocity)
const off = (pitch = 60, at = 0) => command(NOTE_OFF, pitch, at, 0)
const ons = (commands: IAudioCommand[]) => commands.filter((command) => command.type === NOTE_ON)
const offs = (commands: IAudioCommand[]) => commands.filter((command) => command.type === NOTE_OFF)
const pitches = (commands: IAudioCommand[]) => ons(commands).map((command) => command.number)
const times = (commands: IAudioCommand[]) =>
	ons(commands).map((command) => Math.round(command.startAt * 1000))
/** Every note left sounding once all the given commands have been applied in order */
const sounding = (commands: IAudioCommand[]) => {
	const notes: number[] = []
	for (const command of commands) {
		if (command.type === NOTE_ON) {
			notes.push(command.number)
		} else if (command.type === NOTE_OFF) {
			expect(notes).toContain(command.number)
			notes.splice(notes.indexOf(command.number), 1)
		}
	}
	return notes
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe("chord performance Transformers", () => {
	it("creates every new Transformer from its registered type", () => {
		for (const type of [
			TRANSFORMER_TYPE.ID_HARP,
			TRANSFORMER_TYPE.ID_SLOP,
			TRANSFORMER_TYPE.ID_CHORD_ARP,
			TRANSFORMER_TYPE.ID_CHORD_PATTERN
		]) {
			expect(tranformerFactory(type, {}).type).toBe(type)
		}
	})

	it("sweeps a chord up through four octaves and lets it ring until release", () => {
		const effect = new TransformerHarp({ collect: 0, speed: 50, falloff: 0 })
		const output = effect.transform([on(60), on(64), on(67)], clock())
		output.push(...effect.tick(1, clock(1)))
		expect(pitches(output)).toEqual([60, 64, 67, 72, 76, 79, 84, 88, 91, 96, 100, 103])
		expect(times(output)).toEqual([0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550])
		expect(offs(output)).toEqual([])
		output.push(...effect.transform([off(60, 2), off(64, 2), off(67, 2)], clock(2)))
		expect(sounding(output)).toEqual([])
	})
	it("stops a harp sweep at the strings already plucked when the keys are released", () => {
		const effect = new TransformerHarp({ collect: 0, speed: 50 })
		const output = effect.transform([on(60), on(64)], clock())
		output.push(...effect.tick(0.12, clock(0.12)))
		expect(pitches(output)).toEqual([60, 64, 72])
		output.push(...effect.transform([off(60, 0.13), off(64, 0.13)], clock(0.13)))
		output.push(...effect.tick(2, clock(2)))
		expect(pitches(output)).toEqual([60, 64, 72])
		expect(sounding(output)).toEqual([])
	})
	it("sweeps down, and up then down without leaving a string sounding twice", () => {
		const down = new TransformerHarp({ collect: 0, octaves: 2, direction: "down" })
		expect(
			pitches([...down.transform([on(60), on(64)], clock()), ...down.tick(1, clock(1))])
		).toEqual([76, 72, 64, 60])
		const both = new TransformerHarp({ collect: 0, octaves: 1, direction: "up-down" })
		const output = [
			...both.transform([on(60), on(64), on(67)], clock()),
			...both.tick(1, clock(1))
		]
		expect(pitches(output)).toEqual([60, 64, 67, 64, 60])
		expect(sounding(output).sort()).toEqual([60, 64, 67])
	})

	it("repeats the chord in a second octave within one strum", () => {
		const effect = new TransformerStrummer({
			collect: 0,
			spread: 100,
			direction: "up",
			octaves: 2
		})
		const output = [...effect.transform([on(60), on(64)], clock()), ...effect.tick(1, clock(1))]
		expect(pitches(output)).toEqual([60, 64, 72, 76])
		expect(times(output)).toEqual([0, 33, 67, 100])
		output.push(...effect.transform([off(60, 2), off(64, 2)], clock(2)))
		expect(sounding(output)).toEqual([])
	})

	it("strums low to high with a different lateness for every note of every stroke", () => {
		const random = vi.spyOn(Math, "random")
		const effect = new TransformerSlop({ collect: 0, spread: 100, slop: 40, falloff: 0 })
		random.mockReturnValueOnce(0.25).mockReturnValueOnce(1).mockReturnValueOnce(0.5)
		const first = effect.transform([on(67), on(60), on(64)], clock())
		first.push(...effect.tick(1, clock(1)))
		expect(pitches(first)).toEqual([60, 64, 67])
		expect(times(first)).toEqual([10, 90, 120])
		effect.transform([off(60, 1), off(64, 1), off(67, 1)], clock(1))
		random.mockReturnValueOnce(0).mockReturnValueOnce(0.5).mockReturnValueOnce(0.25)
		const second = effect.transform([on(60, 2), on(64, 2), on(67, 2)], clock(2))
		second.push(...effect.tick(3, clock(3)))
		// Still low to high, where a plain alternating strum would now come back down.
		expect(pitches(second)).toEqual([60, 64, 67])
		expect(times(second)).toEqual([2000, 2070, 2110])
	})
	it("drops a slopped note released before it sounds", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.5)
		const effect = new TransformerSlop({ collect: 0, slop: 100 })
		effect.transform([on(60)], clock())
		expect(effect.transform([off(60, 0.01)], clock(0.01))).toEqual([])
		expect(effect.tick(1, clock(1))).toEqual([])
	})

	it("runs the arp continuously, with more notes making a longer sequence at the same speed", () => {
		const effect = new TransformerChordArp({ collect: 0, gate: 50 })
		const output = effect.transform([on(60), on(64)], clock())
		output.push(...effect.tick(0.49, clock(0.49)))
		expect(pitches(output)).toEqual([60, 64, 60, 64])
		// Sixteenth notes at 120 BPM
		expect(times(output)).toEqual([0, 125, 250, 375])
		// Each note is released half a step after it starts.
		expect(offs(output).map((command) => Math.round(command.startAt * 1000))).toEqual([
			63, 188, 313, 438
		])
		output.length = 0
		output.push(...effect.transform([on(67, 0.49)], clock(0.49)))
		output.push(...effect.tick(0.99, clock(0.99)))
		expect(pitches(output)).toEqual([64, 67, 60, 64])
		expect(times(output)).toEqual([500, 625, 750, 875])
	})
	it("stops the arp on release and restarts the next chord from its first note", () => {
		const effect = new TransformerChordArp({ collect: 0 })
		const output = effect.transform([on(60), on(64), on(67)], clock())
		output.push(...effect.tick(0.2, clock(0.2)))
		expect(pitches(output)).toEqual([60, 64])
		output.push(...effect.transform([off(60, 0.21), off(64, 0.21), off(67, 0.21)], clock(0.21)))
		output.push(...effect.tick(1, clock(1)))
		expect(pitches(output)).toEqual([60, 64])
		expect(sounding(output)).toEqual([])
		expect(pitches(effect.transform([on(62, 1.1), on(65, 1.1)], clock(1.1)))).toEqual([62])
	})
	it("plays up and down across two octaves", () => {
		const effect = new TransformerChordArp({ collect: 0, direction: "up-down", octaves: 2 })
		const output = effect.transform([on(60), on(64)], clock())
		output.push(...effect.tick(0.99, clock(0.99)))
		expect(pitches(output)).toEqual([60, 64, 72, 76, 72, 64, 60, 64])
		expect(times(output).slice(0, 3)).toEqual([0, 125, 250])
	})
	it("silences the arp on all notes off", () => {
		const effect = new TransformerChordArp({ collect: 0 })
		const output = effect.transform([on(60), on(64)], clock())
		const panic = Object.assign(command(CONTROL_CHANGE, 123, 0.1), { value: 0 })
		output.push(...effect.transform([panic], clock(0.1)))
		output.push(...effect.tick(2, clock(2)))
		expect(pitches(output)).toEqual([60])
		expect(sounding(output)).toEqual([])
	})

	it("offers thirty patterns, each a whole number of beats of known symbols", () => {
		expect(Object.keys(CHORD_PATTERNS)).toHaveLength(30)
		for (const { steps, perBeat } of Object.values(CHORD_PATTERNS)) {
			expect(steps).toMatch(/^[xXbth1-4.]+$/)
			expect(steps).toMatch(/[^.]/)
			expect(steps.length % perBeat).toBe(0)
		}
		expect(new Set(Object.values(CHORD_PATTERNS).map(({ steps }) => steps)).size).toBe(30)
	})
	it("picks single notes counted from the lowest, wrapping round a smaller chord", () => {
		const effect = new TransformerChordPattern({ collect: 0, pattern: "broken-up" })
		const output = effect.transform([on(60), on(64), on(67)], clock())
		output.push(...effect.tick(1.9, clock(1.9)))
		expect(pitches(output)).toEqual([60, 64, 67, 60, 60, 64, 67, 60])
		const pick = new TransformerChordPattern({ collect: 0, pattern: "fingerpick" })
		const picked = pick.transform([on(60), on(64), on(67), on(71)], clock())
		picked.push(...pick.tick(0.9, clock(0.9)))
		expect(pitches(picked)).toEqual([60, 67, 64, 71])
	})
	it("replays the chord in a rhythm that keeps its place as the chord thickens", () => {
		const effect = new TransformerChordPattern({ collect: 0, pattern: "tresillo", accent: 120 })
		const output = effect.transform([on(60), on(64)], clock())
		output.push(...effect.tick(0.99, clock(0.99)))
		// "X..x..x." on sixteenths at 120 BPM
		expect(times(output)).toEqual([0, 0, 375, 375, 750, 750])
		expect(ons(output).map((command) => command.velocity)).toEqual([
			120, 120, 100, 100, 100, 100
		])
		output.length = 0
		output.push(...effect.transform([on(67, 0.99)], clock(0.99)))
		output.push(...effect.tick(1.4, clock(1.4)))
		expect(pitches(output)).toEqual([60, 64, 67, 60, 64, 67])
		expect(times(output)).toEqual([1000, 1000, 1000, 1375, 1375, 1375])
	})
	it("splits bass and upper notes, and holds each across the rests that follow", () => {
		const effect = new TransformerChordPattern({
			collect: 0,
			pattern: "bass-chord",
			gate: 100
		})
		const output = effect.transform([on(48), on(60), on(64)], clock())
		output.push(...effect.tick(1.1, clock(1.1)))
		expect(pitches(output)).toEqual([48, 60, 64, 48])
		expect(times(output)).toEqual([0, 500, 500, 1000])
		expect(offs(output).map((command) => Math.round(command.startAt * 1000))).toEqual([
			500, 1000, 1000
		])
		output.push(
			...effect.transform([off(48, 1.2), off(60, 1.2), off(64, 1.2)], clock(1.2)),
			...effect.tick(3, clock(3))
		)
		expect(sounding(output)).toEqual([])
	})
	it("falls back to the first pattern when given an unknown one", () => {
		const effect = new TransformerChordPattern({ collect: 0, pattern: "nonsense" })
		expect(pitches(effect.transform([on(60)], clock()))).toEqual([60])
	})
})