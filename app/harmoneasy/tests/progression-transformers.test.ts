// @vitest-environment happy-dom
import { describe, expect, it } from "vitest"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { TransformerProgressionStepper } from "../../../packages/audiobus/io/transformers/transformer-progression-stepper"
import { TransformerHarmonicBridge } from "../../../packages/audiobus/io/transformers/transformer-harmonic-bridge"
import { TransformerCadenceWeaver } from "../../../packages/audiobus/io/transformers/transformer-cadence-weaver"
import { TransformerKeyTraveller } from "../../../packages/audiobus/io/transformers/transformer-key-traveller"
import { TransformerTensionArc } from "../../../packages/audiobus/io/transformers/transformer-tension-arc"
import { TransformerMelodicMediator } from "../../../packages/audiobus/io/transformers/transformer-melodic-mediator"
import { CLASSICAL_CONCEPTS } from "../../../packages/audiobus/tuning/classical-progressions"
import { mod12 } from "../../../packages/audiobus/tuning/pitch-class-set"
import {
	TRANSFORMERS,
	TRANSFORMER_TYPE,
	tranformerFactory
} from "../../../packages/audiobus/io/transformer-factory"
import { TRANSFORMER_DEFINITIONS } from "../../../packages/audiobus/io/transformer-definitions"
import {
	DEFAULT_PRESET_LIBRARY,
	createPresetTransformers
} from "../../../packages/audiobus/io/transformer-presets"
import { parsePresetLibrary } from "../../../packages/audiobus/io/preset-library"
import TransformerManager from "../../../packages/audiobus/io/transformer-manager-worker"
import { TransformerTransposer } from "../../../packages/audiobus/io/transformers/transformer-transposer"
import IOChain from "../../../packages/audiobus/io/IO-chain"
import { createTransformerPicker } from "../source/components/graph/Transformers"
import { createAudioCommand } from "../../../packages/audiobus/audio-command-factory"
import { NOTE_ON, NOTE_OFF, CONTROL_CHANGE } from "../../../packages/audiobus/commands"
import type { IAudioCommand } from "../../../packages/audiobus/audio-command-interface"
import type { PerformanceTransformer } from "../../../packages/audiobus/io/transformers/performance-transformer"

const clock = (now = 0, bpm = 120) => ({ now, bpm, BPM: bpm }) as never
const note = (number = 60, at = 0, channel = 1, from = "keys") =>
	Object.assign(createAudioCommand(NOTE_ON, number, at, from), { channel, velocity: 100 })
const off = (number = 60, at = 0, channel = 1, from = "keys") => ({
	...note(number, at, channel, from),
	type: NOTE_OFF,
	velocity: 0
})
const cc = (number: number, value: number, at = 0, channel = 1, from = "keys") => ({
	...note(number, at, channel, from),
	type: CONTROL_CHANGE,
	value
})
const chord = (pitches: number[], at = 0, channel = 1, from = "keys") =>
	pitches.map((pitch) => note(pitch, at, channel, from))
const ons = (commands: IAudioCommand[]) => commands.filter((command) => command.type === NOTE_ON)
const offs = (commands: IAudioCommand[]) => commands.filter((command) => command.type === NOTE_OFF)
function sounding(effect: PerformanceTransformer) {
	const held = new Map<string, number>()
	return (commands: IAudioCommand[]) => {
		for (const command of commands) {
			const key = `${command.from}:${command.channel}:${command.number}`
			if (command.type === NOTE_ON) held.set(key, (held.get(key) ?? 0) + 1)
			if (command.type === NOTE_OFF) {
				const count = (held.get(key) ?? 0) - 1
				expect(count, `unpaired off ${key} from ${effect.name}`).toBeGreaterThanOrEqual(0)
				if (count) held.set(key, count)
				else held.delete(key)
			}
		}
		return [...held.keys()].map((key) => Number(key.split(":").at(-1))).sort((a, b) => a - b)
	}
}
const classes = (notes: number[]) => [...new Set(notes.map(mod12))].sort((a, b) => a - b)
const types = [
	TRANSFORMER_TYPE.ID_PROGRESSION_STEPPER,
	TRANSFORMER_TYPE.ID_HARMONIC_BRIDGE,
	TRANSFORMER_TYPE.ID_CADENCE_WEAVER,
	TRANSFORMER_TYPE.ID_KEY_TRAVELLER,
	TRANSFORMER_TYPE.ID_TENSION_ARC,
	TRANSFORMER_TYPE.ID_MELODIC_MEDIATOR
]

describe("live progression Transformers", () => {
	it("advances Roman progressions once per collected gesture, not once per chord note", () => {
		const effect = new TransformerProgressionStepper({
			progression: "I vi ii6 V7",
			collect: 25
		})
		const observe = sounding(effect)
		expect(effect.transform(chord([60, 64, 67]), clock())).toEqual([])
		expect(classes(observe(effect.tick(0.026, clock(0.026))))).toEqual([0, 4, 7])
		observe(effect.transform(chord([60, 64, 67], 1), clock(1)))
		expect(classes(observe(effect.tick(1.026, clock(1.026))))).toEqual([0, 4, 9])
	})
	it("plays beat durations, loops only while held, and stops after the last bounded cycle", () => {
		const effect = new TransformerProgressionStepper({
			progression: "I:1 V7:1",
			advance: "beats",
			collect: 0,
			loop: 1,
			common: 0
		})
		const observe = sounding(effect)
		expect(classes(observe(effect.transform([note()], clock())))).toEqual([0, 4, 7])
		expect(classes(observe(effect.tick(0.51, clock(0.51))))).toEqual([2, 5, 7, 11])
		expect(classes(observe(effect.tick(1.01, clock(1.01))))).toEqual([0, 4, 7])
		observe(effect.transform([off(60, 1.1)], clock(1.1)))
		expect(observe(effect.tick(2.01, clock(2.01)))).toEqual([])
		expect(effect.tick(5, clock(5))).toEqual([])
	})
	it("advances only on rising pedal edges and consumes the chosen CC by default", () => {
		const effect = new TransformerProgressionStepper({
			progression: "I vi IV V7",
			advance: "pedal",
			collect: 0
		})
		const observe = sounding(effect)
		expect(classes(observe(effect.transform([note()], clock())))).toEqual([0, 4, 7])
		const next = effect.transform([cc(64, 127, 0.1)], clock(0.1))
		expect(next.some((command) => command.type === CONTROL_CHANGE)).toBe(false)
		expect(classes(observe(next))).toEqual([0, 4, 9])
		expect(effect.transform([cc(64, 100, 0.2)], clock(0.2))).toEqual([])
		expect(effect.transform([cc(64, 0, 0.3)], clock(0.3))).toEqual([])
		expect(classes(observe(effect.transform([cc(64, 127, 0.4)], clock(0.4))))).toEqual([
			0, 5, 9
		])
	})
	it("keeps step positions separate across MIDI channels and sources", () => {
		const effect = new TransformerProgressionStepper({
			progression: "I vi",
			collect: 0,
			common: 0
		})
		effect.transform([note()], clock())
		const result = effect.transform(
			[note(60, 1), note(60, 1, 2), note(60, 1, 1, "other")],
			clock(1)
		)
		expect(
			classes(
				ons(result)
					.filter((command) => command.channel === 1 && command.from === "keys")
					.map((command) => command.number)
			)
		).toEqual([0, 4, 9])
		expect(
			classes(
				ons(result)
					.filter((command) => command.channel === 2)
					.map((command) => command.number)
			)
		).toEqual([0, 4, 7])
		expect(
			classes(
				ons(result)
					.filter((command) => command.from === "other")
					.map((command) => command.number)
			)
		).toEqual([0, 4, 7])
	})
	it("uses shared harmony for Roman transposition and validates progression edits atomically", () => {
		const effect = new TransformerProgressionStepper({
			progression: "I",
			source: "shared",
			collect: 0
		})
		effect.setHarmony({ root: 2, scale: 0, chord: 0 })
		expect(
			classes(ons(effect.transform([note()], clock())).map((command) => command.number))
		).toEqual([2, 6, 9])
		expect(() => effect.setConfig("progression", "I:0 V")).toThrow()
		expect(effect.options.progression).toBe("I")
	})
	it("prepares a chromatic chord destination and arrives at its exact played pitches", () => {
		const effect = new TransformerHarmonicBridge({
			concept: "neapolitan",
			collect: 0,
			step: 0.5,
			finalBeats: 1,
			single: "chord-root"
		})
		const observe = sounding(effect)
		expect(observe(effect.transform(chord([60, 64, 67]), clock()))).toEqual([60, 64, 67])
		const preparation = observe(effect.transform(chord([61, 65, 68], 1), clock(1)))
		expect(classes(preparation)).toEqual([2, 6, 9])
		expect(classes(observe(effect.tick(1.26, clock(1.26))))).toEqual([0, 3, 6, 8])
		expect(observe(effect.tick(1.51, clock(1.51)))).toEqual([61, 65, 68])
		expect(observe(effect.tick(2.01, clock(2.01)))).toEqual([])
	})
	it("preserves an explicitly dissonant destination instead of silently replacing it with a triad", () => {
		const effect = new TransformerHarmonicBridge({
			concept: "authentic",
			collect: 0,
			step: 0.25,
			finalBeats: 1
		})
		const observe = sounding(effect)
		observe(effect.transform(chord([60, 64, 67]), clock()))
		observe(effect.transform(chord([61, 62, 68], 1), clock(1)))
		expect(observe(effect.tick(1.126, clock(1.126)))).toEqual([61, 62, 68])
	})
	it("interrupts a long preparation and never leaks its abandoned destination", () => {
		const effect = new TransformerHarmonicBridge({
			concept: "dominant-chain",
			collect: 0,
			step: 1,
			finalBeats: 1
		})
		const observe = sounding(effect)
		observe(effect.transform(chord([60, 64, 67]), clock()))
		observe(effect.transform(chord([61, 65, 68], 1), clock(1)))
		const next = effect.transform(chord([62, 65, 69], 1.1), clock(1.1))
		observe(next)
		const later = effect.tick(4, clock(4))
		observe(later)
		expect(ons(later).some((command) => command.number === 61)).toBe(false)
		expect(observe([])).toEqual([])
	})
	it("cancels key-gated progressions when the last target key releases, without releasing another route", () => {
		const effect = new TransformerCadenceWeaver({
			cadence: "authentic",
			collect: 0,
			hold: "keys",
			step: 1
		})
		const observe = sounding(effect)
		observe(effect.transform([note(60), note(62, 0, 2)], clock()))
		const released = effect.transform([off(60, 0.1)], clock(0.1))
		expect(offs(released).every((command) => command.channel === 1)).toBe(true)
		observe(released)
		expect(ons(effect.tick(0.51, clock(0.51))).every((command) => command.channel === 2)).toBe(
			true
		)
	})
	it("completes phrase-gated progressions after key release, with a finite final note-off", () => {
		const effect = new TransformerCadenceWeaver({
			cadence: "authentic",
			collect: 0,
			hold: "phrase",
			step: 0.25,
			finalBeats: 1
		})
		const observe = sounding(effect)
		observe(effect.transform([note()], clock()))
		observe(effect.transform([off(60, 0.05)], clock(0.05)))
		expect(classes(observe(effect.tick(0.13, clock(0.13))))).toEqual([0, 4, 7])
		expect(observe(effect.tick(0.63, clock(0.63)))).toEqual([])
	})
	it("keeps common notes sounding through a phrase without extra on/off pairs", () => {
		const effect = new TransformerCadenceWeaver({
			cadence: "plagal",
			collect: 0,
			step: 1,
			finalBeats: 1,
			common: 1,
			arrival: "voice-led",
			lower: 52,
			upper: 72
		})
		const first = effect.transform([note()], clock())
		const before = ons(first).map((command) => command.number)
		const change = effect.tick(0.51, clock(0.51))
		const retained = before.filter(
			(pitch) => !offs(change).some((command) => command.number === pitch)
		)
		expect(retained.length).toBeGreaterThan(0)
		for (const pitch of retained)
			expect(ons(change).some((command) => command.number === pitch)).toBe(false)
	})
	it("produces no partial phrase when classical constraints cannot be satisfied", () => {
		const effect = new TransformerCadenceWeaver({
			collect: 0,
			voicing: "classical",
			lower: 60,
			upper: 61
		})
		expect(effect.transform([note()], clock())).toEqual([])
		expect(effect.status).toContain("No voicing found")
		expect(effect.tick(10, clock(10))).toEqual([])
	})
	it("walks single-note destinations through melodic passing notes", () => {
		const effect = new TransformerMelodicMediator({
			collect: 0,
			approach: "diatonic",
			step: 0.25,
			finalBeats: 1
		})
		const observe = sounding(effect)
		observe(effect.transform([note(60)], clock()))
		const result = [
			...effect.transform([note(67, 1)], clock(1)),
			...effect.tick(1.38, clock(1.38))
		]
		expect(ons(result).map((command) => command.number)).toEqual([62, 64, 65, 67])
		expect(observe(result)).toEqual([67])
	})
	it("balances every generated attack after disabling a phrase, and prevents later ghost notes", () => {
		const effect = new TransformerCadenceWeaver({ collect: 0, cadence: "predominant", step: 1 })
		const observe = sounding(effect)
		observe(effect.transform([note()], clock()))
		effect.setConfig("enabled", "0")
		expect(observe(effect.tick(0.1, clock(0.1)))).toEqual([])
		expect(effect.tick(10, clock(10))).toEqual([])
	})
	it("cancels active and pending phrases on panic and restarts stepping from the first chord", () => {
		const effect = new TransformerProgressionStepper({
			collect: 0,
			progression: "I vi",
			advance: "gesture"
		})
		const observe = sounding(effect)
		observe(effect.transform([note()], clock()))
		expect(observe(effect.transform([cc(123, 0, 0.1)], clock(0.1)))).toEqual([])
		expect(classes(observe(effect.transform([note(60, 1)], clock(1))))).toEqual([0, 4, 7])
	})
	it("offers deterministic phrase arcs and modulation recipes", () => {
		for (const Effect of [TransformerTensionArc, TransformerKeyTraveller]) {
			const effect = new Effect({ collect: 0, step: 0.25, finalBeats: 0.25 })
			const observe = sounding(effect)
			observe(effect.transform([note(60)], clock()))
			observe(effect.tick(3, clock(3)))
			observe(effect.transform([note(67, 4)], clock(4)))
			observe(effect.tick(4.2, clock(4.2)))
			expect(observe(effect.tick(8, clock(8)))).toEqual([])
			effect.destroy()
			expect(effect.tick(9, clock(9))).toEqual([])
		}
	})
	it("drives a generated progression through downstream legacy pitch effects on the chain clock", async () => {
		const timer = { now: 0, bpm: 120, BPM: 120 }
		const chain = new IOChain(timer as never)
		try {
			chain.setTransformers([
				new TransformerProgressionStepper({
					progression: "I:1 V7:1",
					advance: "beats",
					collect: 0
				}),
				new TransformerTransposer({ distance: 12 })
			])
			await chain.addCommandToQueue(note())
			const first = chain.updateTimeForCommandQueue(0, 0, {})
			expect(ons(first).every((command) => command.number >= 52)).toBe(true)
			timer.now = 0.51
			expect(ons(chain.updateTimeForCommandQueue(timer.now, 0, {})).length).toBeGreaterThan(0)
			chain.clearNoteCommands()
			expect(chain.updateTimeForCommandQueue(10, 0, {})).toEqual([])
		} finally {
			chain.destroy()
		}
	})
	it("round-trips all types with normalized UI settings", () => {
		const manager = new TransformerManager(types.map((type) => tranformerFactory(type)))
		const restored = new TransformerManager([])
		try {
			restored.importConfig(manager.exportConfig())
			expect(
				restored.activeTransformers.map((effect) => JSON.parse(effect.exportConfig()).type)
			).toEqual(types)
			for (const effect of restored.activeTransformers) {
				effect.setConfig("step", "0.5")
				expect(effect.options.step).toBe(0.5)
				effect.destroy()
				expect(effect.tick?.(10, clock(10))).toEqual([])
			}
		} finally {
			manager.destroy()
			restored.destroy()
		}
	})
	it("makes every type and theory recipe discoverable with an icon and validated preset", () => {
		const chain = new IOChain(clock())
		chain.setTransformers([])
		const picker = createTransformerPicker({ chain } as never)
		try {
			const library = parsePresetLibrary(JSON.stringify(DEFAULT_PRESET_LIBRARY))
			for (const type of types) {
				expect(TRANSFORMERS).toContain(type)
				const definition = TRANSFORMER_DEFINITIONS[type]
				expect(existsSync(resolve("public", definition.icon.slice(1)))).toBe(true)
				expect(
					[...picker.element.querySelectorAll("button")].some(
						(button) => button.textContent === definition.name
					)
				).toBe(true)
			}
			for (const concept of CLASSICAL_CONCEPTS) {
				const preset = library.presets.find(
					(preset) => preset.id === `classical-${concept.id}`
				)!
				expect(preset).toBeDefined()
				for (const effect of createPresetTransformers(preset)) effect.destroy()
			}
		} finally {
			picker.destroy()
			chain.destroy()
		}
	})
})