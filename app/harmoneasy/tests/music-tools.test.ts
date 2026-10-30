import { describe, expect, it } from "vitest"
import {
	defaultMusicTools,
	parseMusicTools,
	parseProgression,
	chordAt,
	DEFAULT_CHORDS,
	macroValue,
	captureGroove,
	applyGroove,
	harmonicRoutes
} from "../../../packages/audiobus/io/music-tools"
import { musicalCommand, parseEventClip } from "../../../packages/audiobus/io/event-clip"
import { NOTE_ON, NOTE_OFF, CONTROL_CHANGE } from "../../../packages/audiobus/commands"
import {
	TransformerChordTrack,
	ID_CHORD_TRACK
} from "../../../packages/audiobus/io/transformers/transformer-chord-track"
import {
	TransformerImprovPartner,
	ID_IMPROV_PARTNER
} from "../../../packages/audiobus/io/transformers/transformer-improv-partner"
import { tranformerFactory } from "../../../packages/audiobus/io/transformer-factory"
import { pitchClasses } from "../../../packages/audiobus/tuning/pitch-class-set"
import { AcousticTempoTracker } from "../source/services/acoustic-tempo"

const clock = (now = 0) => ({ now, bpm: 120, BPM: 120 }) as any
const command = (type: string, pitch = 60, startAt = 0, velocity = type === NOTE_ON ? 100 : 0) =>
	musicalCommand({
		type,
		number: pitch,
		startAt,
		time: startAt,
		velocity,
		channel: 1,
		from: "keys"
	})
const attacks = (commands: ReturnType<typeof command>[]) =>
	commands.filter((command) => command.type === NOTE_ON && command.velocity > 0)
const clip = () =>
	parseEventClip({
		version: 1,
		duration: 0.5,
		commands: [
			command(NOTE_ON, 60, 0),
			command(NOTE_OFF, 60, 0.08),
			command(NOTE_ON, 62, 0.15, 50),
			command(NOTE_OFF, 62, 0.23),
			command(NOTE_ON, 64, 0.25, 100),
			command(NOTE_OFF, 64, 0.33),
			command(NOTE_ON, 65, 0.4, 50),
			command(NOTE_OFF, 65, 0.48)
		]
	})

describe("shared music tools state", () => {
	it("validates round trips, rejects malformed settings and keeps defaults independent", () => {
		const state = defaultMusicTools()
		state.macros[0].mappings.push({ target: "test", minimum: 100, maximum: 0 })
		expect(parseMusicTools(JSON.parse(JSON.stringify(state)))).toEqual(state)
		expect(defaultMusicTools().macros[0].mappings).toEqual([])
		expect(() => parseMusicTools({ ...state, version: 2 })).toThrow()
		expect(() => parseProgression([{ ...DEFAULT_CHORDS[0], beats: NaN }])).toThrow()
		expect(() =>
			parseMusicTools({
				...state,
				grooves: [{ name: "bad", division: 0.25, offsets: [1], velocities: [80] }]
			})
		).toThrow()
		expect(() =>
			parseMusicTools({
				...state,
				macros: [{ ...state.macros[0], value: 2 }, ...state.macros.slice(1)]
			})
		).toThrow()
	})
	it("uses cumulative durations and wraps the shared chord position", () => {
		expect(chordAt(DEFAULT_CHORDS, 0).name).toBe("C")
		expect(chordAt(DEFAULT_CHORDS, 4).name).toBe("Am")
		expect(chordAt(DEFAULT_CHORDS, 16).name).toBe("C")
		expect(chordAt(DEFAULT_CHORDS, -1).name).toBe("G")
	})
	it("supports inverted macro ranges and clamps normalized controls", () => {
		const mapping = { target: "x", minimum: 100, maximum: 20 }
		expect(macroValue(mapping, 0.25)).toBe(80)
		expect(macroValue(mapping, -2)).toBe(100)
		expect(macroValue(mapping, 3)).toBe(20)
	})
})

describe("shared chord follower", () => {
	it("registers both musical processors with persistent configurations", () => {
		expect(tranformerFactory(ID_CHORD_TRACK)).toBeInstanceOf(TransformerChordTrack)
		expect(tranformerFactory(ID_IMPROV_PARTNER)).toBeInstanceOf(TransformerImprovPartner)
		const follower = new TransformerChordTrack({ role: "bass", transpose: -12 })
		follower.setProgression([{ name: "D", root: 2, mask: 580, beats: 2 }])
		const restored = tranformerFactory(
			ID_CHORD_TRACK,
			JSON.parse(follower.exportConfig())
		) as TransformerChordTrack
		expect(restored.transform([command(NOTE_ON, 66)], clock())[0].number).toBe(50)
	})
	it("retains attack pitches for releases across chord changes, transpose and bypass", () => {
		const follower = new TransformerChordTrack()
		expect(follower.transform([command(NOTE_ON, 61)], clock())[0].number).toBe(60)
		follower.setMusicalBeat(4)
		follower.setConfig("transpose", 12)
		expect(follower.transform([command(NOTE_OFF, 61, 0.1)], clock(0.1))[0].number).toBe(60)
		const next = follower.transform([command(NOTE_ON, 61, 0.2)], clock(0.2))[0]
		expect(next.number).toBe(72)
		follower.setConfig("enabled", false)
		expect(follower.tick(0.3, clock(0.3))).toContainEqual(
			expect.objectContaining({ type: NOTE_OFF, number: 72 })
		)
	})
	it("expands chords, passes controllers and handles silence and MIDI edges", () => {
		const follower = new TransformerChordTrack({ role: "chords", transpose: 12 })
		expect(
			attacks(follower.transform([command(NOTE_ON, 60)], clock())).map((n) => n.number)
		).toEqual([72, 76, 79])
		expect(follower.transform([command(NOTE_OFF, 60, 0.1)], clock(0.1))).toHaveLength(3)
		const cc = command(CONTROL_CHANGE, 1, 0.2)
		cc.value = 42
		expect(follower.transform([cc], clock(0.2))).toEqual([cc])
		follower.setProgression([{ name: "Silence", root: 0, mask: 0, beats: 4 }])
		expect(follower.transform([command(NOTE_ON, 127, 0.3)], clock(0.3))).toEqual([])
	})
})

describe("groove transfer", () => {
	it("extracts alternating timing and dynamics and transfers them exactly at full strength", () => {
		const source = clip()
		const groove = captureGroove(source, 120)
		for (const [index, expected] of [0, 0.05, 0, 0.05].entries()) {
			expect(groove.offsets[index]).toBeCloseTo(expected)
		}
		expect(groove.velocities).toEqual([100, 50, 100, 50])
		const straight = parseEventClip({
			version: 1,
			duration: 0.5,
			commands: source.commands.map((command) => ({
				...command,
				startAt: Math.round(command.startAt / 0.125) * 0.125,
				velocity: command.type === NOTE_ON ? 80 : 0
			}))
		})
		const applied = applyGroove(straight, groove, 120, 1, 1)
		expect(attacks(applied.commands).map((n) => n.startAt)).toEqual([0, 0.15, 0.25, 0.4])
		expect(attacks(applied.commands).map((n) => n.velocity)).toEqual([100, 50, 100, 50])
	})
	it("keeps source data unchanged and preserves note durations and controller timing", () => {
		const source = clip()
		const before = JSON.stringify(source)
		const groove = { name: "Late", division: 0.25, offsets: [0.05], velocities: [40] }
		const shifted = applyGroove(source, groove, 120, 1, 0)
		expect(shifted.commands[0].startAt).toBeCloseTo(0.025)
		expect(shifted.commands[1].startAt - shifted.commands[0].startAt).toBeCloseTo(0.08)
		expect(JSON.stringify(source)).toBe(before)
		const content = (commands: typeof source.commands) =>
			commands.map(({ type, number, channel, velocity, startAt }) => ({
				type,
				number,
				channel,
				velocity,
				startAt
			}))
		expect(content(applyGroove(source, groove, 120, 0, 0).commands)).toEqual(
			content(source.commands)
		)
		const cc = command(CONTROL_CHANGE, 1, 0.2)
		cc.value = 64
		const withCC = parseEventClip({ ...source, commands: [...source.commands, cc] })
		expect(
			applyGroove(withCC, groove, 120, 1, 1).commands.find((n) => n.type === CONTROL_CHANGE)
				?.startAt
		).toBe(0.2)
	})
	it("pairs overlapping equal pitches FIFO and never releases before an attack", () => {
		const source = parseEventClip({
			version: 1,
			duration: 1,
			commands: [
				command(NOTE_ON, 60, 0.1),
				command(NOTE_ON, 60, 0.2),
				command(NOTE_OFF, 60, 0.3),
				command(NOTE_OFF, 60, 0.4)
			]
		})
		const shifted = applyGroove(
			source,
			{ name: "Early", division: 0.25, offsets: [-0.1], velocities: [100] },
			120,
			1,
			0
		)
		const on = shifted.commands.filter((n) => n.type === NOTE_ON),
			off = shifted.commands.filter((n) => n.type === NOTE_OFF)
		expect(off[0].startAt - on[0].startAt).toBeCloseTo(0.2)
		expect(off[1].startAt - on[1].startAt).toBeCloseTo(0.2)
	})
})

describe("harmonic route finder", () => {
	it("returns deterministic routes with valid endpoints and retained common tones", () => {
		for (const [start, end] of [
			[145, 529],
			[1, 2048],
			[4095, 1],
			[2741, 1709],
			[145, 145]
		]) {
			const routes = harmonicRoutes(start, end)
			expect(routes).toEqual(harmonicRoutes(start, end))
			for (const route of routes) {
				expect(route.masks[0]).toBe(start)
				expect(route.masks.at(-1)).toBe(end)
				expect(route.explanations).toHaveLength(route.masks.length - 1)
				for (const mask of route.masks) {
					expect(mask).toBeGreaterThan(0)
					expect(mask & (start & end)).toBe(start & end)
				}
				for (let i = 1; i < route.masks.length; i++) {
					expect(pitchClasses(route.masks[i] ^ end).length).toBeLessThan(
						pitchClasses(route.masks[i - 1] ^ end).length
					)
				}
			}
		}
		expect(() => harmonicRoutes(0, 145)).toThrow()
	})
})

describe("improvisation partner", () => {
	it("waits for releases and silence, answers once and can be interrupted", () => {
		const partner = new TransformerImprovPartner({ gap: 1, variation: 0 })
		partner.transform([command(NOTE_ON, 60)], clock())
		expect(partner.tick(1, clock(1))).toEqual([])
		partner.transform([command(NOTE_OFF, 60, 1.1)], clock(1.1))
		expect(attacks(partner.tick(1.59, clock(1.59)))).toHaveLength(0)
		expect(attacks(partner.tick(1.61, clock(1.61))).map((n) => n.number)).toEqual([60])
		const interrupted = partner.transform([command(NOTE_ON, 64, 1.7)], clock(1.7))
		expect(interrupted).toContainEqual(expect.objectContaining({ type: NOTE_OFF, number: 60 }))
		expect(attacks(interrupted).map((n) => n.number)).toEqual([64])
	})
	it("follows current harmony at response time and supports listen-only, silence and reset", () => {
		const partner = new TransformerImprovPartner({ gap: 1 })
		partner.mask = 145
		partner.transform([command(NOTE_ON, 61)], clock())
		partner.transform([command(NOTE_OFF, 61, 0.1)], clock(0.1))
		expect(attacks(partner.tick(0.61, clock(0.61))).map((n) => n.number)).toEqual([60])
		partner.reset()
		expect(partner.tick(10, clock(10))).toEqual([])
		partner.setConfig("mode", "listen")
		partner.transform([command(NOTE_ON, 62, 11)], clock(11))
		partner.transform([command(NOTE_OFF, 62, 11.1)], clock(11.1))
		expect(attacks(partner.tick(12, clock(12)))).toHaveLength(0)
		partner.clearMemory()
		expect(partner.status).toContain("0 remembered")
		partner.setConfig("mode", "respond")
		partner.setConfig("silence", 1)
		partner.transform([command(NOTE_ON, 64, 13)], clock(13))
		partner.transform([command(NOTE_OFF, 64, 13.1)], clock(13.1))
		expect(attacks(partner.tick(14, clock(14)))).toHaveLength(0)
	})
	it("cancels future responses on panic or bypass", () => {
		for (const panic of [true, false]) {
			const partner = new TransformerImprovPartner({ gap: 1 })
			partner.transform([command(NOTE_ON, 60)], clock())
			partner.transform([command(NOTE_OFF, 60, 0.1)], clock(0.1))
			partner.transform([command(NOTE_ON, 64, 0.2)], clock(0.2))
			partner.transform([command(NOTE_OFF, 64, 0.3)], clock(0.3))
			partner.tick(0.81, clock(0.81))
			if (panic) {
				const cc = command(CONTROL_CHANGE, 123, 0.82)
				cc.value = 0
				partner.transform([cc], clock(0.82))
			} else {
				partner.setConfig("enabled", false)
			}
			expect(attacks(partner.tick(1, clock(1)))).toHaveLength(0)
		}
	})
})

describe("acoustic tempo estimation", () => {
	it("locks to regular pulses, rejects fast retriggers and holds tempo on silence", () => {
		const tracker = new AcousticTempoTracker(120)
		for (let i = 0; i < 10; i++) {
			tracker.onset(i * 0.5)
			tracker.onset(i * 0.5 + 0.01)
		}
		expect(tracker.bpm).toBeCloseTo(120)
		expect(tracker.confidence).toBeGreaterThan(0.9)
		expect(tracker.status(9)).toContain("holding")
		expect(tracker.bpm).toBe(120)
	})
	it("uses the tapped reference to disambiguate half-time and bounds tempo movement", () => {
		const tracker = new AcousticTempoTracker(120)
		for (let i = 0; i < 9; i++) {
			tracker.onset(i)
		}
		expect(tracker.bpm).toBeCloseTo(120)
		tracker.reset(100)
		let previous = 100
		for (let i = 0; i < 12; i++) {
			const bpm = tracker.onset(i * 0.55)
			if (bpm) {
				expect(Math.abs(bpm - previous)).toBeLessThanOrEqual(previous * 0.025)
				previous = bpm
			}
		}
		expect(tracker.bpm).toBeGreaterThan(100)
		expect(tracker.bpm).toBeLessThan(110)
	})
})