// @vitest-environment happy-dom
import { describe, expect, it } from "vitest"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { TransformerChordBloom } from "../../../packages/audiobus/io/transformers/transformer-chord-bloom"
import { TransformerMelodyShadow } from "../../../packages/audiobus/io/transformers/transformer-melody-shadow"
import { TransformerContourDynamics } from "../../../packages/audiobus/io/transformers/transformer-contour-dynamics"
import { TransformerRhythmWeave } from "../../../packages/audiobus/io/transformers/transformer-rhythm-weave"
import { TransformerRegisterOrbit } from "../../../packages/audiobus/io/transformers/transformer-register-orbit"
import { TransformerTransposer } from "../../../packages/audiobus/io/transformers/transformer-transposer"
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
import { createAudioCommand } from "../../../packages/audiobus/audio-command-factory"
import { createTransformerPicker } from "../source/components/graph/Transformers"
import IOChain from "../../../packages/audiobus/io/IO-chain"
import { NOTE_ON, NOTE_OFF, CONTROL_CHANGE } from "../../../packages/audiobus/commands"
import type { IAudioCommand } from "../../../packages/audiobus/audio-command-interface"

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
	TRANSFORMER_TYPE.ID_CHORD_BLOOM,
	TRANSFORMER_TYPE.ID_MELODY_SHADOW,
	TRANSFORMER_TYPE.ID_CONTOUR_DYNAMICS,
	TRANSFORMER_TYPE.ID_RHYTHM_WEAVE,
	TRANSFORMER_TYPE.ID_REGISTER_ORBIT
]

describe("invented musical Transformers", () => {
	it("keeps bloom releases correct through a mutating legacy effect, including notes flushed by controllers", async () => {
		const bloom = new TransformerChordBloom({ intervals: "0, 12", step: 0.5 })
		const manager = new TransformerManager([bloom, new TransformerTransposer({ distance: 12 })])
		try {
			expect(ons(await manager.transform([note()], clock()))[0].number).toBe(72)
			const control = { ...note(1, 0.26), type: CONTROL_CHANGE, value: 64 }
			const flushed = manager.transformMidiControls([control], clock(0.26))
			expect(ons(flushed).map((command) => command.number)).toEqual([84])
			expect(flushed.filter((command) => command.type === CONTROL_CHANGE)).toEqual([control])
			expect(
				offs(await manager.transform([off(60, 0.5)], clock(0.5))).map(
					(command) => command.number
				)
			).toEqual([72, 84])
			bloom.setConfig("enabled", 0)
			expect(manager.advanceTime(1, clock(1))).toEqual([])
		} finally {
			manager.destroy()
		}
	})
	it("grows one sustained chord voice per beat division and releases the complete bloom", () => {
		const effect = new TransformerChordBloom({ step: 0.5, falloff: 0 })
		const result = [
			...effect.transform([note(60, 0, 4)], clock()),
			...effect.tick(0.76, clock(0.76))
		]
		expect(result.map((command) => [command.number, command.startAt])).toEqual([
			[60, 0],
			[67, 0.25],
			[72, 0.5],
			[79, 0.75]
		])
		expect(
			offs(effect.transform([off(60, 1, 4)], clock(1))).map((command) => [
				command.number,
				command.channel
			])
		).toEqual([
			[60, 4],
			[67, 4],
			[72, 4],
			[79, 4]
		])
		expect(effect.tick(10, clock(10))).toEqual([])
	})
	it("cancels unheard bloom voices on early release and follows the selected tempo", () => {
		const effect = new TransformerChordBloom({ intervals: "0, 12, 24", step: 0.5 })
		effect.transform([note()], clock(0, 60))
		expect(effect.tick(0.49, clock(0.49, 60))).toEqual([])
		expect(ons(effect.tick(0.51, clock(0.51, 60)))[0].number).toBe(72)
		expect(offs(effect.transform([off(60, 0.6)], clock(0.6, 60)))).toHaveLength(2)
		expect(effect.tick(5, clock(5, 60))).toEqual([])
	})
	it("snapshots a bloom's intervals and keeps overlapping generated releases balanced on disable", () => {
		const effect = new TransformerChordBloom({ intervals: "0, 7", step: 0.25 })
		effect.transform([note(60), note(67)], clock())
		effect.setConfig("intervals", "0, 12")
		expect(ons(effect.tick(0.13, clock(0.13))).map((command) => command.number)).toEqual([
			67, 74
		])
		effect.setConfig("enabled", "0")
		expect(
			offs(effect.tick(0.2, clock(0.2)))
				.map((command) => command.number)
				.sort()
		).toEqual([60, 67, 67, 74])
		expect(effect.tick(5, clock(5))).toEqual([])
	})
	it("rejects invalid bloom maps without replacing the previous settings and skips invalid MIDI pitches", () => {
		const effect = new TransformerChordBloom({ intervals: "0, 12" })
		expect(() => effect.setConfig("intervals", "0, 49")).toThrow()
		expect(effect.options.intervals).toBe("0, 12")
		expect(
			ons(effect.transform([note(125)], clock())).map((command) => command.number)
		).toEqual([125])
		expect(effect.tick(1, clock(1))).toEqual([])
	})
	it("reuses earlier pitches at new attack times and follows the current key's release", () => {
		const effect = new TransformerMelodyShadow({ lag: 2, transpose: -12, level: 70 })
		effect.transform([note(60), off(60, 0.1)], clock(0.1))
		effect.transform([note(64, 0.2), off(64, 0.3)], clock(0.3))
		const result = effect.transform([note(67, 1)], clock(1))
		expect(
			ons(result).map((command) => [command.number, command.velocity, command.startAt])
		).toEqual([
			[67, 100, 1],
			[48, 70, 1]
		])
		effect.setConfig("transpose", 12)
		expect(
			offs(effect.transform([off(67, 2)], clock(2))).map((command) => command.number)
		).toEqual([67, 48])
	})
	it("supports shadow-only warmup and avoids duplicate dry/shadow pitches", () => {
		const shadow = new TransformerMelodyShadow({ lag: 1, transpose: 0, dry: 0 })
		expect(shadow.transform([note(), off(60, 0.1)], clock(0.1))).toEqual([])
		expect(ons(shadow.transform([note(64, 1)], clock(1)))[0].number).toBe(60)
		const dry = new TransformerMelodyShadow({ lag: 1, transpose: 0, dry: 1 })
		dry.transform([note(), off(60, 0.1)], clock(0.1))
		expect(ons(dry.transform([note(60, 1)], clock(1)))).toHaveLength(1)
	})
	it("keeps shadow histories separate for sources and channels and clears only the panicked route", () => {
		const effect = new TransformerMelodyShadow({ lag: 1, transpose: 0, dry: 0 })
		effect.transform([note(60), note(64, 0, 2), note(67, 0, 1, "other")], clock())
		effect.transform([panic(0.1)], clock(0.1))
		const result = effect.transform(
			[note(62, 1), note(65, 1, 2), note(69, 1, 1, "other")],
			clock(1)
		)
		expect(
			ons(result).map((command) => [command.number, command.channel, command.from])
		).toEqual([
			[64, 2, "keys"],
			[67, 1, "other"]
		])
		effect.reset()
		expect(effect.transform([note(72, 2)], clock(2))).toEqual([])
	})
	it("bounds shadow memory and can recall eight attacks back", () => {
		const effect = new TransformerMelodyShadow({ lag: 8, dry: 0, transpose: 0 })
		for (let i = 0; i < 40; i++) {
			const result = ons(
				effect.transform([note(48 + i, i), off(48 + i, i + 0.1)], clock(i + 0.1))
			)
			expect(result.map((command) => command.number)).toEqual(i < 8 ? [] : [40 + i])
		}
	})
	it("shapes rising, falling and repeated notes and adds proportional leap emphasis", () => {
		const effect = new TransformerContourDynamics({
			rising: 120,
			falling: 80,
			repeated: 95,
			leap: 10
		})
		const result = effect.transform(
			[
				note(60, 0, 1, "keys", 50),
				note(72, 0.1, 1, "keys", 50),
				note(66, 0.2, 1, "keys", 50),
				note(66, 0.3, 1, "keys", 50)
			],
			clock(0.3)
		)
		expect(ons(result).map((command) => command.velocity)).toEqual([50, 65, 43, 48])
		expect(
			offs(effect.transform([off(60, 1), off(72, 1), off(66, 1), off(66, 1)], clock(1)))
		).toHaveLength(4)
	})
	it("forgets contour after a tempo-relative gap and keeps routes independent", () => {
		const effect = new TransformerContourDynamics({ gap: 1 })
		effect.transform([note(60)], clock())
		expect(ons(effect.transform([note(72, 0.1, 2, "keys", 50)], clock(0.1)))[0].velocity).toBe(
			50
		)
		expect(ons(effect.transform([note(72, 0.6, 1, "keys", 50)], clock(0.6)))[0].velocity).toBe(
			50
		)
		effect.transform([panic(0.7)], clock(0.7))
		expect(ons(effect.transform([note(84, 0.8, 1, "keys", 50)], clock(0.8)))[0].velocity).toBe(
			50
		)
	})
	it("weaves two gesture cycles and accents their meetings", () => {
		const effect = new TransformerRhythmWeave({ cycleA: 3, cycleB: 5, collect: 0 })
		const played: number[] = [],
			velocities: number[] = []
		for (let i = 0; i < 16; i++) {
			const result = ons(
				effect.transform([note(60, i, 1, "keys", 50), off(60, i + 0.1)], clock(i + 0.1))
			)
			if (result.length) {
				played.push(i)
				velocities.push(result[0].velocity)
			}
		}
		expect(played).toEqual([0, 3, 5, 6, 9, 10, 12, 15])
		expect(velocities).toEqual([60, 40, 40, 40, 40, 40, 40, 60])
	})
	it.each([
		["intersection", [0, 6]],
		["exclusive", [2, 3, 4]]
	])("supports the %s weave rule", (mode, expected) => {
		const effect = new TransformerRhythmWeave({
			cycleA: 2,
			cycleB: 3,
			mode: String(mode),
			collect: 0
		})
		const played = Array.from({ length: 7 }, (_, i) =>
			ons(effect.transform([note(60, i), off(60, i + 0.1)], clock(i + 0.1))).length ? i : -1
		).filter((i) => i >= 0)
		expect(played).toEqual(expected)
	})
	it("keeps chord notes on one weave decision and suppresses every matching filtered release", () => {
		const effect = new TransformerRhythmWeave({ cycleA: 2, cycleB: 2, collect: 25 })
		expect(
			ons(effect.transform([note(60), note(64, 0.01), note(67, 0.02)], clock(0.02)))
		).toHaveLength(3)
		expect(
			offs(effect.transform([off(60, 0.2), off(64, 0.2), off(67, 0.2)], clock(0.2)))
		).toHaveLength(3)
		expect(
			effect.transform(
				[
					note(60, 1),
					note(64, 1.01),
					note(67, 1.02),
					off(60, 1.2),
					off(64, 1.2),
					off(67, 1.2)
				],
				clock(1.2)
			)
		).toEqual([])
		expect(ons(effect.transform([note(60, 2)], clock(2)))).toHaveLength(1)
	})
	it("applies independent weave offsets and resets the gesture phase on panic", () => {
		const effect = new TransformerRhythmWeave({
			cycleA: 3,
			cycleB: 5,
			offsetA: 1,
			offsetB: 2,
			collect: 0
		})
		const played = Array.from({ length: 8 }, (_, i) =>
			ons(effect.transform([note(60, i), off(60, i + 0.1)], clock(i + 0.1))).length ? i : -1
		).filter((i) => i >= 0)
		expect(played).toEqual([1, 2, 4, 7])
		effect.transform([panic(9)], clock(9))
		expect(effect.transform([note(60, 10), off(60, 10.1)], clock(10.1))).toEqual([])
	})
	it("orbits octaves while preserving every pitch class and the configured register", () => {
		const effect = new TransformerRegisterOrbit({
			lower: 48,
			upper: 84,
			stride: 12,
			collect: 0
		})
		const pitches = Array.from(
			{ length: 5 },
			(_, i) =>
				ons(effect.transform([note(60, i), off(60, i + 0.1)], clock(i + 0.1)))[0].number
		)
		expect(pitches).toEqual([48, 60, 72, 84, 60])
		expect(pitches.every((pitch) => pitch % 12 === 0 && pitch >= 48 && pitch <= 84)).toBe(true)
	})
	it("supports reverse orbits, reversed bounds and silent pitch classes in a narrow register", () => {
		const effect = new TransformerRegisterOrbit({
			lower: 84,
			upper: 48,
			stride: -12,
			collect: 0
		})
		expect(ons(effect.transform([note()], clock()))[0].number).toBe(48)
		expect(ons(effect.transform([note(60, 1)], clock(1)))[0].number).toBe(72)
		const narrow = new TransformerRegisterOrbit({ lower: 60, upper: 61 })
		expect(narrow.transform([note(62), off(62, 0.1)], clock(0.1))).toEqual([])
	})
	it("shares an orbit target for chord gestures, keeps routes independent and releases mapped octaves", () => {
		const effect = new TransformerRegisterOrbit({ lower: 48, upper: 84, stride: 12 })
		expect(
			ons(effect.transform([note(60), note(64, 0.01), note(67, 0.02)], clock(0.02))).map(
				(command) => command.number
			)
		).toEqual([48, 52, 55])
		effect.setConfig("lower", 72)
		effect.setConfig("upper", 96)
		expect(
			offs(effect.transform([off(60, 0.1), off(64, 0.1), off(67, 0.1)], clock(0.1))).map(
				(command) => command.number
			)
		).toEqual([48, 52, 55])
		expect(ons(effect.transform([note(60, 1, 2)], clock(1)))[0].number).toBe(72)
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
	it("makes every invented type selectable with an icon and a portable factory preset", () => {
		const chain = new IOChain(clock())
		chain.setTransformers([])
		const picker = createTransformerPicker({ chain } as never)
		try {
			const library = parsePresetLibrary(JSON.stringify(DEFAULT_PRESET_LIBRARY))
			for (const type of types) {
				expect(TRANSFORMERS).toContain(type)
				const definition = TRANSFORMER_DEFINITIONS[type]
				expect(
					[...picker.element.querySelectorAll("button")].some(
						(button) => button.textContent === definition.name
					)
				).toBe(true)
				expect(existsSync(resolve("public", definition.icon.slice(1)))).toBe(true)
				const preset = library.presets.find((preset) =>
					preset.steps.some((step) => step.type === type)
				)!
				expect(preset).toBeDefined()
				for (const effect of createPresetTransformers(preset)) effect.destroy()
			}
		} finally {
			picker.destroy()
			chain.destroy()
		}
	})
	it("advances blooms through downstream effects from the chain clock and cancels them on transport clear", async () => {
		const timer = { now: 0, bpm: 120, BPM: 120 }
		const chain = new IOChain(timer as never)
		try {
			chain.setTransformers([
				new TransformerChordBloom({ intervals: "0, 12", step: 0.5 }),
				new TransformerContourDynamics({ rising: 100, leap: 0 })
			])
			await chain.addCommandToQueue(note())
			expect(ons(chain.updateTimeForCommandQueue(0, 0, {}))[0].number).toBe(60)
			timer.now = 0.26
			expect(ons(chain.updateTimeForCommandQueue(timer.now, 0, {}))[0].number).toBe(72)
			chain.clearNoteCommands()
			expect(chain.updateTimeForCommandQueue(10, 0, {})).toEqual([])
		} finally {
			chain.destroy()
		}
	})
})