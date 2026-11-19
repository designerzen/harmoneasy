// @vitest-environment happy-dom
import { describe, expect, it } from "vitest"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import {
	TransformerRandomSampler,
	DejaVuSequence,
	allowedDegrees,
	nearestDegree,
	randomStream,
	sampleDistribution
} from "../../../packages/audiobus/io/transformers/transformer-random-sampler"
import {
	TransformerTopographicDrums,
	TOPOGRAPHIC_MAP,
	TOPOGRAPHIC_STEPS,
	topographicLevel
} from "../../../packages/audiobus/io/transformers/transformer-topographic-drums"
import { TransformerBernoulliGate } from "../../../packages/audiobus/io/transformers/transformer-bernoulli-gate"
import {
	TRANSFORMER_TYPE,
	TRANSFORMERS,
	tranformerFactory
} from "../../../packages/audiobus/io/transformer-factory"
import { TRANSFORMER_DEFINITIONS } from "../../../packages/audiobus/io/transformer-definitions"
import TransformerManager from "../../../packages/audiobus/io/transformer-manager-worker"
import {
	DEFAULT_PRESET_LIBRARY,
	createPresetTransformers
} from "../../../packages/audiobus/io/transformer-presets"
import { parsePresetLibrary } from "../../../packages/audiobus/io/preset-library"
import { createAudioCommand } from "../../../packages/audiobus/commands/audio-command-factory"
import { NOTE_ON, NOTE_OFF, CONTROL_CHANGE } from "../../../packages/audiobus/commands/commands"
import type { IAudioCommand } from "../../../packages/audiobus/commands/audio-command-interface"

const clock = (now = 0, bpm = 120) => ({ now, bpm, BPM: bpm }) as never
const note = (number = 60, at = 0, channel = 1, from = "keys", velocity = 100) =>
	Object.assign(createAudioCommand(NOTE_ON, number, at, from), { channel, velocity })
const off = (number = 60, at = 0, channel = 1, from = "keys") => ({
	...note(number, at, channel, from, 0),
	type: NOTE_OFF
})
const panic = (at = 0, channel = 1, from = "keys") => ({
	...note(123, at, channel, from),
	type: CONTROL_CHANGE,
	value: 0
})
const ons = (commands: IAudioCommand[]) => commands.filter((command) => command.type === NOTE_ON)
const offs = (commands: IAudioCommand[]) => commands.filter((command) => command.type === NOTE_OFF)
const types = [
	TRANSFORMER_TYPE.ID_RANDOM_SAMPLER,
	TRANSFORMER_TYPE.ID_TOPOGRAPHIC_DRUMS,
	TRANSFORMER_TYPE.ID_BERNOULLI_GATE
]

describe("Mutable Instruments inspired Transformers", () => {
	it("locks, evolves and shuffles Déjà vu loops like Marbles", () => {
		const take = (dejaVu: number, count = 16) => {
			const sequence = new DejaVuSequence(randomStream(3))
			sequence.reset(4)
			return Array.from({ length: count }, () => sequence.next(dejaVu, 4))
		}
		const locked = take(0.5)
		expect(locked.slice(4, 8)).toEqual(locked.slice(0, 4))
		expect(locked.slice(12)).toEqual(locked.slice(0, 4))
		expect(new Set(take(0)).size).toBe(16)
		const shuffled = take(1, 32)
		expect(new Set(shuffled).size).toBeLessThanOrEqual(4)
	})
	it("shapes the pitch distribution with spread and bias and quantises by steps", () => {
		expect(sampleDistribution(0.9, 0, 0.5)).toBeCloseTo(0.5, 2)
		expect(sampleDistribution(0.25, 0.5, 0.5)).toBeCloseTo(0.25)
		expect(sampleDistribution(0.6, 1, 0.5)).toBeGreaterThan(0.9)
		expect(sampleDistribution(0.5, 0.5, 0.8)).toBeCloseTo(0.8)
		const major = [0, 2, 4, 5, 7, 9, 11]
		expect(allowedDegrees(major, 0)).toHaveLength(12)
		expect(allowedDegrees(major, 50).sort((a, b) => a - b)).toEqual(major)
		expect(allowedDegrees(major, 100)).toEqual([0])
		expect(allowedDegrees(major, 85)).toEqual([0, 7, 4])
		expect(nearestDegree(61, 60, [0, 7, 4])).toBe(60)
		expect(nearestDegree(66.4, 60, [0, 7, 4])).toBe(67)
	})
	it("samples in-scale pitches around a held note on a tempo grid and stops on release", () => {
		const effect = new TransformerRandomSampler({
			probability: 100,
			steps: 50,
			scale: "Major pentatonic",
			range: 2,
			rate: 0.25
		})
		const result = [
			...effect.transform([note(62, 0, 3)], clock()),
			...effect.tick(1.99, clock(1.99))
		]
		const played = ons(result)
		expect(played.map((command) => command.startAt)).toEqual(
			Array.from({ length: 16 }, (_, i) => i * 0.125)
		)
		for (const command of played) {
			expect([0, 2, 4, 7, 9]).toContain((((command.number - 62) % 12) + 12) % 12)
			expect(Math.abs(command.number - 62)).toBeLessThanOrEqual(12)
			expect(command.channel).toBe(3)
		}
		expect(new Set(played.map((command) => command.number)).size).toBeGreaterThan(1)
		const released = effect.transform([off(62, 2, 3)], clock(2))
		expect(offs([...result, ...released])).toHaveLength(ons([...result, ...released]).length)
		expect(ons(effect.tick(4, clock(4)))).toEqual([])
	})
	it("repeats the same melody for the same seed and silences gates at zero probability", () => {
		const run = (config = {}) => {
			const effect = new TransformerRandomSampler({ probability: 100, ...config })
			return ons([...effect.transform([note()], clock()), ...effect.tick(2, clock(2))]).map(
				(command) => command.number
			)
		}
		expect(run()).toEqual(run())
		expect(run({ seed: 9 })).not.toEqual(run())
		expect(run({ probability: 0 })).toEqual([])
		expect(run({ model: "drums", probability: 50 }).length).toBeGreaterThan(0)
		expect(run({ model: "markov", probability: 20 }).length).toBeGreaterThan(0)
	})
	it("reads a topographic map whose corners are its authored patterns", () => {
		for (const row of TOPOGRAPHIC_MAP)
			for (const node of row)
				for (const lane of node) expect(lane).toMatch(new RegExp(`^\\d{${TOPOGRAPHIC_STEPS}}$`))
		expect(topographicLevel(0, 0, 0, 0)).toBe(255)
		expect(topographicLevel(0.5, 0, 0, 4)).toBe(255)
		expect(topographicLevel(0.25, 0, 0, 4)).toBeCloseTo(255 / 2)
		expect(topographicLevel(1, 1, 2, 31)).toBe(255)
	})
	it("plays kick, snare and hats on the drum channel while held and hands over to other held notes", () => {
		const effect = new TransformerTopographicDrums({
			mapX: 50,
			mapY: 0,
			kickDensity: 50,
			snareDensity: 50,
			hatDensity: 0
		})
		const first = [
			...effect.transform([note(60), note(64)], clock()),
			...effect.tick(1.99, clock(1.99))
		]
		const hits = ons(first)
		expect(hits.every((command) => command.channel === 10)).toBe(true)
		expect(
			hits.filter((command) => command.number === 36).map((command) => command.startAt)
		).toEqual([0, 0.5, 1, 1.5])
		expect(
			hits.filter((command) => command.number === 38).map((command) => command.startAt)
		).toEqual([0.5, 1.5])
		expect(hits.some((command) => command.number === 42)).toBe(false)
		const handover = [
			...effect.transform([off(60, 2)], clock(2)),
			...effect.tick(2.01, clock(2.01))
		]
		expect(ons(handover).map((command) => command.number)).toEqual([36])
		effect.transform([off(64, 2.1)], clock(2.1))
		expect(ons(effect.tick(4, clock(4)))).toEqual([])
		const input = effect.transform([note(60, 5, 2)], clock(5))
		expect(ons(input)[0].channel).toBe(10)
		expect(offs(effect.transform([panic(5.1, 2)], clock(5.1))).length).toBeGreaterThan(0)
		expect(ons(effect.tick(7, clock(7)))).toEqual([])
	})
	it("routes whole chords to channel A or B by coin toss, toggles and can silence B", () => {
		const effect = new TransformerBernoulliGate({ probability: 50, channelA: 1, channelB: 2 })
		const channels: number[] = []
		for (let i = 0; i < 32; i++) {
			const chord = ons(effect.transform([note(60, i), note(64, i)], clock(i)))
			expect(chord[0].channel).toBe(chord[1].channel)
			channels.push(chord[0].channel)
			const released = effect.transform([off(60, i + 0.5), off(64, i + 0.5)], clock(i + 0.5))
			expect(released.map((command) => command.channel)).toEqual([
				chord[0].channel,
				chord[0].channel
			])
		}
		expect(new Set(channels)).toEqual(new Set([1, 2]))
		const toggle = new TransformerBernoulliGate({ probability: 100, mode: "toggle", channelB: 5 })
		expect(
			[0, 1, 2, 3].map((i) => ons(toggle.transform([note(60, i, 3)], clock(i)))[0].channel)
		).toEqual([5, 3, 5, 3])
		const mute = new TransformerBernoulliGate({ probability: 100, muteB: 1 })
		expect(mute.transform([note()], clock())).toEqual([])
		expect(mute.transform([off(60, 1)], clock(1))).toEqual([])
	})
	it("saves and restores all new types, accepts numeric UI strings and destroys scheduled work", () => {
		const manager = new TransformerManager(types.map((type) => tranformerFactory(type)))
		const restored = new TransformerManager([])
		try {
			restored.importConfig(manager.exportConfig())
			expect(
				restored.activeTransformers.map((effect) => JSON.parse(effect.exportConfig()).type)
			).toEqual(types)
			for (const effect of restored.activeTransformers) {
				for (const field of effect.fields)
					if (typeof effect.options[field.name] === "number") {
						effect.setConfig(field.name, String(effect.options[field.name]))
						expect(typeof effect.options[field.name]).toBe("number")
					}
				effect.setConfig("enabled", "0")
				const input = note()
				expect(effect.transform([input], clock())).toEqual([input])
				effect.setConfig("enabled", "1")
				effect.transform([note()], clock())
				effect.destroy()
				expect(effect.tick?.(10, clock(10))).toEqual([])
			}
		} finally {
			manager.destroy()
			restored.destroy()
		}
	})
	it("registers every new type with an icon and a portable factory preset", () => {
		const library = parsePresetLibrary(JSON.stringify(DEFAULT_PRESET_LIBRARY))
		for (const type of types) {
			expect(TRANSFORMERS).toContain(type)
			const definition = TRANSFORMER_DEFINITIONS[type]
			expect(definition.name).toBe(tranformerFactory(type).name)
			expect(existsSync(resolve("public", definition.icon.slice(1)))).toBe(true)
			const preset = library.presets.find((preset) =>
				preset.steps.some((step) => step.type === type)
			)!
			expect(preset).toBeDefined()
			for (const effect of createPresetTransformers(preset)) effect.destroy()
		}
	})
})
