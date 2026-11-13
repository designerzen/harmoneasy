import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	ChordPerformer,
	performerVelocityToMidi,
	type ChordPerformerOutput
} from "../../../packages/audiobus/io/chord-performer"
import {
	ARPEGGIO_GRID_BAR,
	ARPEGGIO_GRID_CLOCK,
	Arpeggio,
	getArpeggioTiming,
	getArpeggioTimingOptionsForRate
} from "../../../packages/audiobus/timing/arpeggio"

type Event = ["on" | "off", number, number?]

class FakeOutput implements ChordPerformerOutput {
	events: Event[] = []
	sounding = new Set<number>()
	allNotesOffCalls = 0

	noteOn(note: number, velocity: number) {
		this.events.push(["on", note, velocity])
		this.sounding.add(note)
	}
	noteOff(note: number) {
		this.events.push(["off", note])
		this.sounding.delete(note)
	}
	allNotesOff() {
		this.allNotesOffCalls++
		this.sounding.clear()
	}
	ons() {
		return this.events.filter((event) => event[0] === "on").map((event) => event[1])
	}
}

const C_MAJOR = [60, 64, 67]

beforeEach(() => {
	vi.useFakeTimers()
})
afterEach(() => {
	vi.useRealTimers()
})

describe("ChordPerformer chord mode", () => {
	it("plays every note of the chord on a single output and releases them", () => {
		const out = new FakeOutput()
		const performer = new ChordPerformer(out)
		performer.chordOn(C_MAJOR)
		expect(out.ons()).toEqual(C_MAJOR)
		expect([...out.sounding]).toEqual(C_MAJOR)
		expect(performer.chordOff(C_MAJOR)).toEqual(C_MAJOR)
		expect(out.sounding.size).toBe(0)
		expect(performer.isSounding).toBe(false)
	})

	it("accepts note objects and converts 0..1 velocity to 1..127", () => {
		const out = new FakeOutput()
		const performer = new ChordPerformer(out)
		performer.chordOn([
			{ noteNumber: 60, velocity: 0.5 },
			{ noteNumber: 64 },
			{ noteNumber: 67, velocity: 0 }
		])
		expect(out.events).toEqual([
			["on", 60, 64],
			["on", 64, 127]
		])
		performer.allNotesOff()
		performer.chordOn([{ noteNumber: 60, velocity: 0.2 }], 1)
		expect(out.events.at(-1)).toEqual(["on", 60, 127])
		expect(performerVelocityToMidi(2)).toBe(127)
		expect(performerVelocityToMidi(Number.NaN)).toBe(127)
	})

	it("retriggers by releasing and striking again", () => {
		const out = new FakeOutput()
		const performer = new ChordPerformer(out)
		performer.chordOn(C_MAJOR, 1)
		out.events.length = 0
		expect(performer.chordRetrigger(C_MAJOR, 0.5)).toEqual(C_MAJOR)
		expect(out.events).toEqual([
			["off", 60],
			["on", 60, 64],
			["off", 64],
			["on", 64, 64],
			["off", 67],
			["on", 67, 64]
		])
		expect(performer.activeNotes).toEqual(C_MAJOR)
	})

	it("ignores empty chords and notes that are not numbers", () => {
		const out = new FakeOutput()
		const performer = new ChordPerformer(out)
		expect(performer.chordOn([])).toEqual([])
		expect(performer.chordOn([null, Number.NaN, undefined])).toEqual([])
		expect(performer.chordRetrigger([])).toEqual([])
		expect(out.events).toEqual([])
	})

	it("strikes a note that is already sounding again without tracking it twice", () => {
		const out = new FakeOutput()
		const performer = new ChordPerformer(out)
		expect(performer.noteOn(60)).toBe(true)
		expect(performer.noteOn(60)).toBe(false)
		expect(out.ons()).toEqual([60, 60])
		expect(performer.noteOff(60)).toBe(true)
		expect(performer.noteOff(60)).toBe(false)
		expect(out.events.filter((event) => event[0] === "off")).toHaveLength(1)
	})
})

describe("ChordPerformer single-note mode", () => {
	it("reports that it does not play chords and plays what it is given", () => {
		const out = new FakeOutput()
		const performer = new ChordPerformer(out, { performanceMode: "single-note" })
		expect(performer.performanceMode).toBe("single-note")
		expect(performer.playsChords).toBe(false)
		performer.chordOn([62])
		expect(out.ons()).toEqual([62])
		performer.chordOff([62])
		expect(out.sounding.size).toBe(0)
	})
})

describe("ChordPerformer spreading across outputs", () => {
	it("gives each output one note of the chord", () => {
		const outs = [new FakeOutput(), new FakeOutput(), new FakeOutput()]
		const performer = new ChordPerformer(outs)
		performer.chordOn(C_MAJOR)
		expect(outs.map((out) => out.ons())).toEqual([[60], [64], [67]])
		performer.chordOff(C_MAJOR)
		expect(outs.every((out) => out.sounding.size === 0)).toBe(true)
	})

	it("doubles notes from the start of the chord when there are more outputs than notes", () => {
		const outs = [new FakeOutput(), new FakeOutput(), new FakeOutput()]
		const performer = new ChordPerformer(outs)
		performer.chordOn([60, 67])
		expect(outs.map((out) => out.ons())).toEqual([[60], [67], [60]])
	})

	it("wraps extra notes round the outputs so none are dropped", () => {
		const outs = [new FakeOutput(), new FakeOutput()]
		const performer = new ChordPerformer(outs)
		performer.chordOn([60, 64, 67, 71])
		expect(outs.map((out) => out.ons())).toEqual([
			[60, 67],
			[64, 71]
		])
		performer.allNotesOff()
		expect(outs.every((out) => out.sounding.size === 0)).toBe(true)
	})

	it("does not call allNotesOff on the outputs it shares", () => {
		const out = new FakeOutput()
		const performer = new ChordPerformer(out)
		performer.chordOn(C_MAJOR)
		performer.allNotesOff()
		expect(out.allNotesOffCalls).toBe(0)
		expect(out.sounding.size).toBe(0)
	})

	it("rejects an empty output list", () => {
		expect(() => new ChordPerformer([])).toThrow()
	})
})

describe("ChordPerformer arpeggio mode", () => {
	it("steps through the sequence on repeated chordOn of the same chord", () => {
		const out = new FakeOutput()
		const performer = new ChordPerformer(out, { performanceMode: "arpeggio" })
		for (let step = 0; step < 4; step++) {
			performer.chordOn(C_MAJOR)
		}
		expect(out.ons()).toEqual([60, 64, 67, 60])
		// only one note sounds at a time
		expect([...out.sounding]).toEqual([60])
	})

	it("restarts from the first note when the chord changes", () => {
		const out = new FakeOutput()
		const performer = new ChordPerformer(out, { performanceMode: "arpeggio" })
		performer.chordOn(C_MAJOR)
		performer.chordOn(C_MAJOR)
		performer.chordOn([62, 65, 69])
		performer.chordOn([62, 65, 69])
		expect(out.ons()).toEqual([60, 64, 62, 65])
	})

	it("releases the previous note before starting the next", () => {
		const out = new FakeOutput()
		const performer = new ChordPerformer(out, { performanceMode: "arpeggio" })
		performer.chordOn(C_MAJOR)
		performer.chordOn(C_MAJOR)
		expect(out.events).toEqual([
			["on", 60, 127],
			["off", 60],
			["on", 64, 127]
		])
	})

	it("releases the note after the gate time", () => {
		const out = new FakeOutput()
		const performer = new ChordPerformer(out, {
			performanceMode: "arpeggio",
			arpeggioGateMs: 200
		})
		performer.chordOn(C_MAJOR)
		vi.advanceTimersByTime(199)
		expect(out.sounding.has(60)).toBe(true)
		vi.advanceTimersByTime(1)
		expect(out.sounding.size).toBe(0)
		expect(vi.getTimerCount()).toBe(0)
	})

	it("cancels a pending gate when the next step arrives first", () => {
		const out = new FakeOutput()
		const performer = new ChordPerformer(out, { performanceMode: "arpeggio" })
		performer.setArpeggioGate(500)
		performer.chordOn(C_MAJOR)
		vi.advanceTimersByTime(100)
		performer.chordOn(C_MAJOR)
		expect(vi.getTimerCount()).toBe(1)
		vi.advanceTimersByTime(499)
		expect(out.sounding.has(64)).toBe(true)
		vi.advanceTimersByTime(1)
		expect(out.sounding.size).toBe(0)
		expect(out.events.filter((event) => event[0] === "off")).toHaveLength(2)
	})

	it("uses the gate length reported by getArpeggioTiming", () => {
		const performer = new ChordPerformer(new FakeOutput())
		const timing = performer.getArpeggioTiming(120, {
			isQuarterNote: true,
			grid: "quarter-note"
		})
		expect(timing).toMatchObject({ grid: "quarter-note", intervalMs: 500, shouldTrigger: true })
		expect(performer.setArpeggioGate(timing.gateMs)).toBe(timing.gateMs)
		expect(performer.setArpeggioGate(-5)).toBe(0)
	})

	it("releases an octave-shifted note on chordOff and leaves no timer", () => {
		const out = new FakeOutput()
		const performer = new ChordPerformer(out, { performanceMode: "harp", arpeggioGateMs: 300 })
		for (let step = 0; step < 4; step++) {
			performer.chordOn(C_MAJOR)
		}
		expect(out.ons()).toEqual([60, 64, 67, 72])
		expect(performer.chordOff(C_MAJOR)).toEqual([72])
		expect(out.sounding.size).toBe(0)
		expect(vi.getTimerCount()).toBe(0)
	})
})

describe("ChordPerformer harp mode", () => {
	it("climbs four octaves and drops notes above 127", () => {
		const out = new FakeOutput()
		const performer = new ChordPerformer(out, { performanceMode: "harp" })
		const sequence = performer.getArpeggioSequence([60, 64]).map((note) => note.noteNumber)
		expect(sequence).toEqual([60, 64, 72, 76, 84, 88, 96, 100])
		expect(performer.getArpeggioSequence([120, 126]).map((note) => note.noteNumber)).toEqual([
			120, 126
		])
		for (let step = 0; step < 9; step++) {
			performer.chordOn([60, 64])
		}
		expect(out.ons()).toEqual([60, 64, 72, 76, 84, 88, 96, 100, 60])
	})

	it("steps on the clock rather than the tempo grid", () => {
		const performer = new ChordPerformer(new FakeOutput(), { performanceMode: "harp" })
		const timing = performer.getArpeggioTiming(120, { tickDurationMs: 20, divisionsElapsed: 8 })
		expect(timing).toMatchObject({
			grid: ARPEGGIO_GRID_CLOCK,
			intervalMs: 80,
			shouldTrigger: true
		})
		expect(
			performer.getArpeggioTiming(120, { tickDurationMs: 20, divisionsElapsed: 3 })
				.shouldTrigger
		).toBe(false)
	})
})

describe("ChordPerformer never leaves a stuck note", () => {
	it("releases everything on allNotesOff and cancels the gate", () => {
		const out = new FakeOutput()
		const performer = new ChordPerformer(out, {
			performanceMode: "arpeggio",
			arpeggioGateMs: 400
		})
		performer.chordOn(C_MAJOR)
		expect(vi.getTimerCount()).toBe(1)
		expect(performer.allNotesOff()).toEqual([60])
		expect(out.sounding.size).toBe(0)
		expect(vi.getTimerCount()).toBe(0)
		vi.advanceTimersByTime(1000)
		expect(out.events.filter((event) => event[0] === "off")).toHaveLength(1)
	})

	it("releases everything when the mode changes", () => {
		const out = new FakeOutput()
		const performer = new ChordPerformer(out)
		performer.chordOn(C_MAJOR)
		performer.performanceMode = "arpeggio"
		expect(out.sounding.size).toBe(0)
		performer.setArpeggioGate(300)
		performer.chordOn(C_MAJOR)
		performer.performanceMode = "single-note"
		expect(out.sounding.size).toBe(0)
		expect(vi.getTimerCount()).toBe(0)
		performer.performanceMode = "harp"
		performer.chordOn(C_MAJOR)
		performer.performanceMode = "chord"
		expect(out.sounding.size).toBe(0)
		expect(performer.arpeggioIndex).toBe(0)
	})

	it("releases everything when the arpeggio is reconfigured", () => {
		const out = new FakeOutput()
		const performer = new ChordPerformer(out, { performanceMode: "harp" })
		for (let step = 0; step < 4; step++) {
			performer.chordOn(C_MAJOR)
		}
		performer.configureArpeggio({ variation: "arpeggio", octaveSpan: 1 })
		expect(out.sounding.size).toBe(0)
		expect(performer.performanceMode).toBe("arpeggio")
	})

	it("releases everything on destroy and ignores later calls", () => {
		const outs = [new FakeOutput(), new FakeOutput()]
		const performer = new ChordPerformer(outs, {
			performanceMode: "arpeggio",
			arpeggioGateMs: 250
		})
		performer.chordOn(C_MAJOR)
		const spread = new ChordPerformer(outs)
		spread.chordOn([60, 64])
		performer.destroy()
		spread.destroy()
		expect(outs.every((out) => out.sounding.size === 0)).toBe(true)
		expect(vi.getTimerCount()).toBe(0)
		const eventCount = outs.map((out) => out.events.length)
		expect(performer.chordOn(C_MAJOR)).toEqual([])
		expect(performer.noteOn(60)).toBe(false)
		expect(outs.map((out) => out.events.length)).toEqual(eventCount)
		expect(performer.isDestroyed).toBe(true)
	})

	it("releases on the old outputs when they are replaced", () => {
		const first = new FakeOutput()
		const second = new FakeOutput()
		const performer = new ChordPerformer(first)
		performer.chordOn(C_MAJOR)
		performer.setOutputs(second)
		expect(first.sounding.size).toBe(0)
		performer.chordOn(C_MAJOR)
		expect(second.ons()).toEqual(C_MAJOR)
	})

	it("keeps releasing the other notes when an output throws or rejects", () => {
		const errors: unknown[] = []
		const failing = new FakeOutput()
		failing.noteOff = () => {
			throw new Error("boom")
		}
		const rejecting = new FakeOutput()
		rejecting.noteOff = (() => Promise.reject(new Error("nope"))) as never
		const good = new FakeOutput()
		const performer = new ChordPerformer([failing, rejecting, good], {
			onError: (error) => errors.push(error)
		})
		performer.chordOn(C_MAJOR)
		performer.allNotesOff()
		expect(good.sounding.size).toBe(0)
		expect(performer.isSounding).toBe(false)
		expect(errors).toHaveLength(1)
	})

	it("rejects an unknown performance mode", () => {
		const performer = new ChordPerformer(new FakeOutput())
		expect(() => {
			performer.performanceMode = "strum" as never
		}).toThrow(RangeError)
	})
})

describe("arpeggio timing helpers", () => {
	it("keeps the PhotoSYNTH grid choice and gate maths", () => {
		expect(getArpeggioTiming(80)).toMatchObject({ grid: "quarter-note", intervalMs: 750 })
		expect(getArpeggioTiming(120)).toMatchObject({ grid: "half-note", intervalMs: 1000 })
		expect(getArpeggioTiming(120, { forceBar: true, isBar: true })).toMatchObject({
			grid: ARPEGGIO_GRID_BAR,
			intervalMs: 2000,
			shouldTrigger: true
		})
		expect(getArpeggioTiming(120, { grid: "quarter-note" }).gateMs).toBe(325)
		expect(getArpeggioTimingOptionsForRate("slow", "harp")).toEqual({ clockStep: 8 })
		expect(getArpeggioTimingOptionsForRate("fast")).toEqual({ grid: "quarter-note" })
		expect(getArpeggioTimingOptionsForRate("bogus")).toEqual({})
	})

	it("configures variations and per-call overrides", () => {
		const arpeggio = new Arpeggio()
		expect(arpeggio.enabled).toBe(false)
		expect(arpeggio.configure("harp")).toEqual({ octaveSpan: 4, clockStep: 4 })
		expect(arpeggio.configure({ variation: "arpeggio", octaveSpan: 2 })).toEqual({
			octaveSpan: 2,
			clockStep: 0
		})
		expect(arpeggio.configure("unknown").octaveSpan).toBe(1)
		arpeggio.configure("chord")
		expect(arpeggio.enabled).toBe(false)
	})
})