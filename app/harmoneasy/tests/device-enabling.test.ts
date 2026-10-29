// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest"
import InputManager from "../../../packages/audiobus/io/input-manager"
import AbstractInput from "../../../packages/audiobus/io/inputs/abstract-input"
import OutputManager from "../../../packages/audiobus/io/output-manager"
import { INPUT_EVENT } from "../../../packages/audiobus/event-constants"
import { NOTE_ON } from "../../../packages/audiobus/commands"

class Input extends AbstractInput {
	destroy() {}
}
const note = { type: NOTE_ON, number: 60, velocity: 100 }

describe("device enable controls", () => {
	it("blocks a disabled input only in its own chain and resumes without reconnecting", () => {
		const input = new Input()
		const first = new InputManager(),
			second = new InputManager()
		first.add(input)
		second.add(input)
		const a = vi.fn(),
			b = vi.fn()
		first.addEventListener(INPUT_EVENT, a)
		second.addEventListener(INPUT_EVENT, b)
		input.dispatch(note)
		first.setEnabled(input, false)
		input.dispatch(note)
		expect(a).toHaveBeenCalledTimes(1)
		expect(b).toHaveBeenCalledTimes(2)
		first.setEnabled(input, true)
		input.dispatch(note)
		expect(a).toHaveBeenCalledTimes(2)
		first.destroy()
		second.destroy()
	})

	it("releases held notes and suppresses all output commands until enabled again", async () => {
		const output = {
			uuid: "test",
			name: "test",
			description: "",
			isConnected: true,
			isHidden: false,
			noteOn: vi.fn(),
			noteOff: vi.fn(),
			allNotesOff: vi.fn()
		}
		const manager = new OutputManager()
		manager.add(output)
		await manager.triggerAudioCommandsOnOutputs([note])
		manager.setEnabled(output, false)
		await OutputManager.settled(output)
		expect(output.noteOff).toHaveBeenCalledWith(60)
		await manager.triggerAudioCommandsOnOutputs([note])
		expect(output.noteOn).toHaveBeenCalledTimes(1)
		manager.setEnabled(output, true)
		await manager.triggerAudioCommandsOnOutputs([note])
		expect(output.noteOn).toHaveBeenCalledTimes(2)
		manager.destroy()
		await OutputManager.settled(output)
	})

	it("preserves another chain’s held note when disabling a shared output", async () => {
		const output = {
			uuid: "shared",
			name: "shared",
			description: "",
			isConnected: true,
			isHidden: false,
			noteOn: vi.fn(),
			noteOff: vi.fn(),
			allNotesOff: vi.fn()
		}
		const first = new OutputManager(),
			second = new OutputManager()
		first.add(output)
		second.add(output)
		await first.triggerAudioCommandsOnOutputs([note])
		await second.triggerAudioCommandsOnOutputs([note])
		first.setEnabled(output, false)
		await OutputManager.settled(output)
		expect(output.noteOff).not.toHaveBeenCalled()
		second.setEnabled(output, false)
		await OutputManager.settled(output)
		expect(output.noteOff).toHaveBeenCalledTimes(1)
		first.destroy()
		second.destroy()
	})
})