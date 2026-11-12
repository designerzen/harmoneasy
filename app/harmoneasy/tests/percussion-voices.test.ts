import { afterEach, expect, it, vi } from "vitest"
import { PercussionSynth } from "../../../packages/audiobus/instruments/percussion/percussion-synth.ts"
import { GENERAL_MIDI_PERCUSSION_NOTES } from "../../../packages/audiobus/timing/percussion-note-map.ts"

function setup() {
	const parameter = () => ({
		value: 0,
		setValueAtTime: vi.fn((value: number, time: number) => {
			expect(Number.isFinite(value) && Number.isFinite(time)).toBe(true)
		}),
		linearRampToValueAtTime: vi.fn(),
		exponentialRampToValueAtTime: vi.fn((value: number, time: number) => {
			expect(value > 0 && Number.isFinite(value) && Number.isFinite(time)).toBe(true)
		}),
		setTargetAtTime: vi.fn()
	})
	const nodes: ReturnType<typeof node>[] = []
	const node = (kind: string) => {
		const result = { kind, connect: vi.fn(), disconnect: vi.fn() }
		nodes.push(result)
		return result
	}
	const sources: ReturnType<typeof source>[] = []
	const source = (kind: string) => {
		const result = {
			...node(kind),
			type: "sine",
			frequency: parameter(),
			playbackRate: parameter(),
			buffer: null as AudioBuffer | null,
			loop: false,
			start: vi.fn(),
			stop: vi.fn(),
			onended: null as (() => void) | null
		}
		sources.push(result)
		return result
	}
	const gains: ReturnType<typeof gain>[] = []
	const gain = () => {
		const result = { ...node("gain"), gain: parameter() }
		gains.push(result)
		return result
	}
	const filters: ReturnType<typeof filter>[] = []
	const filter = () => {
		const result = {
			...node("filter"),
			type: "lowpass",
			frequency: parameter(),
			Q: parameter()
		}
		filters.push(result)
		return result
	}
	const context = {
		currentTime: 10,
		sampleRate: 8000,
		destination: node("destination"),
		createGain: gain,
		createOscillator: () => source("oscillator"),
		createBufferSource: () => source("buffer"),
		createBiquadFilter: filter,
		createStereoPanner: () => ({ ...node("panner"), pan: parameter() }),
		createDelay: () => ({ ...node("delay"), delayTime: parameter() }),
		createConvolver: () => ({ ...node("convolver"), buffer: null, normalize: true }),
		createBuffer: (channels: number, length: number, rate: number) => {
			const data = Array.from({ length: channels }, () => new Float32Array(length))
			return {
				duration: length / rate,
				length,
				sampleRate: rate,
				getChannelData: (index: number) => data[index]
			}
		},
		createDynamicsCompressor: () => ({
			...node("compressor"),
			threshold: parameter(),
			ratio: parameter(),
			knee: parameter(),
			attack: parameter(),
			release: parameter()
		})
	}
	const synth = new PercussionSynth(context as unknown as AudioContext)
	const busNodeCount = nodes.length
	return { synth, sources, nodes, gains, filters, busNodeCount }
}

afterEach(() => {
	vi.restoreAllMocks()
})

for (const part of Object.keys(GENERAL_MIDI_PERCUSSION_NOTES)) {
	it("schedules and releases every source and node for " + part, () => {
		const { synth, sources, nodes, busNodeCount } = setup()
		synth.trigger({ part, velocity: 0.8, triggerAt: 12 })
		expect(sources.length).toBeGreaterThan(0)
		for (const source of sources) {
			expect(source.start).toHaveBeenCalledExactlyOnceWith(12)
			expect(source.stop.mock.calls[0][0]).toBeGreaterThan(12)
		}
		synth.allNotesOff()
		for (const source of sources) {
			expect(source.stop).toHaveBeenLastCalledWith()
		}
		for (const node of nodes.slice(busNodeCount)) {
			expect(node.disconnect).toHaveBeenCalled()
		}
		synth.destroy()
	})
}

it("builds distinct guiro, cuica, triangle and whistle graphs", () => {
	const graphs = ["guiroLong", "cuicaOpen", "triangleOpen", "whistleLong"].map((part) => {
		const { synth, sources, filters, nodes, busNodeCount } = setup()
		synth.trigger({ part, velocity: 1, triggerAt: 12 })
		const graph = JSON.stringify({
			sources: sources.map((source) => [source.kind, source.type]),
			filters: filters.map((filter) => [filter.type, filter.Q.setValueAtTime.mock.calls]),
			nodes: nodes.slice(busNodeCount).map((node) => node.kind)
		})
		synth.destroy()
		return graph
	})
	expect(new Set(graphs).size).toBe(4)
})

it("releases finished graphs through onended and removes them from allNotesOff", () => {
	const { synth, sources, nodes, busNodeCount } = setup()
	for (const part of Object.keys(GENERAL_MIDI_PERCUSSION_NOTES)) {
		synth.trigger({ part, velocity: 1, triggerAt: 12 })
	}
	for (const source of sources) {
		source.onended!()
		source.stop.mockClear()
	}
	for (const node of nodes.slice(busNodeCount)) {
		expect(node.disconnect).toHaveBeenCalled()
	}
	synth.allNotesOff()
	for (const source of sources) {
		expect(source.stop).not.toHaveBeenCalled()
	}
	synth.destroy()
})

it("stops and disconnects overlapping and future voices across the whole kit", () => {
	const { synth, sources, nodes, busNodeCount } = setup()
	for (const triggerAt of [12, 12.02, 20]) {
		for (const part of Object.keys(GENERAL_MIDI_PERCUSSION_NOTES)) {
			synth.trigger({ part, velocity: 0.7, triggerAt })
		}
	}
	synth.allNotesOff()
	for (const source of sources) {
		expect(source.stop).toHaveBeenLastCalledWith()
	}
	for (const node of nodes.slice(busNodeCount)) {
		expect(node.disconnect).toHaveBeenCalled()
	}
	synth.destroy()
})

for (const part of [
	"clack",
	"clap",
	"tomLow",
	"bongoHigh",
	"cuicaOpen",
	"whistleLong",
	"syndrum",
	"guiroLong",
	"triangleOpen",
	"starChime",
	"tambourine",
	"agogoHigh",
	"crash",
	"cabasa"
]) {
	it("scales velocity and length while retaining absolute scheduling for " + part, () => {
		vi.spyOn(Math, "random").mockReturnValue(0.5)
		const first = setup()
		const second = setup()
		first.synth.trigger({ part, velocity: 1, triggerAt: 12 })
		second.synth.trigger({ part, velocity: 0.5, triggerAt: 12, lengthScale: 2 })
		expect(second.sources).toHaveLength(first.sources.length)
		for (const [index, source] of second.sources.entries()) {
			expect(source.start).toHaveBeenCalledWith(12)
			const original = first.sources[index].stop.mock.calls[0][0] as number
			expect(source.stop.mock.calls[0][0]).toBeGreaterThan(original)
		}
		const peak = (gains: typeof first.gains) =>
			Math.max(
				...gains
					.slice(5)
					.flatMap((gain) => [
						...gain.gain.setValueAtTime.mock.calls.map(([value]) => value),
						...gain.gain.exponentialRampToValueAtTime.mock.calls.map(([value]) => value)
					])
			)
		// Triangle mode gains are independent of velocity; its audible envelope is downstream.
		if (part !== "triangleOpen") {
			expect(peak(second.gains)).toBeLessThan(peak(first.gains))
		}
		first.synth.destroy()
		second.synth.destroy()
	})
}

it("tunes modal pitches and filters without changing source start times", () => {
	vi.spyOn(Math, "random").mockReturnValue(0.5)
	for (const part of [
		"tomHigh",
		"cuicaMute",
		"whistleShort",
		"triangleMute",
		"agogoLow",
		"guiroShort",
		"crash",
		"maracas"
	]) {
		const first = setup()
		const second = setup()
		first.synth.trigger({ part, velocity: 1, triggerAt: 12 })
		second.synth.trigger({ part, velocity: 1, triggerAt: 12, tuningNote: 69 })
		const ratio = 440 / 42
		for (const [index, source] of second.sources.entries()) {
			expect(source.start).toHaveBeenCalledWith(12)
			if (source.kind === "oscillator") {
				expect(source.frequency.setValueAtTime.mock.calls[0][0]).toBeCloseTo(
					first.sources[index].frequency.setValueAtTime.mock.calls[0][0] * ratio
				)
			}
		}
		if (part === "crash" || part === "maracas") {
			expect(
				second.filters[0].frequency.setValueAtTime.mock.calls[0][0]
			).toBeGreaterThanOrEqual(first.filters[0].frequency.setValueAtTime.mock.calls[0][0])
		}
		first.synth.destroy()
		second.synth.destroy()
	}
})

it("keeps named aliases distinct even when they share a GM note", () => {
	const { synth, sources } = setup()
	for (const part of [
		"tomMid",
		"syndrum",
		"tomMidHigh",
		"laserTom",
		"rideBell",
		"metalHit",
		"clap",
		"fingerSnap"
	]) {
		const before = sources.length
		synth.trigger({ part, velocity: 1, triggerAt: 12 })
		const voices = sources.slice(before)
		expect(voices.length).toBeGreaterThan(0)
		if (part === "syndrum" || part === "laserTom" || part === "metalHit") {
			expect(voices).toHaveLength(3)
			expect(voices[2].kind).toBe("buffer")
		}
	}
	synth.destroy()
})

it("ignores unknown, silent and nonfinite velocity hits and clamps past starts", () => {
	const { synth, sources } = setup()
	for (const velocity of [0, -1, NaN, Infinity]) {
		synth.trigger({ part: "guiroLong", velocity, triggerAt: 12 })
	}
	synth.trigger({ part: "unknown", velocity: 1, triggerAt: 12 })
	expect(sources).toHaveLength(0)
	synth.trigger({ part: "cuicaOpen", velocity: 1, triggerAt: 2 })
	expect(sources[0].start).toHaveBeenCalledWith(10)
	synth.destroy()
})