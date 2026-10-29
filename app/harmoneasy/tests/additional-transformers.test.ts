// @vitest-environment happy-dom
import { describe, expect, it } from "vitest"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { TransformerPitchMirror } from "../../../packages/audiobus/io/transformers/transformer-pitch-mirror"
import {
	TransformerIntervalStack,
	parseIntervals
} from "../../../packages/audiobus/io/transformers/transformer-interval-stack"
import { TransformerNoteBouncer } from "../../../packages/audiobus/io/transformers/transformer-note-bouncer"
import { TransformerReleaseTrigger } from "../../../packages/audiobus/io/transformers/transformer-release-trigger"
import { TransformerPolyphonyLimiter } from "../../../packages/audiobus/io/transformers/transformer-polyphony-limiter"
import { TransformerNoteRouter } from "../../../packages/audiobus/io/transformers/transformer-note-router"
import { TransformerChannelAllocator } from "../../../packages/audiobus/io/transformers/transformer-channel-allocator"
import { TransformerCCStepper } from "../../../packages/audiobus/io/transformers/transformer-cc-stepper"
import {
	TRANSFORMER_TYPE,
	TRANSFORMERS,
	tranformerFactory
} from "../../../packages/audiobus/io/transformer-factory"
import { TRANSFORMER_DEFINITIONS } from "../../../packages/audiobus/io/transformer-definitions"
import TransformerManager from "../../../packages/audiobus/io/transformer-manager-worker"
import { parsePresetLibrary } from "../../../packages/audiobus/io/preset-library"
import {
	DEFAULT_PRESET_LIBRARY,
	createPresetTransformers
} from "../../../packages/audiobus/io/transformer-presets"
import IOChain from "../../../packages/audiobus/io/IO-chain"
import { createTransformerPicker } from "../source/components/graph/Transformers"
import { createAudioCommand } from "../../../packages/audiobus/audio-command-factory"
import { commandToMidi } from "../../../packages/audiobus/midi/midi-command-conversion"
import {
	NOTE_ON,
	NOTE_OFF,
	CONTROL_CHANGE,
	PITCH_BEND,
	MIDI_CLOCK
} from "../../../packages/audiobus/commands"
import type { IAudioCommand } from "../../../packages/audiobus/audio-command-interface"

const clock = (now = 0, bpm = 120) => ({ now, bpm, BPM: bpm }) as never
const note = (number = 60, at = 0, channel = 1, from = "keyboard", velocity = 100) =>
	Object.assign(createAudioCommand(NOTE_ON, number, at, from), { channel, velocity })
const off = (number = 60, at = 0, channel = 1, from = "keyboard", velocity = 0) => ({
	...note(number, at, channel, from, velocity),
	type: NOTE_OFF
})
const cc = (number = 1, value = 64, at = 0, channel = 1, from = "keyboard") => ({
	...note(number, at, channel, from),
	type: CONTROL_CHANGE,
	value
})
const ons = (commands: IAudioCommand[]) => commands.filter((command) => command.type === NOTE_ON)
const offs = (commands: IAudioCommand[]) => commands.filter((command) => command.type === NOTE_OFF)
const types = [
	TRANSFORMER_TYPE.ID_PITCH_MIRROR,
	TRANSFORMER_TYPE.ID_INTERVAL_STACK,
	TRANSFORMER_TYPE.ID_NOTE_BOUNCER,
	TRANSFORMER_TYPE.ID_RELEASE_TRIGGER,
	TRANSFORMER_TYPE.ID_POLYPHONY_LIMITER,
	TRANSFORMER_TYPE.ID_NOTE_ROUTER,
	TRANSFORMER_TYPE.ID_CHANNEL_ALLOCATOR,
	TRANSFORMER_TYPE.ID_CC_STEPPER
]

describe("additional live MIDI Transformers", () => {
	it("mirrors pitches and retains attack-time mappings across setting changes", () => {
		const effect = new TransformerPitchMirror({ centre: 60 })
		expect(ons(effect.transform([note(67, 0, 3)], clock()))[0]).toMatchObject({
			number: 53,
			channel: 3
		})
		effect.setConfig("centre", "72")
		expect(offs(effect.transform([off(67, 1, 3)], clock(1)))[0].number).toBe(53)
		expect(ons(effect.transform([note(72, 2)], clock(2)))[0].number).toBe(72)
	})
	it("blocks out-of-range mirror pitches or folds them by octaves", () => {
		const effect = new TransformerPitchMirror({ centre: 0 })
		expect(effect.transform([note(127)], clock())).toEqual([])
		expect(effect.transform([off(127)], clock())).toEqual([])
		effect.setConfig("outside", "octave-fold")
		const pitch = ons(effect.transform([note(127)], clock()))[0].number
		expect(pitch).toBe(5)
	})
	it("stacks custom intervals with velocity falloff and unchanged source commands", () => {
		const effect = new TransformerIntervalStack({ intervals: "-12, 0, 7, 12", falloff: 20 })
		const input = note(60, 0, 4)
		expect(effect.transform([input], clock()).map(commandToMidi)).toEqual([
			[0x93, 48, 100],
			[0x93, 60, 80],
			[0x93, 67, 64],
			[0x93, 72, 51]
		])
		expect(input.number).toBe(60)
		effect.setConfig("intervals", "0, 3, 7")
		expect(
			offs(effect.transform([off(60, 1, 4)], clock(1))).map((command) => command.number)
		).toEqual([48, 60, 67, 72])
	})
	it("validates interval maps atomically, removes duplicates and skips invalid MIDI pitches", () => {
		const effect = new TransformerIntervalStack({ intervals: "0, +7, 7, 12" })
		for (const text of ["", "a", "1.5", "49", "0,1,2,3,4,5,6,7,8"]) {
			expect(() => effect.setConfig("intervals", text)).toThrow()
		}
		expect(effect.options.intervals).toBe("0, +7, 7, 12")
		expect(parseIntervals("0; -12 +7")).toEqual([0, -12, 7])
		expect(
			ons(effect.transform([note(125)], clock())).map((command) => command.number)
		).toEqual([125])
	})
	it("balances every overlapping generated attack when disabled", () => {
		const effect = new TransformerIntervalStack({ intervals: "0,7" })
		const attacks = ons(effect.transform([note(60), note(67)], clock()))
		expect(attacks.map((command) => command.number)).toEqual([60, 67, 67, 74])
		effect.setConfig("enabled", 0)
		expect(
			offs(effect.tick(0.1, clock(0.1)))
				.map((command) => command.number)
				.sort()
		).toEqual([60, 67, 67, 74])
		expect(effect.transform([off(60, 0.2), off(67, 0.2)], clock(0.2))).toEqual([])
	})
	it("bounces at accelerating intervals with decaying velocity and a finite ending", () => {
		const effect = new TransformerNoteBouncer({
			beats: 1,
			damping: 50,
			decay: 50,
			count: 4,
			minimum: 10,
			gate: 50
		})
		const result = [...effect.transform([note()], clock()), ...effect.tick(2, clock(2))]
		expect(ons(result).map((command) => [command.startAt, command.velocity])).toEqual([
			[0, 100],
			[0.5, 50],
			[0.75, 25],
			[0.875, 13]
		])
		expect(offs(result)).toHaveLength(4)
		expect(effect.tick(10, clock(10))).toEqual([])
	})
	it("cancels bounces on key release, or allows a finite tail when configured", () => {
		const effect = new TransformerNoteBouncer({ count: 3 })
		effect.transform([note()], clock())
		expect(offs(effect.transform([off(60, 0.1)], clock(0.1)))).toHaveLength(1)
		expect(effect.tick(3, clock(3))).toEqual([])
		const tail = new TransformerNoteBouncer({ count: 3, cancelOnRelease: 0 })
		tail.transform([note()], clock())
		tail.transform([off(60, 0.1)], clock(0.1))
		expect(ons(tail.tick(3, clock(3)))).toHaveLength(2)
		expect(tail.tick(4, clock(4))).toEqual([])
	})
	it("stops a bounce train at the minimum interval and follows the input tempo", () => {
		const effect = new TransformerNoteBouncer({
			beats: 1,
			damping: 50,
			count: 32,
			minimum: 100
		})
		const result = [
			...effect.transform([note()], clock(0, 60)),
			...effect.tick(5, clock(5, 60))
		]
		expect(ons(result).map((command) => command.startAt)).toEqual([0, 1, 1.5, 1.75])
	})
	it("triggers at key release with the original attack velocity and a paired ending", () => {
		const effect = new TransformerReleaseTrigger({ transpose: 12, beats: 0.5 })
		expect(effect.transform([note(60, 0, 7)], clock())).toEqual([])
		expect(effect.transform([off(60, 0.4, 7)], clock(0.4))).toEqual([
			expect.objectContaining({
				type: NOTE_ON,
				number: 72,
				velocity: 100,
				channel: 7,
				startAt: 0.4
			})
		])
		expect(effect.tick(0.66, clock(0.66))).toEqual([
			expect.objectContaining({ type: NOTE_OFF, number: 72, startAt: 0.65 })
		])
	})
	it("uses release velocity when available and ends the dry attack before retriggering", () => {
		const effect = new TransformerReleaseTrigger({ dry: 1, velocitySource: "release" })
		effect.transform([note()], clock())
		const result = effect.transform([off(60, 0.1, 1, "keyboard", 45)], clock(0.1))
		expect(result.map((command) => [command.type, command.velocity])).toEqual([
			[NOTE_OFF, 0],
			[NOTE_ON, 45]
		])
	})
	it("does not trigger a release note after panic, disable or an unmatched note-off", () => {
		const effect = new TransformerReleaseTrigger()
		const release = off()
		expect(effect.transform([release], clock())).toEqual([release])
		effect.transform([note()], clock())
		effect.transform([cc(123, 0, 0.1)], clock(0.1))
		expect(effect.transform([off(60, 0.2)], clock(0.2))).toEqual([])
		effect.transform([note(62, 0.3)], clock(0.3))
		effect.setConfig("enabled", "0")
		effect.tick(0.4, clock(0.4))
		effect.setConfig("enabled", "1")
		expect(effect.transform([off(62, 0.5)], clock(0.5))).toEqual([])
	})
	it.each([
		["oldest", 60, 90, 64, 80, 60],
		["newest", 60, 90, 64, 80, 64],
		["quietest", 60, 90, 64, 80, 64],
		["lowest", 60, 90, 64, 80, 60],
		["highest", 60, 90, 64, 80, 64]
	])(
		"limits polyphony with %s stealing",
		(priority, pitch, velocity, nextPitch, nextVelocity, discarded) => {
			const effect = new TransformerPolyphonyLimiter({ limit: 1, priority })
			effect.transform([note(Number(pitch), 0, 1, "keyboard", Number(velocity))], clock())
			const result = effect.transform(
				[note(Number(nextPitch), 0.1, 1, "keyboard", Number(nextVelocity))],
				clock(0.1)
			)
			expect(ons(result).map((command) => command.number)).toEqual(
				discarded === nextPitch ? [] : [nextPitch]
			)
			expect(offs(result).map((command) => command.number)).toEqual(
				discarded === pitch ? [pitch] : []
			)
			expect(effect.transform([off(Number(discarded), 0.2)], clock(0.2))).toEqual([])
		}
	)
	it("keeps polyphony limits independent across input sources and channels", () => {
		const effect = new TransformerPolyphonyLimiter({ limit: 1 })
		expect(
			ons(effect.transform([note(), note(60, 0, 2), note(60, 0, 1, "other")], clock()))
		).toHaveLength(3)
	})
	it("routes keyboard splits at the boundary and remembers changed destinations for releases", () => {
		const effect = new TransformerNoteRouter({
			split: 60,
			lowerChannel: 3,
			upperChannel: 4,
			lowerTranspose: 12
		})
		expect(effect.transform([note(59), note(60)], clock()).map(commandToMidi)).toEqual([
			[0x92, 71, 100],
			[0x93, 60, 100]
		])
		effect.setConfig("lowerChannel", 5)
		effect.setConfig("split", 72)
		expect(effect.transform([off(59, 1), off(60, 1)], clock(1)).map(commandToMidi)).toEqual([
			[0x82, 71, 0],
			[0x83, 60, 0]
		])
		expect(
			effect.transform([cc(64, 0, 1)], clock(1)).map((command) => command.channel)
		).toEqual([5, 4, 3])
	})
	it("routes velocity splits using attack velocity rather than note-off velocity", () => {
		const effect = new TransformerNoteRouter({
			source: "velocity",
			split: 80,
			lowerChannel: 2,
			upperChannel: 3
		})
		expect(
			effect
				.transform(
					[note(60, 0, 1, "keyboard", 79), note(64, 0, 1, "keyboard", 80)],
					clock()
				)
				.map((command) => command.channel)
		).toEqual([2, 3])
		expect(
			effect.transform([off(64, 1), off(60, 1)], clock(1)).map((command) => command.channel)
		).toEqual([3, 2])
	})
	it("allocates free channels, steals the oldest and suppresses its later physical release", () => {
		const effect = new TransformerChannelAllocator({ first: 2, last: 3 })
		expect(
			effect.transform([note(60), note(64)], clock()).map((command) => command.channel)
		).toEqual([2, 3])
		expect(effect.transform([note(67, 0.1)], clock(0.1))).toEqual([
			expect.objectContaining({ type: NOTE_OFF, number: 60, channel: 2 }),
			expect.objectContaining({ type: NOTE_ON, number: 67, channel: 2 })
		])
		expect(effect.transform([off(60, 0.2)], clock(0.2))).toEqual([])
		expect(
			effect
				.transform([off(67, 0.3), off(64, 0.3)], clock(0.3))
				.map((command) => command.channel)
		).toEqual([2, 3])
	})
	it("shares the allocator pool across input sources and supports lowest-free selection", () => {
		const effect = new TransformerChannelAllocator({ first: 4, last: 2, mode: "lowest-free" })
		expect(
			effect
				.transform([note(60), note(64, 0, 3, "other")], clock())
				.map((command) => command.channel)
		).toEqual([2, 3])
		effect.transform([off(60, 0.1)], clock(0.1))
		expect(effect.transform([note(67, 0.2)], clock(0.2))[0].channel).toBe(2)
	})
	it("routes controls and panic messages to current and previous channel destinations", () => {
		const effect = new TransformerChannelAllocator({ first: 2, last: 3 })
		effect.transform([note()], clock())
		effect.transform([off(60, 0.1)], clock(0.1))
		effect.setConfig("first", 5)
		effect.setConfig("last", 6)
		expect(
			effect.transform([cc(64, 0, 0.2)], clock(0.2)).map((command) => command.channel)
		).toEqual([5, 6, 2])
		const bend = { ...cc(0, 8192, 0.3), type: PITCH_BEND }
		expect(effect.transform([bend], clock(0.3)).map(commandToMidi)).toEqual([
			[0xe4, 0, 64],
			[0xe5, 0, 64],
			[0xe1, 0, 64]
		])
		expect(
			effect.transform([cc(123, 0, 0.4)], clock(0.4)).map((command) => command.channel)
		).toEqual([5, 6, 2])
		const system = { ...cc(0, 0, 0.5), type: MIDI_CLOCK }
		expect(effect.transform([system], clock(0.5))).toEqual([system])
	})
	it("quantises CC values and leaves unrelated controllers intact", () => {
		const effect = new TransformerCCStepper({ levels: 4 })
		expect(
			effect
				.transform([cc(1, 64), cc(1, 0), cc(1, 127), cc(11, 64)], clock())
				.map((command) => command.value)
		).toEqual([85, 0, 127, 64])
	})
	it("coalesces each source/channel/controller onto its next grid line", () => {
		const effect = new TransformerCCStepper({ levels: 128, beats: 0.5, lower: 1, upper: 2 })
		expect(
			effect.transform(
				[cc(1, 10, 0.01), cc(1, 90, 0.02), cc(2, 50, 0.02), cc(1, 20, 0.02, 2)],
				clock(0.02)
			)
		).toEqual([])
		expect(
			effect
				.tick(0.251, clock(0.251))
				.map((command) => [command.number, command.value, command.channel, command.startAt])
		).toEqual([
			[1, 90, 1, 0.25],
			[2, 50, 1, 0.25],
			[1, 20, 2, 0.25]
		])
	})
	it("supports CC grid offsets and cancels pending updates on panic, disable and reset", () => {
		const effect = new TransformerCCStepper({ levels: 128, beats: 1, offset: 50 })
		effect.transform([cc(1, 100, 0.1)], clock(0.1))
		expect(effect.tick(0.251, clock(0.251))).toEqual([
			expect.objectContaining({ value: 100, startAt: 0.25 })
		])
		effect.transform([cc(1, 30, 0.3)], clock(0.3))
		effect.transform([cc(123, 0, 0.4)], clock(0.4))
		expect(effect.tick(1, clock(1))).toEqual([])
		effect.transform([cc(1, 90, 1.1)], clock(1.1))
		effect.setConfig("enabled", 0)
		expect(effect.tick(2, clock(2))).toEqual([])
		effect.setConfig("enabled", 1)
		effect.transform([cc(1, 90, 2.1)], clock(2.1))
		effect.reset()
		expect(effect.tick(3, clock(3))).toEqual([])
	})
	it("round-trips every new type and accepts numeric settings from UI strings", () => {
		const manager = new TransformerManager(types.map((type) => tranformerFactory(type)))
		const restored = new TransformerManager([])
		restored.importConfig(manager.exportConfig())
		expect(
			restored.activeTransformers.map((effect) => JSON.parse(effect.exportConfig()).type)
		).toEqual(types)
		for (const effect of restored.activeTransformers) {
			for (const field of effect.fields) {
				if (typeof effect.options[field.name] === "number") {
					effect.setConfig(field.name, String(effect.options[field.name]))
					expect(typeof effect.options[field.name]).toBe("number")
				}
			}
			effect.setConfig("enabled", "0")
			const input = note()
			expect(effect.transform([input], clock())).toEqual([input])
			effect.destroy()
			expect(effect.tick?.(10, clock(10))).toEqual([])
		}
		manager.destroy()
		restored.destroy()
	})
	it("registers picker entries, icons and portable example presets for every new type", () => {
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
				for (const effect of createPresetTransformers(preset)) {
					effect.destroy()
				}
			}
		} finally {
			picker.destroy()
			chain.destroy()
		}
	})
	it("drives a bounce train through downstream effects using the chain clock and cancels on transport clear", async () => {
		const chain = new IOChain(clock())
		try {
			chain.setTransformers([
				new TransformerNoteBouncer({ count: 3 }),
				new TransformerPitchMirror({ centre: 60 })
			])
			await chain.addCommandToQueue(note(64))
			expect(ons(chain.updateTimeForCommandQueue(0, 0, {}))[0].number).toBe(56)
			expect(ons(chain.updateTimeForCommandQueue(0.51, 0, {}))[0].number).toBe(56)
			chain.clearNoteCommands()
			expect(chain.updateTimeForCommandQueue(10, 0, {})).toEqual([])
		} finally {
			chain.destroy()
		}
	})
})