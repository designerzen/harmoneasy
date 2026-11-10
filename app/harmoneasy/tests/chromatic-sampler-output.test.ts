// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import OutputSampler from "../../../packages/audiobus/io/outputs/output-chromatic-sampler"
import { defineDevice, deviceDefinition } from "../../../packages/audiobus/io/device-definition"
import { musicalCommand } from "../../../packages/audiobus/io/event-clip"
import { NOTE_ON, NOTE_OFF, PITCH_BEND, CONTROL_CHANGE } from "../../../packages/audiobus/commands"

const outputs: OutputSampler[] = []
afterEach(() => {
	outputs.splice(0).forEach((output) => output.destroy())
	vi.unstubAllGlobals()
})
const fixture = (options: Record<string, any> = {}) => {
	const nodes: any[] = []
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
	const context = {
		currentTime: 10,
		state: "running",
		destination: {},
		audioWorklet: { addModule: vi.fn(async () => {}) },
		resume: vi.fn(async () => {}),
		createGain: () => ({
			gain: { value: 1, setTargetAtTime: vi.fn() },
			connect: vi.fn(),
			disconnect: vi.fn()
		}),
		decodeAudioData: vi.fn(async () => ({
			length: 1024,
			duration: 1024 / 48000,
			sampleRate: 48000,
			numberOfChannels: 2,
			getChannelData: () => new Float32Array(1024).fill(0.5)
		}))
	}
	const output = new OutputSampler({ ...options, audioContext: context })
	outputs.push(output)
	const file = {
		name: "voice.wav",
		size: 3,
		arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
	} as File
	return { output, context, nodes, file }
}
const cmd = (type: string, number = 60, channel = 1, value = 0) =>
	musicalCommand({ type, number, channel, value, velocity: 100 })

it("registers as an available Output and persists serializable sample layers", async () => {
	const { output, file, context } = fixture()
	const { OUTPUT_FACTORIES } = await import("../../../packages/audiobus/io/output-factory")
	expect(
		OUTPUT_FACTORIES.find((factory) => factory.id === "chromatic-sampler")?.isAvailable()
	).toBe(true)
	defineDevice(output, { factory: "output", type: "chromatic-sampler" })
	await output.loadSample(60, 2, file)
	output.updateLayer(60, 2, { start: 0.25, loop: true, attack: 0.1 })
	const saved = JSON.parse(JSON.stringify(deviceDefinition(output)))
	expect(saved.options.layers["60"][2]).toMatchObject({
		sample: "AQID",
		name: "voice.wav",
		start: 0.25,
		loop: true,
		attack: 0.1
	})
	expect(saved.options.layers["60"][2].channels).toBeUndefined()
	expect(saved.options.audioContext).toBeUndefined()
	const restored = new OutputSampler({ ...saved.options, audioContext: context })
	outputs.push(restored)
	await restored.connect()
	expect(restored.getLayers(60)[2].channels?.[0][0]).toBe(0.5)
	expect(restored.getLayers(60)[2].start).toBe(0.25)
})

it("routes notes and bends independently per MIDI channel", async () => {
	const { output, file, nodes } = fixture()
	await output.loadSample(60, 0, file)
	await output.sendCommand(cmd(NOTE_ON, 60, 2))
	await output.sendCommand(cmd(NOTE_ON, 60, 3))
	await output.sendCommand(cmd(PITCH_BEND, 0, 2, 12288))
	await output.sendCommand(cmd(NOTE_OFF, 60, 2))
	expect(nodes[0].port.postMessage).toHaveBeenCalledWith({
		type: "on",
		part: 1,
		note: 60,
		velocity: 100 / 127,
		time: 10
	})
	expect(nodes[0].port.postMessage).toHaveBeenCalledWith({
		type: "on",
		part: 2,
		note: 60,
		velocity: 100 / 127,
		time: 10
	})
	expect(nodes[0].port.postMessage).toHaveBeenCalledWith({
		type: "bend",
		part: 1,
		value: 1,
		time: 10
	})
	expect(nodes[0].port.postMessage).toHaveBeenCalledWith({
		type: "off",
		part: 1,
		note: 60,
		time: 10
	})
})

it("cancels a released note while worklet initialization is pending", async () => {
	const { output, context, nodes } = fixture()
	let ready!: () => void
	context.audioWorklet.addModule.mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				ready = resolve
			})
	)
	const pending = output.sendCommand(cmd(NOTE_ON))
	await output.sendCommand(cmd(NOTE_OFF))
	ready()
	await pending
	expect(
		nodes[0].port.postMessage.mock.calls.some(([message]: any[]) => message.type === "on")
	).toBe(false)
})

it("supports sustain, expression, channel panic, and disconnect", async () => {
	const { output, nodes } = fixture()
	await output.connect()
	nodes[0].port.postMessage.mockClear()
	await output.sendCommand(cmd(CONTROL_CHANGE, 64, 2, 127))
	await output.sendCommand(cmd(NOTE_OFF, 60, 2))
	expect(nodes[0].port.postMessage).not.toHaveBeenCalled()
	await output.sendCommand(cmd(CONTROL_CHANGE, 64, 2, 0))
	expect(nodes[0].port.postMessage).toHaveBeenCalledWith({
		type: "off",
		part: 1,
		note: 60,
		time: 10
	})
	await output.sendCommand(cmd(CONTROL_CHANGE, 120, 2, 0))
	expect(nodes[0].port.postMessage).toHaveBeenCalledWith({ type: "panic", part: 1 })
	await output.disconnect()
	nodes[0].port.postMessage.mockClear()
	await output.sendCommand(cmd(NOTE_ON))
	expect(nodes[0].port.postMessage).not.toHaveBeenCalled()
})

it("retains old samples after decode errors and prevents a cleared slot being filled by a late decode", async () => {
	const { output, file, context } = fixture()
	await output.loadSample(60, 0, file)
	context.decodeAudioData.mockRejectedValueOnce(Error("Invalid audio"))
	await expect(output.loadSample(60, 0, file)).rejects.toThrow("Invalid audio")
	expect(output.getLayers(60)[0].channels).toBeDefined()
	let decode!: (value: any) => void
	context.decodeAudioData.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				decode = resolve
			})
	)
	const pending = output.loadSample(60, 0, file)
	await Promise.resolve()
	output.clearLayer(60, 0)
	decode({
		length: 16,
		duration: 1,
		sampleRate: 48000,
		numberOfChannels: 1,
		getChannelData: () => new Float32Array(16)
	})
	await pending
	expect(output.getLayers(60)[0].channels).toBeUndefined()
	expect(output.options.layers["60"][0].sample).toBeUndefined()
})

it("sends settings without resending sample data and destroys GUI and audio resources", async () => {
	const { output, file, nodes } = fixture()
	await output.loadSample(60, 0, file)
	await output.connect()
	output.updateLayer(60, 0, { cutoff: 200 })
	const message = nodes[0].port.postMessage.mock.calls.at(-1)[0]
	expect(message.layer.channels).toBeUndefined()
	expect(message.layer.sample).toBeUndefined()
	const gui = await output.createGui()
	document.body.append(gui)
	expect(gui.querySelectorAll("[data-sampler-layer]")).toHaveLength(4)
	await output.destroyGui()
	expect(gui.isConnected).toBe(false)
	output.destroy()
	expect(nodes[0].port.close).toHaveBeenCalled()
	expect(nodes[0].disconnect).toHaveBeenCalled()
})