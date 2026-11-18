// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest"
import {
	TransformerMidi,
	ID_MIDI_TRANSFORMER
} from "../../../packages/audiobus/io/transformers/transformer-midi"
import { tranformerFactory } from "../../../packages/audiobus/io/transformer-factory"
import { TRANSFORMER_DEFINITIONS } from "../../../packages/audiobus/io/transformer-definitions"
import { applyTransformer } from "../../../packages/audiobus/io/transformer-pipeline"
import {
	midiToCommand,
	commandToMidi
} from "../../../packages/audiobus/midi/midi-command-conversion"
import { MidiOutputRouting } from "../../../packages/audiobus/io/outputs/midi-output-routing"

const command = (bytes: number[]) => midiToCommand(bytes, 1, "keyboard")!
describe("MIDI Transformer", () => {
	it("releases a held transposed note after bypassing and passes new notes unchanged", () => {
		const transformer = new TransformerMidi({ transpose: 12 })
		transformer.transform([command([0x90, 60, 100])])
		transformer.setConfig("enabled", false)
		expect(
			transformer
				.transform([command([0x80, 60, 30]), command([0x90, 62, 100])])
				.map(commandToMidi)
		).toEqual([
			[0x80, 72, 30],
			[0x90, 62, 100]
		])
	})
	it("is registered, persists its settings, and transposes notes without altering CC or system messages", () => {
		const transformer = tranformerFactory(ID_MIDI_TRANSFORMER, { transpose: 12 })
		expect(TRANSFORMER_DEFINITIONS[transformer.type].name).toBe("MIDI Transformer")
		const input = [
			[0x92, 60, 100],
			[0xb2, 64, 127],
			[0xa2, 60, 70],
			[0xf8],
			[0x82, 60, 30]
		].map(command)
		expect(applyTransformer(transformer, input, {} as any).map(commandToMidi)).toEqual([
			[0x92, 72, 100],
			[0xb2, 64, 127],
			[0xa2, 72, 70],
			[0xf8],
			[0x82, 72, 30]
		])
		expect(input[0].number).toBe(60)
		expect(JSON.parse(transformer.exportConfig()).transpose).toBe(12)
	})
	it("filters all message families independently while logging incoming data and the decision", () => {
		const transformer = new TransformerMidi({
			notes: 0,
			controllers: 0,
			programs: 0,
			pressure: 0,
			pitchBend: 0,
			system: 0
		})
		const bytes = [
			[0x90, 60, 100],
			[0x80, 60, 0],
			[0xb0, 1, 100],
			[0xc0, 10],
			[0xd0, 80],
			[0xa0, 60, 80],
			[0xe0, 0, 64],
			[0xf8],
			[0xf0, 0x7d, 1, 0xf7]
		]
		expect(applyTransformer(transformer, bytes.map(command), {} as any)).toEqual([])
		expect(transformer.logEntries.map((entry) => entry.input)).toEqual(bytes)
		expect(transformer.logEntries.every((entry) => entry.output === undefined)).toBe(true)
	})
	it("matches releases to the original transpose and filter decision when settings change", () => {
		const transformer = new TransformerMidi({ transpose: 12 })
		transformer.transform([command([0x90, 60, 100])])
		transformer.setConfig("transpose", -12)
		transformer.setConfig("notes", 0)
		expect(transformer.transform([command([0x80, 60, 40])]).map(commandToMidi)).toEqual([
			[0x80, 72, 40]
		])
		transformer.transform([command([0x90, 60, 100])])
		transformer.setConfig("notes", 1)
		expect(transformer.transform([command([0x80, 60, 0])])).toEqual([])
	})
	it("drops out-of-range notes, bounds the log, and updates and clears the visible log", async () => {
		vi.useFakeTimers()
		const transformer = new TransformerMidi({ transpose: 12 })
		try {
			const gui = await transformer.createGui()
			expect(transformer.transform([command([0x90, 120, 100])])).toEqual([])
			for (let i = 0; i < 250; i++) {
				transformer.transform([command([0xb0, 1, i % 128])])
			}
			vi.advanceTimersByTime(50)
			expect(transformer.logEntries).toHaveLength(200)
			expect(gui.querySelector("pre")!.textContent).toContain("B0 01")
			Array.from(gui.querySelectorAll("button"))
				.find((button) => button.textContent === "Clear MIDI log")!
				.click()
			expect(transformer.logEntries).toHaveLength(0)
			expect(gui.querySelector("pre")!.textContent).toBe("Waiting for MIDI…")
		} finally {
			transformer.destroy()
			vi.useRealTimers()
		}
	})
})

describe("MIDI output incoming channels", () => {
	it("applies channel selection to native UMP packets while preserving system packets", async () => {
		const send = vi.fn()
		const routing = new MidiOutputRouting(
			{ acceptedChannels: [2], selectedChannel: 5 },
			() => [{ id: "synth", name: "Synth" }],
			vi.fn(),
			() => {},
			send
		)
		await routing.sendPacket([0x40903c00, 0xffff0000])
		await routing.sendPacket([0x40913c00, 0xffff0000])
		await routing.sendPacket([0x10f80000])
		expect(send.mock.calls).toEqual([
			["synth", [0x40943c00, 0xffff0000]],
			["synth", [0x10f80000]]
		])
	})
	it("filters incoming channels before forcing the output channel, and still passes system messages", async () => {
		const send = vi.fn()
		const routing = new MidiOutputRouting(
			{ acceptedChannels: [2, 4], selectedChannel: 9 },
			() => [{ id: "synth", name: "Synth" }],
			send
		)
		await routing.sendCommand(command([0x90, 60, 100]))
		await routing.sendCommand(command([0x91, 61, 100]))
		await routing.sendCommand(command([0xb3, 1, 80]))
		await routing.sendCommand(command([0xf8]))
		expect(send.mock.calls).toEqual([
			["synth", [0x98, 61, 100]],
			["synth", [0xb8, 1, 80]],
			["synth", [0xf8]]
		])
	})
	it("selects, solos, restores all channels and releases old notes when the selection changes", async () => {
		const options: Record<string, any> = {}
		const send = vi.fn()
		const routing = new MidiOutputRouting(options, () => [{ id: "synth", name: "Synth" }], send)
		const gui = await routing.createGui()
		document.body.append(gui)
		try {
			await routing.sendCommand(command([0x91, 60, 100]))
			const solo = gui.querySelector(
				'select[aria-label="Solo incoming channel"]'
			) as HTMLSelectElement
			solo.value = "4"
			solo.dispatchEvent(new Event("change"))
			await routing.sendCommand(command([0x91, 61, 100]))
			expect(options.acceptedChannels).toEqual([4])
			expect(send).toHaveBeenLastCalledWith("synth", [0x81, 60, 0])
			const box = gui.querySelector(
				'input[aria-label="Pass incoming channel 2"]'
			) as HTMLInputElement
			box.click()
			expect(options.acceptedChannels).toEqual([2, 4])
			gui.querySelector("fieldset button")!.dispatchEvent(new Event("click"))
			expect(options.acceptedChannels).toHaveLength(16)
		} finally {
			await routing.release()
			await routing.destroyGui()
		}
	})
})