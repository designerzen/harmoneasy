// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import register from "../../../packages/audiobus/instruments/fm/processor.js"
import { FM_GENERAL_MIDI_PRESETS } from "../../../packages/audiobus/instruments/fm/presets"
import OutputFM from "../../../packages/audiobus/io/outputs/output-fm"
import { musicalCommand } from "../../../packages/audiobus/io/event-clip"
import { EVENT_CONFIGURATION_CHANGED } from "../../../packages/audiobus/events/event-constants"
import {
	NOTE_ON,
	NOTE_OFF,
	PROGRAM_CHANGE,
	PITCH_BEND,
	CONTROL_CHANGE,
	MIDI_STOP
} from "../../../packages/audiobus/commands/commands"

const RATE = 48000
const outputs: OutputFM[] = []
afterEach(() => {
	outputs.splice(0).forEach((output) => output.destroy())
	vi.unstubAllGlobals()
})

function processor(options: Record<string, unknown> = {}) {
	let Processor: any
	let name = ""
	vi.stubGlobal("sampleRate", RATE)
	vi.stubGlobal("currentTime", 0)
	vi.stubGlobal(
		"AudioWorkletProcessor",
		class {
			port: any = {}
		}
	)
	vi.stubGlobal("registerProcessor", (id: string, ctor: any) => {
		name = id
		Processor = ctor
	})
	new Function(`return (${register.toString()})`)()({ name: "harmoneasy-fm" })
	expect(name).toBe("harmoneasy-fm")
	const node = new Processor({ processorOptions: options })
	const send = (data: Record<string, unknown>) => node.port.onmessage({ data })
	let frame = 0
	const render = (frames: number) => {
		const out = new Float32Array(frames)
		for (let offset = 0; offset < frames; offset += 128) {
			const count = Math.min(128, frames - offset)
			const channels = [new Float32Array(count), new Float32Array(count)]
			vi.stubGlobal("currentTime", frame / RATE)
			node.process([], [channels], {})
			expect(channels[0]).toEqual(channels[1])
			out.set(channels[0], offset)
			frame += count
		}
		return out
	}
	const play = (program: number, note = 57, velocity = 80) => {
		send({ type: "patch", part: 0, patch: FM_GENERAL_MIDI_PRESETS[program] })
		send({ type: "on", part: 0, note, velocity: velocity / 127, time: frame / RATE })
	}
	return { node, send, render, play }
}
const peak = (samples: Float32Array) => samples.reduce((a, s) => Math.max(a, Math.abs(s)), 0)
const rms = (samples: Float32Array) =>
	Math.sqrt(samples.reduce((a, s) => a + s * s, 0) / samples.length)

it("ships a full General MIDI bank with the original names and level trims", () => {
	expect(FM_GENERAL_MIDI_PRESETS).toHaveLength(128)
	FM_GENERAL_MIDI_PRESETS.forEach((patch, program) => {
		expect(patch.program).toBe(program)
		expect(patch.name).toBeTruthy()
		expect(patch.operators).toHaveLength(6)
		expect(patch.levelTrim).toBeGreaterThan(0)
	})
	expect(FM_GENERAL_MIDI_PRESETS[0].name).toBe("Acoustic Grand Piano")
	expect(FM_GENERAL_MIDI_PRESETS[0].levelTrim).toBeCloseTo(10 ** (1.45 / 20), 10)
	expect(FM_GENERAL_MIDI_PRESETS[127].levelTrim).toBeCloseTo(10 ** (4.9 / 20), 10)
	expect(FM_GENERAL_MIDI_PRESETS[28].levelTrim).toBeCloseTo(10 ** (10 / 20), 10)
})

it("renders a finite, bounded, audible note that decays to silence after note off", () => {
	const { node, send, render, play } = processor()
	render(128)
	play(0)
	const sound = render(RATE)
	expect(sound.every((sample) => Number.isFinite(sample) && Math.abs(sample) <= 1.5)).toBe(true)
	expect(peak(sound)).toBeGreaterThan(0.01)
	send({ type: "off", part: 0, note: 57 })
	render(RATE)
	expect(render(RATE * 3).every((sample) => Math.abs(sample) < 1e-6)).toBe(true)
	expect(node.activeParts.size).toBe(0)
})

it("measures the level of a velocity 80 A3 on program 0", () => {
	const { play, render } = processor()
	render(128)
	play(0, 57, 80)
	const sound = render(RATE)
	console.log(`fm program 0 A3 velocity 80: peak ${peak(sound)} rms ${rms(sound)}`)
	expect(peak(sound)).toBeLessThan(1)
})

it("sounds different for different programs and stays finite and bounded across the bank", () => {
	const renders = [0, 40, 80, 110].map((program) => {
		const { play, render } = processor()
		render(128)
		play(program)
		const sound = render(8192)
		expect(peak(sound)).toBeGreaterThan(0.001)
		return sound
	})
	for (let a = 0; a < renders.length; a++) {
		for (let b = a + 1; b < renders.length; b++) {
			expect(renders[a]).not.toEqual(renders[b])
		}
	}
	for (const patch of FM_GENERAL_MIDI_PRESETS) {
		const { play, render } = processor()
		render(128)
		play(patch.program, 60, 127)
		const sound = render(6000)
		expect(sound.every((sample) => Number.isFinite(sample) && Math.abs(sample) <= 1.5)).toBe(
			true
		)
	}
	// Rendering all 128 programs is slow when the whole suite runs in parallel.
}, 60000)

it("keeps voices per note, caps polyphony, bends pitch, and honours panic and destroy", () => {
	const { node, send, render, play } = processor({ polyphony: 4 })
	render(128)
	for (const note of [48, 52, 55, 59, 62, 65]) {
		play(0, note)
	}
	render(256)
	expect(node.parts.get(0).voices.size).toBe(4)
	const flat = render(2048)
	send({ type: "bend", part: 0, value: 2, time: 0 })
	render(128)
	expect(render(2048)).not.toEqual(flat)
	send({ type: "gain", part: 0, value: 0 })
	expect(render(256).every((sample) => sample === 0)).toBe(true)
	send({ type: "gain", part: 0, value: 1 })
	send({ type: "panic" })
	expect(node.parts.get(0).voices.size).toBe(0)
	expect(render(256).every((sample) => sample === 0)).toBe(true)
	send({ type: "destroy" })
	expect(node.process([], [[new Float32Array(128)]], {})).toBe(false)
})

function fixture(options: Record<string, unknown> = {}) {
	const nodes: any[] = []
	const blobs: Blob[] = []
	vi.stubGlobal(
		"AudioWorkletNode",
		class {
			port = { postMessage: vi.fn(), close: vi.fn() }
			connect = vi.fn()
			disconnect = vi.fn()
			args: unknown[]
			constructor(...args: unknown[]) {
				this.args = args
				nodes.push(this)
			}
		}
	)
	vi.stubGlobal("URL", {
		createObjectURL: (blob: Blob) => (blobs.push(blob), "blob:fm"),
		revokeObjectURL: vi.fn()
	})
	const gain = { value: 1 }
	const disconnect = vi.fn()
	const addModule = vi.fn(async () => {})
	const context = {
		currentTime: 1.5,
		state: "running",
		resume: vi.fn(async () => {}),
		createGain: () => ({ gain, connect: vi.fn(), disconnect }),
		audioWorklet: { addModule }
	} as unknown as AudioContext
	const mixer = { connect: vi.fn() } as unknown as AudioNode
	const output = new OutputFM({ audioContext: context, mixer, ...options })
	outputs.push(output)
	const messages = () => nodes[0].port.postMessage.mock.calls.map(([message]: any[]) => message)
	return { output, nodes, blobs, gain, disconnect, addModule, context, mixer, messages }
}
const cmd = (fields: Record<string, unknown>) => musicalCommand({ channel: 1, ...fields } as any)

it("requires an audio context and connects its output to the mixer", () => {
	expect(() => new OutputFM({} as any)).toThrow(/audio context/)
	const { output, mixer, gain } = fixture({ volume: 0.5 })
	expect(output.output.connect).toHaveBeenCalledWith(mixer)
	expect(gain.value).toBe(0.5)
	expect(output.hasAudioOutput()).toBe(true)
	expect(output.hasMidiOutput()).toBe(false)
	expect(output.presets).toHaveLength(128)
	expect(output.presets[0]).toEqual({ program: 0, name: "Acoustic Grand Piano" })
})

it("loads the worklet lazily from self-contained source and posts notes with the selected patch", async () => {
	const { output, nodes, blobs, addModule, messages } = fixture({ preset: 3 })
	expect(addModule).not.toHaveBeenCalled()
	expect(nodes).toHaveLength(0)
	await output.noteOn(60, 127)
	expect(addModule).toHaveBeenCalledTimes(1)
	expect(nodes).toHaveLength(1)
	expect(nodes[0].args[1]).toBe("harmoneasy-fm")
	expect(nodes[0].args[2]).toMatchObject({ numberOfInputs: 0, outputChannelCount: [2] })
	const source = await blobs[0].text()
	const registered = vi.fn()
	vi.stubGlobal("registerProcessor", registered)
	vi.stubGlobal("AudioWorkletProcessor", class {})
	new Function(source)()
	expect(registered).toHaveBeenCalledWith("harmoneasy-fm", expect.any(Function))
	const [patch, on] = messages()
	expect(patch).toMatchObject({ type: "patch", part: 0 })
	expect(patch.patch.program).toBe(3)
	expect(on).toMatchObject({ type: "on", part: 0, note: 60, velocity: 1, time: 1.5 })
	output.noteOff(60)
	await Promise.resolve()
	expect(messages().at(-1)).toMatchObject({ type: "off", part: 0, note: 60 })
	await output.noteOn(61, 0)
	expect(messages().at(-1)).toMatchObject({ type: "off", note: 61 })
	// Same patch is not resent for every note
	await output.noteOn(62, 64)
	await output.noteOn(63, 64)
	expect(messages().filter((m: any) => m.type === "patch")).toHaveLength(1)
})

it("switches patch on program change and per-channel state on control changes", async () => {
	const { output, messages } = fixture()
	await output.sendCommand(cmd({ type: PROGRAM_CHANGE, value: 40, number: 0 }))
	expect(output.options.preset).toBe(40)
	await output.sendCommand(cmd({ type: NOTE_ON, number: 64, velocity: 100, channel: 2 }))
	const patch = messages().find((m: any) => m.type === "patch")
	expect(patch).toMatchObject({ part: 1 })
	expect(patch.patch.program).toBe(40)
	expect(patch.patch.name).toBe(FM_GENERAL_MIDI_PRESETS[40].name)
	await output.sendCommand(cmd({ type: PROGRAM_CHANGE, value: 41, number: 0 }))
	await output.sendCommand(cmd({ type: NOTE_ON, number: 65, velocity: 100, channel: 2 }))
	expect(
		messages()
			.filter((m: any) => m.type === "patch")
			.at(-1).patch.program
	).toBe(41)

	await output.sendCommand(cmd({ type: PITCH_BEND, value: 16383 }))
	expect(messages().at(-1).value).toBeCloseTo(2 * (8191 / 8192))
	output.configure({ pitchBendRange: 12 })
	await output.sendCommand(cmd({ type: PITCH_BEND, value: 0 }))
	expect(messages().at(-1)).toMatchObject({ type: "bend", part: 0, value: -12 })

	await output.sendCommand(cmd({ type: CONTROL_CHANGE, number: 7, value: 127 / 2 }))
	await output.sendCommand(cmd({ type: CONTROL_CHANGE, number: 11, value: 127 / 2 }))
	expect(messages().at(-1).value).toBeCloseTo((63.5 / 127) ** 2)

	await output.sendCommand(cmd({ type: CONTROL_CHANGE, number: 64, value: 127 }))
	await output.sendCommand(cmd({ type: NOTE_ON, number: 70, velocity: 100 }))
	const before = messages().length
	await output.sendCommand(cmd({ type: NOTE_OFF, number: 70 }))
	expect(messages()).toHaveLength(before)
	await output.sendCommand(cmd({ type: CONTROL_CHANGE, number: 64, value: 0 }))
	expect(messages().at(-1)).toMatchObject({ type: "off", part: 0, note: 70 })

	await output.sendCommand(cmd({ type: CONTROL_CHANGE, number: 123, value: 0 }))
	expect(messages().at(-1)).toMatchObject({ type: "panic", part: 0 })
})

it("panics on stop, ignores commands while disconnected, and closes the port on destroy", async () => {
	const { output, nodes, disconnect, messages } = fixture()
	await output.connect()
	expect(nodes).toHaveLength(1)
	await output.sendCommand(cmd({ type: MIDI_STOP }))
	expect(messages().at(-1)).toEqual({ type: "panic" })
	await output.disconnect()
	const count = messages().length
	await output.noteOn(60, 100)
	expect(
		messages()
			.slice(count)
			.filter((m: any) => m.type === "on")
	).toHaveLength(0)
	output.destroy()
	expect(messages().at(-1)).toEqual({ type: "destroy" })
	expect(nodes[0].port.close).toHaveBeenCalled()
	expect(nodes[0].disconnect).toHaveBeenCalled()
	expect(disconnect).toHaveBeenCalled()
	expect(output.isConnected).toBe(false)
})

it("serialises options, dispatches configuration changes and builds a gui", async () => {
	const { output, gain } = fixture()
	const changed = vi.fn()
	output.addEventListener(EVENT_CONFIGURATION_CHANGED, changed)
	output.configure({ volume: 9, preset: 200, pitchBendRange: 5 })
	expect(output.options).toEqual({ preset: 127, volume: 2, pitchBendRange: 5, polyphony: 16 })
	expect(JSON.parse(JSON.stringify(output.options))).toEqual(output.options)
	expect(gain.value).toBe(2)
	output.loadPreset(10)
	expect(changed).toHaveBeenCalledTimes(2)
	const gui = await output.createGui()
	expect(await output.createGui()).toBe(gui)
	const select = gui.querySelector("select")!
	expect(select.options).toHaveLength(128)
	expect(select.value).toBe("10")
	select.value = "20"
	select.dispatchEvent(new Event("change"))
	expect(output.options.preset).toBe(20)
	expect(gui.querySelectorAll("input[type=number]")).toHaveLength(2)
	await output.destroyGui()
	expect(gui.isConnected).toBe(false)
})