import { expect, it, vi } from "vitest"
import { OutputAudioRouting } from "../../../packages/audiobus/io/output-audio-routing"
import OutputImpulseResponse from "../../../packages/audiobus/effects/effect-impulse-response"
import OutputManager from "../../../packages/audiobus/io/output-manager"
import { defineDevice, deviceDefinition } from "../../../packages/audiobus/io/device-definition"
import { EVENT_CONNECTION_CHANGED } from "../../../packages/audiobus/events/event-constants"
import { getStructure } from "../source/components/graph/layout"

function audio() {
	const context: any = { state: "running", sampleRate: 100, createAnalyser() {} }
	const node = () => {
		const targets = new Set<any>()
		const result: any = {
			context,
			targets,
			gain: { value: 1, setTargetAtTime() {} },
			connect(target: any) {
				targets.add(target)
				return target
			},
			disconnect(target?: any) {
				if (!target) {
					targets.clear()
				} else if (!targets.delete(target)) {
					throw new Error("No connection")
				}
			}
		}
		return result
	}
	context.createGain = node
	context.createConvolver = node
	context.createBuffer = () => ({ getChannelData: () => new Float32Array(100) })
	context.decodeAudioData = vi.fn(async () => ({ duration: 1 }))
	context.destination = node()
	return { context, node, mixer: node() }
}
function setup() {
	const { context, node, mixer } = audio()
	const source: any = Object.assign(new EventTarget(), {
		name: "Synth",
		output: node(),
		noteOn() {},
		noteOff() {},
		allNotesOff() {}
	})
	source.output.connect(mixer)
	const first = new OutputImpulseResponse(context)
	const second = new OutputImpulseResponse(context)
	const outputManager = new OutputManager()
	;[source, first, second].forEach((output) => outputManager.add(output))
	const chain: any = {
		get outputs() {
			return outputManager.outputs
		},
		outputManager,
		isActive: true,
		inputs: [],
		transformers: [],
		options: {}
	}
	const routing = new OutputAudioRouting(mixer)
	const sync = () => routing.sync([chain])
	return { context, node, mixer, source, first, second, chain, routing, outputManager, sync }
}

it("routes instruments through successive processors with no dry bypass and preserves analyser taps", () => {
	const { source, first, second, routing, mixer, node, sync } = setup()
	const tap = node()
	source.output.connect(tap)
	sync()
	sync()
	expect(source.output.targets).toEqual(new Set([tap, routing.getChannel(source)]))
	expect((routing.getChannel(source) as any).targets).toEqual(new Set([first.audioInput]))
	expect((routing.getChannel(first) as any).targets).toEqual(new Set([second.audioInput]))
	expect((routing.getChannel(second) as any).targets).toEqual(new Set([mixer]))
})

it("bypasses disabled or removed processors and restores the original instrument destination", () => {
	const { source, first, second, routing, mixer, outputManager, sync } = setup()
	sync()
	outputManager.setEnabled(first, false)
	sync()
	expect((routing.getChannel(source) as any).targets).toEqual(new Set([second.audioInput]))
	outputManager.remove(first)
	outputManager.remove(second)
	sync()
	expect((routing.getChannel(source) as any).targets).toEqual(new Set([mixer]))
})

it("reorders processors without releasing notes and updates graph audio connections", () => {
	const { source, first, second, routing, outputManager, chain, sync } = setup()
	const release = vi.spyOn(outputManager, "allNotesOff")
	outputManager.moveAfter(first, second)
	sync()
	expect(release).not.toHaveBeenCalled()
	expect((routing.getChannel(source) as any).targets).toEqual(new Set([second.audioInput]))
	for (const mode of ["horizontal", "vertical"]) {
		const { nodes, edges } = getStructure(chain, true, true, mode)
		const find = (output: any) => nodes.find((node) => node.data.output === output)!
		const audio = edges.filter((edge) => edge.type === "audioSignal")
		expect(audio.map((edge) => [edge.source, edge.target])).toEqual([
			[find(source).id, find(second).id],
			[find(second).id, find(first).id],
			[find(first).id, nodes.find((node) => node.type === "speaker")!.id]
		])
		expect(
			edges.filter((edge) => edge.type !== "audioSignal" && edge.target === find(first).id)
		).toHaveLength(0)
	}
})

it("recaptures an instrument route after its engine reconnects", () => {
	const { source, mixer, routing, sync } = setup()
	sync()
	const channel = routing.getChannel(source)
	source.output.disconnect()
	source.output.connect(mixer)
	source.dispatchEvent(new Event(EVENT_CONNECTION_CHANGED))
	expect(routing.getChannel(source)).toBe(channel)
	expect(source.output.targets).toEqual(new Set([channel]))
})

it("prevents feedback when shared processors have conflicting orders in different chains", () => {
	const { first, second, source, routing, chain, mixer } = setup()
	const other = { ...chain, outputs: [source, second, first] }
	routing.sync([chain, other])
	expect((routing.getChannel(first) as any).targets).toEqual(new Set([second.audioInput, mixer]))
	expect((routing.getChannel(second) as any).targets).toEqual(new Set([mixer]))
})

it("persists and restores the impulse and wet mix, and retains the previous filter on decode failure", async () => {
	const { context } = audio()
	const output = defineDevice(await OutputImpulseResponse.create({ audioContext: context }), {
		factory: "output",
		type: "impulse-response"
	})
	output.setMix(0.75)
	await output.loadImpulse("AQID", "cabinet.wav")
	const saved = deviceDefinition(output)
	expect(saved.options).toEqual({
		mix: 0.75,
		impulse: "AQID",
		filename: "cabinet.wav",
		preset: ""
	})
	const restored = await OutputImpulseResponse.create({ ...saved.options, audioContext: context })
	expect(restored.options).toEqual(saved.options)
	context.decodeAudioData.mockRejectedValueOnce(new Error("Invalid audio"))
	await expect(restored.loadImpulse("BAUG", "broken.wav")).rejects.toThrow("Invalid audio")
	expect(restored.options.filename).toBe("cabinet.wav")
	await output.destroy()
	await restored.destroy()
})