import { afterEach, describe, expect, it, vi } from "vitest"
import OutputMonotron from "../../../packages/audiobus/io/outputs/output-monotron.ts"
import OutputWaveguide from "../../../packages/audiobus/io/outputs/output-waveguide.ts"
import OutputMultiOscillator from "../../../packages/audiobus/io/outputs/output-multi-oscillator.ts"
import {
	NOTE_ON,
	PITCH_BEND,
	CONTROL_CHANGE,
	MIDI_STOP,
	PLAYBACK_STOP
} from "../../../packages/audiobus/commands/commands.ts"
import { musicalCommand } from "../../../packages/audiobus/io/event-clip.ts"
import { EVENT_CONFIGURATION_CHANGED } from "../../../packages/audiobus/events/event-constants.ts"
import { setAudioDestination } from "../../../packages/audiobus/io/audio-destination.ts"

function setup() {
	const parameter = () => ({
		value: 0,
		setValueAtTime: vi.fn(),
		setTargetAtTime: vi.fn(),
		linearRampToValueAtTime: vi.fn(),
		cancelScheduledValues: vi.fn(),
		cancelAndHoldAtTime: vi.fn()
	})
	const nodes: ReturnType<typeof node>[] = []
	function node(): { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> } {
		const result = { connect: vi.fn(), disconnect: vi.fn() }
		nodes.push(result)
		return result
	}
	const sources: ReturnType<typeof source>[] = []
	function source(): ReturnType<typeof node> & {
		frequency: ReturnType<typeof parameter>
		detune: ReturnType<typeof parameter>
		start: ReturnType<typeof vi.fn>
		stop: ReturnType<typeof vi.fn>
		setPeriodicWave: ReturnType<typeof vi.fn>
		type: string
		loop: boolean
		buffer: AudioBuffer | null
		onended: (() => void) | null
	} {
		const result = {
			...node(),
			frequency: parameter(),
			detune: parameter(),
			start: vi.fn(),
			stop: vi.fn(),
			setPeriodicWave: vi.fn(),
			type: "sine",
			loop: false,
			buffer: null,
			onended: null as (() => void) | null
		}
		sources.push(result)
		return result
	}
	const gains: ReturnType<typeof gain>[] = []
	function gain(): ReturnType<typeof node> & { gain: ReturnType<typeof parameter> } {
		const result = { ...node(), gain: parameter() }
		gains.push(result)
		return result
	}
	const delays: ReturnType<typeof delay>[] = []
	function delay(): ReturnType<typeof node> & { delayTime: ReturnType<typeof parameter> } {
		const result = { ...node(), delayTime: parameter() }
		delays.push(result)
		return result
	}
	const filters: ReturnType<typeof filter>[] = []
	function filter(): ReturnType<typeof node> & {
		frequency: ReturnType<typeof parameter>
		Q: ReturnType<typeof parameter>
		type: string
	} {
		const result = { ...node(), frequency: parameter(), Q: parameter(), type: "lowpass" }
		filters.push(result)
		return result
	}
	const destination = node()
	const mixer = node()
	const context = {
		currentTime: 10,
		sampleRate: 48000,
		state: "running",
		destination,
		resume: vi.fn(async () => {
			context.state = "running"
		}),
		createGain: gain,
		createOscillator: source,
		createBufferSource: source,
		createDelay: delay,
		createBiquadFilter: filter,
		createPeriodicWave: vi.fn(() => ({})),
		createBuffer: (_channels: number, length: number) => ({
			getChannelData: () => new Float32Array(length)
		})
	}
	const advance = (seconds: number) => {
		context.currentTime += seconds
		vi.advanceTimersByTime(seconds * 1000)
	}
	return {
		context,
		audioContext: context as unknown as AudioContext,
		mixer: mixer as unknown as AudioNode,
		sources,
		nodes,
		gains,
		filters,
		delays,
		advance
	}
}

const devices: { destroy(): void }[] = []
afterEach(() => {
	for (const device of devices.splice(0)) {
		device.destroy()
	}
	vi.useRealTimers()
})

for (const Output of [OutputMonotron, OutputWaveguide, OutputMultiOscillator]) {
	describe(Output.name, () => {
		function create(options = {}) {
			vi.useFakeTimers()
			const audio = setup()
			const output = new Output({
				audioContext: audio.audioContext,
				mixer: audio.mixer,
				...options
			})
			devices.push(output)
			return { ...audio, output }
		}
		it("requires a context and connects to the selected destination", () => {
			expect(() => new Output(undefined!)).toThrow("audio context")
			const { output, mixer, audioContext } = create()
			expect(output.output.connect).toHaveBeenCalledWith(mixer)
			setAudioDestination(audioContext, mixer)
			const routed = new Output({ audioContext })
			devices.push(routed)
			expect(routed.output.connect).toHaveBeenCalledWith(mixer)
			expect(output.hasAudioOutput()).toBe(true)
			expect(output.hasMidiOutput()).toBe(false)
		})
		it("starts sources, attacks from silence, releases mid-attack and cleans every voice node", () => {
			const { output, sources, gains, nodes, advance } = create({ attack: 1, release: 0.1 })
			output.noteOn(69, 127)
			expect(sources.length).toBeGreaterThan(0)
			for (const source of sources) {
				expect(source.start).toHaveBeenCalledWith(10)
			}
			const envelope = gains[1].gain
			expect(envelope.setValueAtTime).toHaveBeenCalledWith(0, 10)
			expect(envelope.linearRampToValueAtTime).toHaveBeenCalledWith(1, 11)
			advance(0.25)
			output.noteOff(69)
			expect(envelope.setValueAtTime).toHaveBeenLastCalledWith(0.25, 10.25)
			expect(envelope.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 10.35)
			expect(sources[0].disconnect).not.toHaveBeenCalled()
			advance(0.2)
			for (const node of nodes.slice(3)) {
				expect(node.disconnect).toHaveBeenCalled()
			}
		})
		it("steals the oldest voice while keeping newer notes held", () => {
			const { output, sources, advance } = create({ maxPolyphony: 2 })
			output.noteOn(60, 100)
			const oldest = [...sources]
			output.noteOn(62, 100)
			const newer = sources.slice(oldest.length)
			output.noteOn(64, 100)
			expect(oldest.every((source) => source.stop.mock.calls.length === 1)).toBe(true)
			expect(newer.every((source) => source.stop.mock.calls.length === 0)).toBe(true)
			advance(0.02)
			expect(oldest.every((source) => source.disconnect.mock.calls.length > 0)).toBe(true)
			expect(newer.every((source) => source.disconnect.mock.calls.length === 0)).toBe(true)
		})
		it("bends the correct channel and retains bend for new notes", () => {
			const { output, sources, delays } = create()
			output.sendCommand(
				musicalCommand({ type: NOTE_ON, channel: 2, number: 69, velocity: 127 })
			)
			output.sendCommand(musicalCommand({ type: PITCH_BEND, channel: 1, value: 16383 }))
			const param = delays[0]?.delayTime ?? sources[0].frequency
			const before = param.setTargetAtTime.mock.calls.length
			output.sendCommand(musicalCommand({ type: PITCH_BEND, channel: 2, value: 12288 }))
			expect(param.setTargetAtTime.mock.calls.length).toBe(before + 1)
			const frequency = 440 * 2 ** (1 / 12)
			expect(param.setTargetAtTime.mock.lastCall![0]).toBeCloseTo(
				// A delay in a feedback loop cannot be shorter than one 128-frame render block
				Output === OutputWaveguide ? Math.max(128 / 48000, 1 / frequency) : frequency,
				10
			)
			output.sendCommand(
				musicalCommand({ type: NOTE_ON, channel: 2, number: 81, velocity: 127 })
			)
			const next = delays[1]?.delayTime ?? sources[2].frequency
			expect(next.setValueAtTime.mock.lastCall![0]).toBeCloseTo(
				Output === OutputWaveguide
					? Math.max(128 / 48000, 1 / (frequency * 2))
					: frequency * 2,
				10
			)
		})
		it("counts release tails toward the limit and steals them before newer held notes", () => {
			const { output, sources, advance } = create({ maxPolyphony: 2, release: 20 })
			output.noteOn(60, 100)
			const oldest = [...sources]
			advance(0.1)
			output.noteOff(60)
			output.noteOn(62, 100)
			output.noteOn(64, 100)
			expect(oldest[0].stop).toHaveBeenLastCalledWith(10.105)
			advance(0.02)
			expect(oldest.every((source) => source.disconnect.mock.calls.length > 0)).toBe(true)
			expect(
				sources.slice(oldest.length).every((source) => source.stop.mock.calls.length === 0)
			).toBe(true)
		})
		it("accepts note-offs for held notes after changing the channel filter", () => {
			const { output, sources } = create()
			output.sendCommand(
				musicalCommand({ type: NOTE_ON, channel: 1, number: 60, velocity: 100 })
			)
			output.configure({ channel: 2 })
			output.sendCommand(
				musicalCommand({ type: NOTE_ON, channel: 1, number: 60, velocity: 0 })
			)
			expect(sources.every((source) => source.stop.mock.calls.length > 0)).toBe(true)
		})
		it("honours sustain, velocity-zero note-off, channel volume and expression", () => {
			const { output, sources, gains, advance } = create()
			output.noteOn(60, 100)
			const cc = (number: number, value: number) =>
				output.sendCommand(
					musicalCommand({ type: CONTROL_CHANGE, channel: 1, number, value })
				)
			cc(7, 64)
			cc(11, 32)
			expect(gains[2].gain.setTargetAtTime).toHaveBeenLastCalledWith(
				(64 / 127) * (32 / 127),
				10,
				0.005
			)
			cc(64, 127)
			output.noteOn(60, 0)
			expect(sources[0].stop).not.toHaveBeenCalled()
			cc(64, 0)
			expect(sources[0].stop).toHaveBeenCalled()
			advance(1)
			expect(sources[0].disconnect).toHaveBeenCalled()
		})
		it.each(["allNotesOff", MIDI_STOP, PLAYBACK_STOP, 120, 123])(
			"silences held and sustained voices with %s",
			(command) => {
				const { output, sources, advance } = create()
				output.noteOn(60, 100)
				output.noteOn(64, 100)
				if (command === "allNotesOff") {
					output.allNotesOff()
				} else {
					output.sendCommand(
						musicalCommand(
							typeof command === "number"
								? { type: CONTROL_CHANGE, channel: 1, number: command, value: 0 }
								: { type: command }
						)
					)
				}
				expect(sources.every((source) => source.stop.mock.calls.length > 0)).toBe(true)
				advance(0.02)
				expect(sources.every((source) => source.disconnect.mock.calls.length > 0)).toBe(
					true
				)
			}
		)
		it("clamps configuration, emits changes, protects serialisable options and filters channels", () => {
			const { output, sources } = create()
			const changed = vi.fn()
			output.addEventListener(EVENT_CONFIGURATION_CHANGED, changed)
			output.configure({ volume: 9, attack: -1, release: NaN, maxPolyphony: 0, channel: 2 })
			expect(output.options).toMatchObject({
				volume: 1,
				attack: 0.001,
				maxPolyphony: 1,
				channel: 2
			})
			expect(changed).toHaveBeenCalledOnce()
			const options = output.options
			options.volume = 0
			expect(output.options.volume).toBe(1)
			expect(JSON.parse(JSON.stringify(output.options))).toEqual(output.options)
			output.sendCommand(
				musicalCommand({ type: NOTE_ON, channel: 1, number: 60, velocity: 100 })
			)
			expect(sources).toHaveLength(0)
			output.noteOn(60, 100)
			expect(sources.length).toBeGreaterThan(0)
			expect(output.getNoteKey(musicalCommand({ channel: 2, number: 60 }))).toBe("2:60")
		})
		it("waits for audio time before disconnecting a suspended release", () => {
			const { output, context, sources, advance } = create()
			output.noteOn(60, 100)
			output.noteOff(60)
			context.state = "suspended"
			vi.advanceTimersByTime(1000)
			expect(sources[0].disconnect).not.toHaveBeenCalled()
			context.state = "running"
			advance(1)
			expect(sources[0].disconnect).toHaveBeenCalled()
		})
		it("disconnects and reconnects once, then destroys every node and prevents new voices", async () => {
			const { output, sources, mixer, context } = create()
			output.noteOn(60, 100)
			await output.disconnect()
			expect(output.isConnected).toBe(false)
			expect(sources.every((source) => source.disconnect.mock.calls.length > 0)).toBe(true)
			context.state = "suspended"
			await output.connect()
			await output.connect()
			expect(context.resume).toHaveBeenCalledOnce()
			expect(output.output.connect).toHaveBeenCalledTimes(2)
			output.noteOn(62, 100)
			const count = sources.length
			output.destroy()
			output.noteOn(64, 100)
			await output.connect()
			expect(sources).toHaveLength(count)
			expect(output.isConnected).toBe(false)
			expect(output.output.disconnect).toHaveBeenCalled()
			expect(mixer.disconnect).not.toHaveBeenCalled()
			expect(sources.every((source) => source.disconnect.mock.calls.length > 0)).toBe(true)
		})
	})
}

it("routes the Monotron LFO into cutoff, with channel-local CC1 modulation", () => {
	const { audioContext, mixer, sources, gains, filters } = setup()
	const output = new OutputMonotron({ audioContext, mixer, lfoDepth: 100, lfoRate: 8 })
	devices.push(output)
	output.noteOn(69, 127)
	expect(sources[0].connect).toHaveBeenCalledWith(filters[0])
	expect(sources[1].frequency.setValueAtTime).toHaveBeenCalledWith(8, 10)
	expect(sources[1].connect).toHaveBeenCalledWith(gains[3])
	expect(gains[3].connect).toHaveBeenCalledWith(filters[0].frequency)
	output.sendCommand(musicalCommand({ type: CONTROL_CHANGE, channel: 1, number: 1, value: 127 }))
	expect(gains[3].gain.setTargetAtTime).toHaveBeenLastCalledWith(5100, 10, 0.005)
})

it("excites the waveguide with a finite bipolar noise burst and a filtered stable feedback loop", () => {
	const { audioContext, mixer, sources, gains, filters, delays } = setup()
	const output = new OutputWaveguide({ audioContext, mixer, feedback: 8, resonance: 10 })
	devices.push(output)
	output.noteOn(69, 127)
	expect(sources).toHaveLength(1)
	expect(sources[0].loop).toBe(false)
	expect(sources[0].buffer).not.toBeNull()
	expect(sources[0].connect).toHaveBeenCalledWith(delays[0])
	expect(delays[0].connect).toHaveBeenCalledWith(filters[0])
	expect(filters[0].connect).toHaveBeenCalledWith(gains[3])
	expect(gains[3].connect).toHaveBeenCalledWith(delays[0])
	expect(output.options).toMatchObject({ feedback: 0.999, resonance: 0.7 })
})

it.each([1, 2, 3])(
	"supports %s oscillators, detuning, custom waves and the triple sub-octave",
	(oscillators) => {
		const { audioContext, mixer, sources, context } = setup()
		const custom = { real: [0, 1, 0.5], imag: [0, 0, 0] }
		const output = new OutputMultiOscillator({
			audioContext,
			mixer,
			oscillators,
			shape: custom,
			shape2: "square",
			spread: 12
		})
		devices.push(output)
		custom.real[1] = 0
		output.noteOn(69, 127)
		expect(sources).toHaveLength(oscillators)
		expect(context.createPeriodicWave).toHaveBeenCalledWith(
			new Float32Array([0, 1, 0.5]),
			new Float32Array([0, 0, 0])
		)
		expect(sources[0].detune.setValueAtTime).toHaveBeenCalledWith(
			oscillators === 1 ? 0 : -12,
			10
		)
		if (oscillators > 1) {
			expect(sources[1].type).toBe("square")
		}
		if (oscillators === 3) {
			expect(sources[2].frequency.setValueAtTime).toHaveBeenCalledWith(220, 10)
		}
	}
)

it("starts optional synth noise, routes delay and cleans feedback nodes after release", () => {
	vi.useFakeTimers()
	const { audioContext, mixer, sources, nodes, delays, advance } = setup()
	const output = new OutputMultiOscillator({ audioContext, mixer, noise: 0.2, delayMix: 0.3 })
	devices.push(output)
	output.noteOn(60, 100)
	expect(sources).toHaveLength(3)
	expect(sources[2].loop).toBe(true)
	expect(sources[2].start).toHaveBeenCalledWith(10)
	expect(delays).toHaveLength(1)
	output.noteOff(60)
	advance(1)
	expect(nodes.slice(3).every((node) => node.disconnect.mock.calls.length > 0)).toBe(true)
})