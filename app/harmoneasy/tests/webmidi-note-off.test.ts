// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import InputWebMIDIDevice from "../../../packages/audiobus/io/inputs/input-webmidi-device"
import IOChain from "../../../packages/audiobus/io/IO-chain"
import OutputManager from "../../../packages/audiobus/io/output-manager"
import { TransformerNoteShortener } from "../../../packages/audiobus/io/transformers/transformer-note-shortener"
import { midiToCommand } from "../../../packages/audiobus/midi/midi-command-conversion"

const midi = vi.hoisted(() => ({
	inputs: [] as any[],
	outputs: [],
	enable: vi.fn(async () => {}),
	addListener: vi.fn(),
	removeListener: vi.fn()
}))
vi.mock("../../../packages/audiobus/node_modules/webmidi/dist/esm/webmidi.esm.js", () => ({
	WebMidi: midi
}))
const cleanup: (() => void | Promise<void>)[] = []
beforeEach(() => {
	vi.clearAllMocks()
})
afterEach(async () => {
	for (const release of cleanup.splice(0).reverse()) {
		await release()
	}
	document.body.replaceChildren()
})

async function setup(overlap = false) {
	const listeners = new Set<(event: any) => void>()
	const port = {
		id: "midi-input",
		name: "MIDI input",
		type: "input",
		addListener: (_: string, fn: any) => listeners.add(fn),
		removeListener: (_: string, fn: any) => listeners.delete(fn)
	}
	midi.inputs = [port]
	const chain = new IOChain({ now: 0, BPM: 120 } as any)
	chain.setTransformers([])
	const output = { noteOn: vi.fn(), noteOff: vi.fn(), allNotesOff: vi.fn() } as any
	chain.addOutput(output)
	for (const options of overlap ? [{}, { selectedDevice: port.id }] : [{}]) {
		const input = new InputWebMIDIDevice({ ...options, now: () => 0 })
		chain.addInput(input)
		await input.connect()
		cleanup.push(() => input.destroy())
	}
	cleanup.push(() => chain.destroy())
	const flush = async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
		await chain.triggerAudioCommandsOnDevice(chain.executeQueueAndClearComplete(1))
		await OutputManager.settled(output)
	}
	const send = async (data: number[]) => {
		const event = { message: { data } }
		for (const listener of listeners) {
			listener(event)
		}
		await flush()
	}
	return { chain, output, send, flush }
}

describe("incoming MIDI from another app or tab", () => {
	it.each([0x80, 0x90])(
		"releases normal and velocity-zero note-offs (status %s)",
		async (status) => {
			const { output, send } = await setup()
			await send([0x92, 60, 100])
			await send([status | 2, 60, 0])
			expect(output.noteOn).toHaveBeenCalledExactlyOnceWith(60, 100)
			expect(output.noteOff).toHaveBeenCalledExactlyOnceWith(60)
		}
	)

	it.each([false, true])(
		"balances repeated note-ons before one note-off, overlapping adapters: %s",
		async (overlap) => {
			const { output, send } = await setup(overlap)
			await send([0x92, 60, 100])
			await send([0x92, 60, 90])
			await send([0x82, 60, 0])
			expect(output.noteOn).toHaveBeenCalledTimes(2)
			expect(output.noteOff).toHaveBeenCalledTimes(2)
			expect(output.noteOff.mock.invocationCallOrder[0]).toBeLessThan(
				output.noteOn.mock.invocationCallOrder[1]
			)
		}
	)

	it.each([120, 123])("honours channel-specific MIDI release controller %s", async (cc) => {
		const { output, send } = await setup()
		await send([0x92, 60, 100])
		await send([0x93, 64, 100])
		await send([0xb2, cc, 0])
		expect(output.noteOff).toHaveBeenCalledExactlyOnceWith(60)
		await send([0x83, 64, 0])
		expect(output.noteOff).toHaveBeenLastCalledWith(64)
	})

	it("does not lose an incoming note-off behind a large future queue", async () => {
		const { chain, output, send } = await setup()
		await send([0x90, 60, 100])
		chain.addCommands(
			Array.from({ length: 288 }, () => ({
				...midiToCommand([0x90, 62, 100], 10, "midi-input")!
			}))
		)
		await send([0x80, 60, 0])
		expect(output.noteOff).toHaveBeenCalledExactlyOnceWith(60)
		expect(chain.executeQueueAndClearComplete(11)).toHaveLength(288)
	})

	it("preserves the incoming channel when generating a shortened release", () => {
		const shortener = new TransformerNoteShortener()
		const commands = shortener.transform([midiToCommand([0x94, 60, 100], 0, "midi-input")!], {
			BPM: 120
		} as any)
		expect(commands.map((command) => command.channel)).toEqual([5, 5])
		expect(commands.map((command) => command.from)).toEqual(["midi-input", "midi-input"])
	})
})