// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import {
	createInputById,
	getAvailableInputFactories
} from "../../../packages/audiobus/io/input-factory"
import {
	createOutputById,
	getAvailableOutputFactories
} from "../../../packages/audiobus/io/output-factory"
import { INPUT_DEFINITIONS } from "../../../packages/audiobus/io/input-definitions"
import { OUTPUT_DEFINITIONS } from "../../../packages/audiobus/io/output-definitions"
import { INPUT_GUIDANCE, OUTPUT_GUIDANCE } from "../source/components/graph/device-card"
import { elementIcon } from "../source/components/graph/element-icons"
import IOChainManager from "../../../packages/audiobus/io/IO-chain-manager"
import OutputManager from "../../../packages/audiobus/io/output-manager"
import { INPUT_EVENT } from "../../../packages/audiobus/event-constants"
import { NOTE_ON, NOTE_OFF } from "../../../packages/audiobus/commands"

const managers: IOChainManager[] = []
afterEach(() => {
	managers.splice(0).forEach((manager) => manager.destroy())
	vi.unstubAllGlobals()
})
const inputs = [
	"step-sequencer",
	"pads",
	"microphone-trigger",
	"camera-gestures",
	"event-loop",
	"osc"
]
const outputs = ["note-monitor", "sample-player", "event-recorder", "osc"]

describe("new device registrations", () => {
	it("provides metadata, usage guidance and graph icons", () => {
		for (const id of inputs) {
			expect(INPUT_DEFINITIONS[id].name).toBeTruthy()
			expect(INPUT_GUIDANCE[id].requirements).toBeTruthy()
			expect(elementIcon("input", id)).not.toContain("device-input.svg")
		}
		for (const id of outputs) {
			expect(OUTPUT_DEFINITIONS[id].name).toBeTruthy()
			expect(OUTPUT_GUIDANCE[id].requirements).toBeTruthy()
			expect(elementIcon("output", id)).not.toContain("device-output.svg")
		}
	})
	it("hides devices whose required APIs are unavailable", () => {
		vi.stubGlobal("AudioContext", undefined)
		vi.stubGlobal("WebSocket", undefined)
		vi.stubGlobal("Worker", undefined)
		vi.stubGlobal("navigator", {})
		const available = getAvailableInputFactories().map((factory) => factory.id)
		expect(available).toEqual(expect.arrayContaining(["step-sequencer", "pads", "event-loop"]))
		for (const id of ["camera-gestures", "microphone-trigger", "osc"]) {
			expect(available).not.toContain(id)
		}
		const availableOutputs = getAvailableOutputFactories().map((factory) => factory.id)
		expect(availableOutputs).toEqual(expect.arrayContaining(["note-monitor", "event-recorder"]))
		expect(availableOutputs).not.toContain("sample-player")
		expect(availableOutputs).not.toContain("osc")
	})
	it("restores sequencer tempo callbacks and saved patterns, ticking a shared input once", async () => {
		const timer = { now: 0, BPM: 60, isRunning: true, start: vi.fn(), stop: vi.fn() } as any
		const options = { timer, outputMixer: {} as GainNode }
		const manager = new IOChainManager(options)
		managers.push(manager)
		const chain = manager.getChain(manager.createEmptyChain())!
		const input = await createInputById("step-sequencer", {
			...manager.deviceOptions,
			steps: [60, 62],
			gate: 0.5
		})
		chain.addInput(input as any)
		const output = await createOutputById("note-monitor", manager.deviceOptions)
		chain.addOutput(output)
		manager.cloneChain(manager.activeChainId!)
		const restored = new IOChainManager(options)
		managers.push(restored)
		await restored.restoreWorkspace(manager.exportWorkspace())
		expect(restored.restoreWarnings).toEqual([])
		const sequence = restored.chains[0].inputs[0] as any
		const receive = vi.fn()
		sequence.addEventListener(INPUT_EVENT, (event: any) => receive(event.command))
		const update = vi.spyOn(sequence, "updateTime")
		restored.updateTime(0, 0)
		restored.updateTime(0.125, 1)
		expect(update).toHaveBeenCalledTimes(2)
		expect(receive.mock.calls.filter(([command]) => command.type === NOTE_ON)).toHaveLength(1)
		timer.now = 0.25
		restored.updateTime(0.25, 2)
		expect(receive).toHaveBeenLastCalledWith(
			expect.objectContaining({ type: NOTE_ON, number: 62 })
		)
		restored.stopClock()
		expect(receive).toHaveBeenLastCalledWith(
			expect.objectContaining({ type: NOTE_OFF, number: 62 })
		)
		for (const output of restored.chains[0].outputs) {
			await OutputManager.settled(output)
		}
	})
})