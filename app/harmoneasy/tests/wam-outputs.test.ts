import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import OutputWAM2 from "../../../packages/audiobus/io/outputs/output-wam2"
import OutputYoshimi from "../../../packages/audiobus/io/outputs/output-yoshimi"
import { yoshimiAsset } from "../../../packages/audiobus/wam/yoshimi-assets"
import registry, { WAM2_INSTRUMENTS } from "../../../packages/audiobus/wam/registry"
import { WAM_MIDI_EVENT } from "../../../packages/audiobus/wam/host"
import { midiToCommand } from "../../../packages/audiobus/midi/midi-command-conversion"
import { deviceDefinition } from "../../../packages/audiobus/io/device-definition"
import { createOutputById } from "../../../packages/audiobus/io/output-factory"

const host = vi.hoisted(() => ({ initialize: vi.fn(async () => "host-group") }))
vi.mock("../../../packages/audiobus/wam/host", () => ({
	initializeHost: host.initialize,
	WAM_MIDI_EVENT: "wam-midi"
}))
vi.mock("../../../packages/audiobus/wam/yoshimi-assets", () => ({
	loadYoshimi: vi.fn(),
	yoshimiAsset: vi.fn()
}))
const gain = () => ({ connect: vi.fn(), disconnect: vi.fn() })
const context = () => ({ currentTime: 12, destination: {}, createGain: vi.fn(gain) }) as any
const plugin = () => ({
	descriptor: { name: "Test synth" },
	audioNode: { ...gain(), scheduleEvents: vi.fn(), destroy: vi.fn() }
})
class TestOutput extends OutputWAM2 {
	plugins = [plugin(), plugin()]
	calls: string[] = []
	protected async createPlugin(url: string) {
		this.calls.push(url)
		return this.plugins[this.calls.length - 1]
	}
}
beforeEach(() => vi.stubGlobal("AudioWorkletNode", class {}))
afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe("WAM outputs", () => {
	it("loads Yoshimi presets into independent parts and rejects unsafe part indexes", async () => {
		const postMessage = vi.fn()
		vi.stubGlobal(
			"AudioWorkletNode",
			class {
				port = { postMessage, close: vi.fn() }
				connect = vi.fn()
				disconnect = vi.fn()
			}
		)
		vi.mocked(yoshimiAsset).mockImplementation((path) => path)
		vi.stubGlobal(
			"fetch",
			vi.fn(async (path: string) =>
				path.endsWith("root.json")
					? { text: async () => "[]" }
					: {
							ok: true,
							arrayBuffer: async () =>
								new TextEncoder().encode("<instrument/>").buffer
						}
			)
		)
		const output = new OutputYoshimi(context(), undefined, null)
		await output.connect()
		await output.loadPreset("Organ", "organ.xiz", 1)
		expect(postMessage).toHaveBeenLastCalledWith({
			type: "msg",
			verb: "set",
			prop: "patch1",
			data: "<instrument/>"
		})
		await output.loadPreset("SynthPiano", "piano.xiz")
		expect(postMessage).toHaveBeenLastCalledWith({
			type: "msg",
			verb: "set",
			prop: "patch0",
			data: "<instrument/>"
		})
		for (const part of [-1, 16, 0.5, NaN]) {
			await expect(output.loadPreset("Organ", "organ.xiz", part)).rejects.toThrow(RangeError)
		}
		await output.destroy()
	})
	it("routes actual audio through a stable output and switches/destroys plugins", async () => {
		const ctx = context(),
			mixer = {}
		const output = new TestOutput(ctx, "https://example.com/first.js", undefined, mixer as any)
		const bus = output.output
		expect((bus as any).connect).toHaveBeenCalledWith(mixer)
		await Promise.all([output.connect(), output.connect()])
		expect(output.calls).toHaveLength(1)
		expect(output.plugins[0].audioNode.connect).toHaveBeenCalledWith(bus)
		await output.loadPlugin(WAM2_INSTRUMENTS[0])
		expect(output.plugins[0].audioNode.destroy).toHaveBeenCalledOnce()
		expect(output.output).toBe(bus)
		expect(output.plugins[1].audioNode.connect).toHaveBeenCalledWith(bus)
		expect(output.options.pluginUrl).toContain("/community/plugins/")
		await output.destroy()
		expect(output.plugins[1].audioNode.destroy).toHaveBeenCalledOnce()
		expect((bus as any).disconnect).toHaveBeenCalledOnce()
	})
	it("preserves integer velocities, MIDI channels, pitch bends and panic across all channels", async () => {
		const output = new TestOutput(context(), "https://example.com/synth.js")
		await output.connect()
		const send = output.plugins[0].audioNode.scheduleEvents
		output.noteOn(60, 80)
		expect(send).toHaveBeenLastCalledWith({
			type: WAM_MIDI_EVENT,
			time: 12,
			data: { bytes: [0x90, 60, 80] }
		})
		output.sendCommand(midiToCommand([0x92, 60, 100], 0, "keyboard")!)
		expect(output.getActiveNoteCount()).toBe(2)
		output.sendCommand(midiToCommand([0xe2, 0, 64], 0, "keyboard")!)
		expect(send).toHaveBeenLastCalledWith(
			expect.objectContaining({ data: { bytes: [0xe2, 0, 64] } })
		)
		output.noteOff(60)
		expect(output.getActiveNoteCount()).toBe(1)
		output.allNotesOff()
		expect(output.getActiveNoteCount()).toBe(0)
		expect(send).toHaveBeenLastCalledWith(
			expect.objectContaining({ data: { bytes: [0xbf, 120, 0] } })
		)
		await output.disconnect()
		send.mockClear()
		output.noteOn(60, 80)
		expect(send).not.toHaveBeenCalled()
	})
	it("supplies and releases a silent stereo input for synths that require audio input", async () => {
		const source = { ...gain(), offset: { value: 1 }, start: vi.fn(), stop: vi.fn() }
		const ctx = context()
		ctx.createConstantSource = vi.fn(() => source)
		const output = new TestOutput(ctx, "https://example.com/synth.js")
		Object.assign(output.plugins[0].audioNode, { numberOfInputs: 1 })
		await output.connect()
		expect(source.offset.value).toBe(0)
		expect(source.start).toHaveBeenCalledOnce()
		const input = source.connect.mock.calls[0][0]
		expect(input.channelCount).toBe(2)
		expect(input.channelCountMode).toBe("explicit")
		expect(input.connect).toHaveBeenCalledWith(output.plugins[0].audioNode)
		await output.destroy()
		expect(source.stop).toHaveBeenCalledOnce()
		expect(input.disconnect).toHaveBeenCalledOnce()
	})
	it("registers WAM, WAM2 and every catalog instrument with restorable options", async () => {
		for (const id of ["wam", "wam2", ...WAM2_INSTRUMENTS.map((p) => `wam2:${p.identifier}`)]) {
			const output = await createOutputById(id, { audioContext: context() })
			expect(output.hasAudioOutput?.()).toBe(true)
			expect(deviceDefinition(output).type).toBe(id)
			await (output as any).destroy()
		}
	})
	it("resolves catalog paths against the real plugin directory and keeps fallback instruments on failure", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("offline")
			})
		)
		expect(registry.getPluginUrl(WAM2_INSTRUMENTS[0])).toBe(
			"https://www.webaudiomodules.com/community/plugins/burns-audio/soundfont/index.js"
		)
		await Promise.all([registry.initialize(), registry.initialize()])
		expect(registry.getInstruments()).toHaveLength(WAM2_INSTRUMENTS.length)
		await registry.initialize()
		expect(fetch).toHaveBeenCalledTimes(2)
		expect(registry.getPluginUrl({ ...WAM2_INSTRUMENTS[0], path: "legacy:yoshimi" })).toBe(
			"legacy:yoshimi"
		)
	})
})