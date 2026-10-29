import { afterEach, describe, expect, it, vi } from "vitest"
import { createRequire } from "node:module"
import InputMIDIFile from "../../../packages/audiobus/io/inputs/input-midi-file"
import IOChainManager from "../../../packages/audiobus/io/IO-chain-manager"
import { createInputById } from "../../../packages/audiobus/io/input-factory"
import { deviceDefinition } from "../../../packages/audiobus/io/device-definition"
import { INPUT_EVENT, NOTE_ON, NOTE_OFF } from "../../../packages/audiobus/commands"
import { importMIDIFile } from "../../../packages/audiobus/importers/import-midi-file"
const { Midi } = createRequire(new URL("../../../packages/audiobus/package.json", import.meta.url))(
	"@tonejs/midi"
)
const commands = [
	{ type: NOTE_ON, number: 60, velocity: 100, channel: 3, startAt: 0 },
	{ type: NOTE_OFF, number: 60, velocity: 0, channel: 3, startAt: 0.5 }
]
const managers: IOChainManager[] = []
afterEach(() => managers.splice(0).forEach((manager) => manager.destroy()))

describe("MIDI file input", () => {
	it("stays primed until started, preserves offsets and can replay without mutating the tune", () => {
		const input = new InputMIDIFile({ fileName: "tune.mid", commands })
		const receive = vi.fn()
		input.addEventListener(INPUT_EVENT, (event) => receive((event as any).command))
		input.updateTime(10)
		expect(receive).not.toHaveBeenCalled()
		input.startClock()
		input.updateTime(10)
		input.updateTime(10.25)
		expect(receive).toHaveBeenCalledTimes(1)
		input.updateTime(10.5)
		expect(receive).toHaveBeenLastCalledWith(
			expect.objectContaining({ type: NOTE_OFF, startAt: 10.5, channel: 3 })
		)
		input.stopClock()
		input.startClock()
		input.updateTime(30)
		expect(receive).toHaveBeenLastCalledWith(
			expect.objectContaining({ type: NOTE_ON, startAt: 30 })
		)
		expect(commands[0].startAt).toBe(0)
	})
	it("ticks a shared input once, waits for restart when dropped during playback, and rewinds on stop", async () => {
		const timer = {
			now: 0,
			BPM: 120,
			isRunning: true,
			start: vi.fn(),
			stop: vi.fn(),
			resetTimer: vi.fn()
		} as any
		const manager = new IOChainManager({ timer, outputMixer: {} as GainNode })
		managers.push(manager)
		const chain = manager.getChain(manager.createEmptyChain())!
		manager.updateTime(5, 0)
		const input = (await createInputById("midi-file", {
			fileName: "tune.mid",
			commands
		})) as InputMIDIFile
		chain.addInput(input)
		manager.cloneChain(manager.activeChainId!)
		const update = vi.spyOn(input, "updateTime")
		const receive = vi.fn()
		input.addEventListener(INPUT_EVENT, receive)
		manager.updateTime(6, 0)
		expect(update).toHaveBeenCalledTimes(1)
		expect(receive).not.toHaveBeenCalled()
		await manager.transport("stop")
		await manager.transport("start")
		manager.updateTime(8, 0)
		expect(receive).toHaveBeenCalledTimes(1)
		await manager.transport("stop")
		manager.updateTime(9, 0)
		expect(receive).toHaveBeenCalledTimes(1)
		await manager.transport("start")
		manager.updateTime(20, 0)
		expect(receive).toHaveBeenCalledTimes(2)
		expect(deviceDefinition(input).options?.commands).toEqual(commands)
	})
	it("converts SMF zero-based channels to the one-based command convention", async () => {
		const midi = new Midi()
		midi.addTrack().addNote({ midi: 60, time: 0, duration: 0.5, velocity: 0.8 })
		midi.tracks[0].channel = 9
		const result = await importMIDIFile(new File([midi.toArray()], "drums.mid"))
		expect(result.noteCount).toBe(1)
		expect(result.commands.every((command) => command.channel === 10)).toBe(true)
	})
})