// @vitest-environment happy-dom
import { describe, expect, it } from "vitest"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { TransformerMpeEncoder } from "../../../packages/audiobus/io/transformers/transformer-mpe-encoder"
import { TransformerMpeDecoder } from "../../../packages/audiobus/io/transformers/transformer-mpe-decoder"
import { TransformerMidiProtocol } from "../../../packages/audiobus/io/transformers/transformer-midi-protocol"
import {
	TRANSFORMER_TYPE,
	TRANSFORMERS,
	tranformerFactory
} from "../../../packages/audiobus/io/transformer-factory"
import { applyTransformer } from "../../../packages/audiobus/io/transformer-pipeline"
import { TRANSFORMER_DEFINITIONS } from "../../../packages/audiobus/io/transformer-definitions"
import { parsePresetLibrary } from "../../../packages/audiobus/io/preset-library"
import { DEFAULT_PRESET_LIBRARY } from "../../../packages/audiobus/io/transformer-presets"
import { createAudioCommand } from "../../../packages/audiobus/commands/audio-command-factory"
import {
	POLYPHONIC_PRESSURE,
	commandToMidi,
	midiToCommand
} from "../../../packages/audiobus/midi/midi-command-conversion"
import {
	commandToMidi1Ump,
	commandToMidi2Ump,
	commandToUmp,
	perNoteToUmp,
	umpToCommand
} from "../../../packages/audiobus/midi/ump-codec"
import {
	NOTE_ON,
	PER_NOTE_CONTROLLER,
	PER_NOTE_PITCH_BEND
} from "../../../packages/audiobus/commands/commands"
import type { IAudioCommand } from "../../../packages/audiobus/commands/audio-command-interface"

const clock = (now = 0) => ({ now, bpm: 120, BPM: 120 }) as never
const midi = (...bytes: number[][]) => bytes.map((data) => midiToCommand(data, 0, "mpe")!)
// MIDI 1 bytes of each message; MIDI 2 per-note messages have none.
const bytes = (commands: IAudioCommand[]) =>
	commands.map((command) => commandToMidi(command)).filter(Boolean)
const perNote = (type: string, number: number, value: number, channel = 1, controller?: number) =>
	Object.assign(createAudioCommand(type, number, 0, "mpe"), {
		channel,
		value,
		controller,
		registered: false
	})

describe("MIDI 2 per-note codec", () => {
	it("decodes and re-encodes per-note pitch bend and assignable controllers", () => {
		const bend = umpToCommand([0x40620000 | (60 << 8), 0xc0000000], 0, "device")!
		expect(bend).toMatchObject({
			type: PER_NOTE_PITCH_BEND,
			channel: 3,
			number: 60,
			value: 12288
		})
		const timbre = umpToCommand([0x40110000 | (64 << 8) | 74, 0x80000000], 0, "device")!
		expect(timbre).toMatchObject({
			type: PER_NOTE_CONTROLLER,
			channel: 2,
			number: 64,
			controller: 74,
			registered: false,
			value: 64
		})
		expect(perNoteToUmp(timbre)).toEqual(timbre.ump)
		bend.number = 62
		expect((commandToUmp(bend)[0] >>> 8) & 127).toBe(62)
	})
	it("builds MIDI 2 and MIDI 1 protocol packets from byte commands", () => {
		const [on] = midi([0x91, 60, 127])
		expect(commandToMidi2Ump(on)).toEqual([0x40913c00, 0xffff0000])
		expect(commandToMidi1Ump(on)).toEqual([0x20913c7f])
		expect(commandToMidi1Ump(perNote(PER_NOTE_PITCH_BEND, 60, 8192))).toBeUndefined()
	})
})

describe("Add MPE", () => {
	it("announces the zone, then gives each note a member channel with reset expression", () => {
		const encoder = new TransformerMpeEncoder()
		const first = encoder.transform(midi([0x90, 60, 100]), clock())
		const configuration = bytes(first).slice(0, 6)
		expect(configuration).toEqual([
			[0xb0, 101, 0],
			[0xb0, 100, 6],
			[0xb0, 6, 15],
			[0xb0, 38, 0],
			[0xb0, 101, 127],
			[0xb0, 100, 127]
		])
		expect(bytes(first).slice(-3)).toEqual([
			[0xe1, 0, 64],
			[0xd1, 0],
			[0x91, 60, 100]
		])
		const second = encoder.transform(midi([0x90, 64, 90]), clock())
		expect(bytes(second)).toEqual([
			[0xe2, 0, 64],
			[0xd2, 0],
			[0x92, 64, 90]
		])
		expect(bytes(encoder.transform(midi([0xa0, 64, 70], [0xb0, 1, 20]), clock()))).toEqual([
			[0xd2, 70],
			[0xb0, 1, 20]
		])
		expect(bytes(encoder.transform(midi([0x80, 60, 0]), clock()))).toEqual([[0x81, 60, 0]])
	})
	it("converts MIDI 2 per-note expression and steals the oldest member channel", () => {
		const encoder = new TransformerMpeEncoder({ members: 2, configure: "off" })
		encoder.transform(midi([0x90, 60, 100], [0x90, 62, 100]), clock())
		expect(
			bytes(
				encoder.transform(
					[
						perNote(PER_NOTE_PITCH_BEND, 62, 12288),
						perNote(PER_NOTE_CONTROLLER, 62, 30, 1, 74)
					],
					clock()
				)
			)
		).toEqual([
			[0xe2, 0, 96],
			[0xb2, 74, 30]
		])
		expect(bytes(encoder.transform(midi([0x90, 64, 100]), clock()))).toEqual([
			[0x81, 60, 0],
			[0xe1, 0, 64],
			[0xd1, 0],
			[0x91, 64, 100]
		])
	})
	it("folds channel bend into every held note when asked", () => {
		const encoder = new TransformerMpeEncoder({ configure: "off", channelBend: "notes" })
		encoder.transform(midi([0x90, 60, 100], [0x90, 64, 100]), clock())
		// Full bend up on a 2 semitone source range is 2 of 48 semitones per note.
		expect(bytes(encoder.transform(midi([0xe0, 127, 127]), clock()))).toEqual([
			[0xe1, 85, 66],
			[0xe2, 85, 66]
		])
	})
})

describe("Remove MPE", () => {
	const mpe = () =>
		midi([0xe1, 0, 96], [0xb1, 74, 30], [0x91, 60, 100], [0xd1, 80], [0xe1, 0, 32])
	it("gathers member channels into MIDI 2 per-note expression", () => {
		const result = new TransformerMpeDecoder().transform(mpe(), clock())
		expect(
			result.map((command) => [command.type, command.channel, command.number, command.value])
		).toEqual([
			[PER_NOTE_PITCH_BEND, 1, 60, 12288],
			[PER_NOTE_CONTROLLER, 1, 60, 30],
			[NOTE_ON, 1, 60, 60],
			[POLYPHONIC_PRESSURE, 1, 60, 80],
			[PER_NOTE_PITCH_BEND, 1, 60, 4096]
		])
		const bend = result.find((command) => command.type === PER_NOTE_PITCH_BEND)!
		expect(bend.ump).toEqual(perNoteToUmp(bend))
		// CC 74 is brightness, a registered per-note controller.
		expect(result[1].registered).toBe(true)
	})
	it("follows the latest note's bend and turns pressure into poly aftertouch for MIDI 1", () => {
		const decoder = new TransformerMpeDecoder({ output: "midi1", channel: 4 })
		const result = decoder.transform(mpe(), clock())
		expect(bytes(result)).toEqual([
			// 24 of 48 semitones is clamped to the two semitone output range.
			[0xe3, 127, 127],
			[0xb3, 74, 30],
			[0x93, 60, 100],
			[0xa3, 60, 80],
			[0xe3, 0, 0]
		])
	})
	it("follows MPE Configuration Messages and passes channels outside the zones", () => {
		const decoder = new TransformerMpeDecoder()
		const configure = (channel: number, members: number) =>
			midi([0xb0 | channel, 101, 0], [0xb0 | channel, 100, 6], [0xb0 | channel, 6, members])
		expect(decoder.transform(configure(0, 4), clock())).toEqual([])
		expect(bytes(decoder.transform(midi([0x92, 62, 100], [0x98, 64, 100]), clock()))).toEqual([
			[0x90, 62, 100],
			[0x98, 64, 100]
		])
		// A new configuration ends the notes held in the zones it resets.
		expect(bytes(decoder.transform(configure(15, 3), clock()))).toEqual([[0x80, 62, 0]])
		expect(bytes(decoder.transform(midi([0x9e, 60, 100], [0x99, 65, 100]), clock()))).toEqual([
			[0x90, 60, 100],
			[0x99, 65, 100]
		])
	})
	it("round-trips per-note bend through Add MPE", () => {
		const encoder = new TransformerMpeEncoder()
		const decoder = new TransformerMpeDecoder()
		const encoded = encoder.transform(
			[...midi([0x90, 60, 100]), perNote(PER_NOTE_PITCH_BEND, 60, 10000)],
			clock()
		)
		const decoded = decoder.transform(encoded, clock())
		expect(
			decoded.filter((command) => command.type === PER_NOTE_PITCH_BEND).at(-1)
		).toMatchObject({
			number: 60,
			value: 10000
		})
	})
})

describe("MIDI Protocol", () => {
	it("upgrades to MIDI 2 packets and downgrades to MIDI 1 without per-note messages", () => {
		const input = [...midi([0x90, 60, 100]), perNote(PER_NOTE_PITCH_BEND, 60, 9000)]
		const upgraded = new TransformerMidiProtocol().transform(input, clock())
		expect(upgraded.map((command) => command.ump![0] >>> 28)).toEqual([4, 4])
		const downgraded = new TransformerMidiProtocol({ protocol: "midi1" }).transform(
			upgraded,
			clock()
		)
		expect(downgraded.map((command) => command.ump)).toEqual([[0x20903c64]])
		expect(input[0].ump).toBeUndefined()
	})
	it("registers picker definitions, icons and example presets", () => {
		const library = parsePresetLibrary(JSON.stringify(DEFAULT_PRESET_LIBRARY))
		for (const type of [
			TRANSFORMER_TYPE.ID_MPE_ENCODER,
			TRANSFORMER_TYPE.ID_MPE_DECODER,
			TRANSFORMER_TYPE.ID_MIDI_PROTOCOL
		]) {
			expect(TRANSFORMERS).toContain(type)
			expect(tranformerFactory(type).type).toBe(type)
			expect(existsSync(resolve("public", TRANSFORMER_DEFINITIONS[type].icon.slice(1)))).toBe(
				true
			)
			expect(
				library.presets.some((preset) => preset.steps.some((step) => step.type === type))
			).toBe(true)
		}
	})
})

describe("MPE and MIDI Protocol edge cases", () => {
	const from = (name: string, ...data: number[][]) =>
		data.map((bytes) => midiToCommand(bytes, 0, name)!)
	const configure = (channel: number, members: number) =>
		midi([0xb0 | channel, 101, 0], [0xb0 | channel, 100, 6], [0xb0 | channel, 6, members])
	it("receives controls through the transformer pipeline and drops per-note messages for MIDI 1", () => {
		const protocol = new TransformerMidiProtocol({ protocol: "midi1" })
		const bend = umpToCommand([0x40603c00, 0xc0000000], 0, "device")!
		const result = applyTransformer(protocol, [bend, ...midi([0xb0, 7, 100])], clock())
		expect(result.map((command) => command.ump)).toEqual([[0x20b00764]])
	})
	it("converts RPN sequences and bank selects between MIDI 1 and MIDI 2", () => {
		const midi2 = new TransformerMidiProtocol()
		const rpn = midi2.transform(
			midi([0xb0, 101, 0], [0xb0, 100, 0], [0xb0, 6, 12], [0xb0, 38, 0]),
			clock()
		)
		expect(rpn.map((command) => command.ump)).toEqual([
			[0x40200000, 0x18000000],
			[0x40200000, 0x18000000]
		])
		const program = midi2.transform(midi([0xb0, 0, 2], [0xb0, 32, 3], [0xc0, 5]), clock())
		expect(program.map((command) => command.ump)).toEqual([[0x40c00001, 0x05000203]])
		const midi1 = new TransformerMidiProtocol({ protocol: "midi1" })
		expect(bytes(midi1.transform([rpn[0], ...program], clock()))).toEqual([
			[0xb0, 101, 0],
			[0xb0, 100, 0],
			[0xb0, 6, 12],
			[0xb0, 38, 0],
			[0xb0, 0, 2],
			[0xb0, 32, 3],
			[0xc0, 5]
		])
	})
	it("patches per-note controller identity in native packets", () => {
		const command = umpToCommand([0x40103c4a, 0x80000000], 0, "device")!
		Object.assign(command, { controller: 71, registered: true })
		expect(commandToUmp(command)).toEqual([0x40003c47, 0x80000000])
	})
	it("applies expression sent before a note and maps registered brightness to CC 74", () => {
		const encoder = new TransformerMpeEncoder({ configure: "off" })
		const brightness = Object.assign(perNote(PER_NOTE_CONTROLLER, 60, 30, 1, 74), {
			registered: true
		})
		expect(
			bytes(
				encoder.transform(
					[perNote(PER_NOTE_PITCH_BEND, 60, 12288), brightness, ...midi([0x90, 60, 100])],
					clock()
				)
			)
		).toEqual([
			[0xe1, 0, 96],
			[0xb1, 74, 30],
			[0xd1, 0],
			[0x91, 60, 100]
		])
	})
	it("resets timbre on a reused member channel and keeps release velocity", () => {
		const encoder = new TransformerMpeEncoder({ members: 1, configure: "off" })
		encoder.transform(midi([0x90, 60, 100]), clock())
		expect(
			bytes(encoder.transform([perNote(PER_NOTE_CONTROLLER, 60, 100, 1, 74)], clock()))
		).toEqual([[0xb1, 74, 100]])
		expect(bytes(encoder.transform(midi([0x80, 60, 0x55]), clock()))).toEqual([
			[0x81, 60, 0x55]
		])
		expect(bytes(encoder.transform(midi([0x90, 62, 100]), clock()))).toEqual([
			[0xe1, 0, 64],
			[0xb1, 74, 64],
			[0xd1, 0],
			[0x91, 62, 100]
		])
	})
	it("keeps each source's member channel expression to its own notes", () => {
		const decoder = new TransformerMpeDecoder()
		decoder.transform([...from("a", [0x91, 60, 100]), ...from("b", [0x91, 64, 100])], clock())
		const result = decoder.transform(from("a", [0xd1, 80]), clock())
		expect(result.map((command) => [command.type, command.number])).toEqual([
			[POLYPHONIC_PRESSURE, 60]
		])
	})
	it("applies member bend range zone-wide until a configuration resets it", () => {
		const decoder = new TransformerMpeDecoder()
		const value = () =>
			decoder
				.transform(midi([0x92, 60, 100], [0xe2, 0, 96]), clock())
				.filter((command) => command.type === PER_NOTE_PITCH_BEND)
				.at(-1)!.value
		decoder.transform(midi([0xb1, 101, 0], [0xb1, 100, 0], [0xb1, 6, 12]), clock())
		expect(value()).toBe(9216)
		decoder.transform(configure(0, 15), clock())
		expect(value()).toBe(12288)
	})
	it("does not shrink the lower zone when the upper zone is turned off", () => {
		const decoder = new TransformerMpeDecoder()
		expect(decoder.transform(configure(15, 0), clock())).toEqual([])
		expect(bytes(decoder.transform(midi([0x9f, 60, 100]), clock()))).toEqual([[0x90, 60, 100]])
	})
})