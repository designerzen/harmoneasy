// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import { readFileSync } from "fs"
import Rompler from "../../../packages/audiobus/io/outputs/rompler/output-rompler"
import {
	noteName,
	sampleGrid,
	sampleUrl
} from "../../../packages/audiobus/io/outputs/rompler/rompler-catalogue"
import { defineDevice, deviceDefinition } from "../../../packages/audiobus/io/device-definition"
import { musicalCommand } from "../../../packages/audiobus/io/event-clip"
import {
	NOTE_ON,
	NOTE_OFF,
	PROGRAM_CHANGE,
	CONTROL_CHANGE
} from "../../../packages/audiobus/commands"

const outputs: Rompler[] = []
afterEach(() => {
	outputs.splice(0).forEach((output) => output.destroy())
	vi.unstubAllGlobals()
})
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const fixture = (options: Record<string, any> = {}) => {
	const nodes: any[] = []
	const requests: { url: string; signal: AbortSignal; resolve: () => void }[] = []
	vi.stubGlobal(
		"AudioWorkletNode",
		class {
			port = { postMessage: vi.fn(), close: vi.fn() }
			connect = vi.fn()
			disconnect = vi.fn()
			constructor() {
				nodes.push(this)
			}
		}
	)
	vi.stubGlobal(
		"fetch",
		vi.fn(
			(url: string, { signal }: RequestInit) =>
				new Promise((resolve) =>
					requests.push({
						url,
						signal: signal!,
						resolve: () =>
							resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) })
					})
				)
		)
	)
	const context = {
		currentTime: 0,
		state: "running",
		destination: {},
		audioWorklet: { addModule: vi.fn(async () => {}) },
		resume: vi.fn(async () => {}),
		createGain: () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }),
		decodeAudioData: vi.fn(async () => ({
			length: 4,
			sampleRate: 48000,
			numberOfChannels: 2,
			getChannelData: () => new Float32Array([0, 0.5, 1, -1])
		}))
	}
	const output = new Rompler({ ...options, audioContext: context })
	outputs.push(output)
	return { output, nodes, requests }
}
const cmd = (type: string, number = 60, value = 0) =>
	musicalCommand({ type, number, value, channel: 1, velocity: 127 })
const notes = (requests: { url: string }[]) =>
	requests.map(({ url }) => url.slice(url.lastIndexOf("/") + 1, -4))

it("maps the GM catalogue onto midi-js-soundfonts URLs", () => {
	expect(noteName(21)).toBe("A0")
	expect(noteName(61)).toBe("Db4")
	expect(noteName(108)).toBe("C8")
	expect(sampleGrid(1)).toHaveLength(88)
	expect(sampleGrid(3)).toContain(60)
	expect(sampleUrl("https://host/", "FluidR3_GM", 24, 60)).toBe(
		"https://host/FluidR3_GM/acoustic_guitar_nylon-mp3/C4.mp3"
	)
})

it("registers, persists its preset and downloads nothing until requested", async () => {
	const { output, requests } = fixture({ preset: 40, spacing: 2, pack: "MusyngKite" })
	const { OUTPUT_FACTORIES } = await import("../../../packages/audiobus/io/output-factory")
	expect(OUTPUT_FACTORIES.find((factory) => factory.id === "rompler")?.isAvailable()).toBe(true)
	defineDevice(output, { factory: "output", type: "rompler" })
	const saved = JSON.parse(JSON.stringify(deviceDefinition(output)))
	expect(saved.options).toMatchObject({ preset: 40, spacing: 2, pack: "MusyngKite" })
	expect(saved.options.audioContext).toBeUndefined()
	await output.createGui()
	expect(requests).toHaveLength(0)
})

it("loads outward from the played register with bounded concurrency", async () => {
	const { output, nodes, requests } = fixture({ spacing: 1 })
	await output.sendCommand(cmd(NOTE_ON, 72))
	expect(requests).toHaveLength(6)
	expect(notes(requests)[0]).toBe("C5")
	expect(nodes[0].port.postMessage).toHaveBeenCalledWith({
		type: "on",
		channel: 0,
		note: 72,
		velocity: 1
	})
	requests[0].resolve()
	await flush()
	const [message, transfer] = nodes[0].port.postMessage.mock.calls.find(
		([data]: any[]) => data.type === "sample"
	)
	// Identical stereo collapses to mono 16-bit PCM and is transferred, not copied
	expect(message.note).toBe(72)
	expect(Array.from(message.channels[0])).toEqual([0, 16383, 32767, -32767])
	expect(transfer).toEqual([message.channels[0].buffer])
	expect(requests).toHaveLength(7)
})

it("switches presets by cancelling downloads and keeps old samples until new ones land", async () => {
	const { output, nodes, requests } = fixture()
	await output.connect()
	requests[0].resolve()
	await flush()
	const port = nodes[0].port.postMessage
	expect(port.mock.calls.filter(([data]: any[]) => data.type === "clear")).toHaveLength(1)
	const first = requests.slice()
	await output.sendCommand(cmd(PROGRAM_CHANGE, 0, 33))
	expect(output.options.preset).toBe(33)
	expect(first.every(({ signal }) => signal.aborted)).toBe(true)
	expect(requests[first.length].url).toContain("/electric_bass_finger-mp3/")
	expect(port.mock.calls.filter(([data]: any[]) => data.type === "clear")).toHaveLength(1)
	requests[first.length].resolve()
	await flush()
	expect(port.mock.calls.filter(([data]: any[]) => data.type === "clear")).toHaveLength(2)
})

it("holds sustained notes until the pedal lifts", async () => {
	const { output, nodes } = fixture()
	await output.sendCommand(cmd(NOTE_ON, 60))
	await output.sendCommand(
		musicalCommand({ type: CONTROL_CHANGE, number: 64, value: 127, channel: 1 })
	)
	await output.sendCommand(cmd(NOTE_OFF, 60))
	const port = nodes[0].port.postMessage
	expect(port).not.toHaveBeenCalledWith({ type: "off", channel: 0, note: 60 })
	await output.sendCommand(
		musicalCommand({ type: CONTROL_CHANGE, number: 64, value: 0, channel: 1 })
	)
	expect(port).toHaveBeenCalledWith({ type: "off", channel: 0, note: 60 })
})

it("plays held notes once the first sample arrives, pitched from the nearest key", () => {
	const source = readFileSync(
		"../../packages/audiobus/io/outputs/rompler/rompler.worklet.js",
		"utf8"
	)
	const Processor = new Function(
		"AudioWorkletProcessor",
		"sampleRate",
		source.replace(/registerProcessor\([^\n]+/, "return RomplerProcessor")
	)(
		class {
			port = {}
		},
		48000
	)
	const processor = new Processor()
	const send = (data: object) => processor.port.onmessage({ data })
	const render = () => {
		const outputs = [[new Float32Array(128), new Float32Array(128)]]
		processor.process([], outputs)
		return outputs[0][0]
	}
	send({ type: "on", channel: 0, note: 62, velocity: 1 })
	expect(render().some(Boolean)).toBe(false)
	send({ type: "sample", note: 60, channels: [new Int16Array(48000).fill(16384)] })
	expect(processor.voices[0].rate).toBeCloseTo(2 ** (2 / 12))
	expect(render()[127]).toBeCloseTo(0.5, 2)
	send({ type: "off", channel: 0, note: 62 })
	send({ type: "release", value: 0.001 })
	render()
	render()
	expect(processor.voices).toHaveLength(0)
})