// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import IOChain from "../../../packages/audiobus/io/IO-chain"
import { TransformerStrummer } from "../../../packages/audiobus/io/transformers/transformer-strummer"
import { TransformerEuclideanGate } from "../../../packages/audiobus/io/transformers/transformer-euclidean-gate"
import { TransformerCCMapper } from "../../../packages/audiobus/io/transformers/transformer-cc-mapper"
import { TransformerLatch } from "../../../packages/audiobus/io/transformers/transformer-latch"
import { TransformerChordifier } from "../../../packages/audiobus/io/transformers/transformer-chordifier"
import { TransformerLegato } from "../../../packages/audiobus/io/transformers/transformer-legato"
import { TransformerTransposer } from "../../../packages/audiobus/io/transformers/transformer-transposer"
import {
	TRANSFORMER_TYPE,
	TRANSFORMERS,
	tranformerFactory
} from "../../../packages/audiobus/io/transformer-factory"
import { componentBindings } from "../../../packages/audiobus/io/component-ui"
import { performanceBindings } from "../../../packages/audiobus/io/performance-controls"
import { TRANSFORMER_DEFINITIONS } from "../../../packages/audiobus/io/transformer-definitions"
import { createTransformerPicker } from "../source/components/graph/Transformers"
import { createAudioCommand } from "../../../packages/audiobus/commands/audio-command-factory"
import {
	midiToCommand,
	commandToMidi
} from "../../../packages/audiobus/midi/midi-command-conversion"
import { NOTE_ON, NOTE_OFF } from "../../../packages/audiobus/commands/commands"

const chains: IOChain[] = []
afterEach(() => {
	chains.splice(0).forEach((chain) => chain.destroy())
	document.body.replaceChildren()
})
function setup() {
	const timer = { now: 0, bpm: 120, BPM: 120 }
	const chain = new IOChain(timer as never)
	chains.push(chain)
	chain.setTransformers([])
	const note = (pitch: number, at = timer.now) =>
		Object.assign(createAudioCommand(NOTE_ON, pitch, at), { channel: 1 })
	const tick = (now: number) => {
		timer.now = now
		return chain.updateTimeForCommandQueue(now, 0, {})
	}
	return { timer, chain, note, tick }
}

it.each(TRANSFORMERS)("offers only transformation controls for %s", async (type) => {
	const effect = tranformerFactory(type)
	try {
		const bindings = await componentBindings(effect as never, effect.midiControlId)
		expect(bindings.some((binding) => binding.descriptor.id.startsWith("surface:"))).toBe(false)
		const gui = await effect.createGui()
		expect(gui.querySelector('[role="grid"]')).toBeNull()
	} finally {
		effect.destroy()
	}
})

it("retains playable controls for instruments with public note methods", () => {
	const instrument = { noteOn: vi.fn(), noteOff: vi.fn() }
	expect(
		performanceBindings(instrument, "instrument", "Instrument").map(
			(binding) => binding.descriptor.id
		)
	).toContain("surface:piano-roll")
})

it("passes live notes through Legato and a downstream effect after opening and closing its controls", async () => {
	const { chain, timer, note, tick } = setup()
	const legato = new TransformerLegato({ overlap: 20, hold: 2 })
	chain.setTransformers([legato, new TransformerTransposer({ enabled: true, distance: 12 })])
	const gui = await legato.createGui()
	expect(gui.querySelector('[role="grid"]')).toBeNull()
	legato.destroyGui()
	await legato.createGui()
	await chain.addCommandToQueue(note(60))
	expect(tick(0)).toEqual([expect.objectContaining({ type: NOTE_ON, number: 72 })])
	timer.now = 0.1
	await chain.addCommandToQueue({ ...note(60), type: NOTE_OFF, velocity: 0 })
	expect(tick(0.1)).toEqual([])
	timer.now = 0.2
	await chain.addCommandToQueue(note(62))
	expect(tick(0.2)).toEqual([expect.objectContaining({ type: NOTE_ON, number: 74 })])
	expect(tick(0.221)).toEqual([expect.objectContaining({ type: NOTE_OFF, number: 72 })])
	expect(tick(1.21)).toEqual([expect.objectContaining({ type: NOTE_OFF, number: 74 })])
})

it("drives delayed live chord strokes from the chain clock without another input event", async () => {
	const { chain, note, tick } = setup()
	chain.setTransformers([new TransformerStrummer({ collect: 25, spread: 100, direction: "up" })])
	await chain.addCommandToQueue(note(64))
	await chain.addCommandToQueue(note(60))
	expect(tick(0.024)).toEqual([])
	expect(tick(0.026)).toEqual([expect.objectContaining({ type: NOTE_ON, number: 60 })])
	expect(tick(0.126)).toEqual([expect.objectContaining({ type: NOTE_ON, number: 64 })])
})

it("clears generator state and pending work when transport clears notes or the chain is disabled", async () => {
	const { chain, note, tick } = setup()
	chain.setTransformers([new TransformerEuclideanGate()])
	await chain.addCommandToQueue(note(60))
	expect(tick(0)).toHaveLength(1)
	chain.clearNoteCommands()
	expect(tick(4)).toEqual([])
	await chain.addCommandToQueue(note(64))
	chain.setActive(false)
	chain.setActive(true)
	expect(tick(8)).toEqual([])
})

it("releases pending latch cleanup on the next chain tick and cancels removed effects", async () => {
	const { chain, note, tick } = setup()
	const latch = new TransformerLatch()
	chain.setTransformers([latch])
	await chain.addCommandToQueue(note(60))
	tick(0)
	latch.setConfig("enabled", "0")
	expect(tick(0.1)).toEqual([expect.objectContaining({ type: NOTE_OFF, number: 60 })])
	chain.setTransformers([new TransformerStrummer({ collect: 50 })])
	await chain.addCommandToQueue(note(67))
	chain.setTransformers([])
	expect(tick(1)).toEqual([])
})

it("applies CC mapping to real MIDI input without sending an extra unmodified controller message", async () => {
	const { chain, timer } = setup()
	chain.setTransformers([
		new TransformerChordifier(),
		new TransformerCCMapper({ input: 1, output: 11 })
	])
	const send = vi.spyOn(chain, "triggerAudioCommandsOnDevice").mockResolvedValue([])
	const command = midiToCommand([0xb2, 1, 90], timer.now, "controller")!
	chain.onInputEvent({
		command,
		origin: {},
		preventDefault() {},
		clone() {
			return new Event("input-copy")
		}
	} as never)
	expect(send).toHaveBeenCalledOnce()
	expect(send.mock.calls[0][0].map(commandToMidi)).toEqual([[0xb2, 11, 90]])
})

it("makes every new Transformer discoverable in the picker with a real icon", () => {
	const { chain } = setup()
	const picker = createTransformerPicker({ chain } as never)
	document.body.append(picker.element)
	try {
		for (const id of Object.values(TRANSFORMER_TYPE).slice(0, 12)) {
			const definition = TRANSFORMER_DEFINITIONS[id]
			expect(
				[...picker.element.querySelectorAll("button")].some(
					(button) => button.textContent === definition.name
				)
			).toBe(true)
			expect(existsSync(resolve("public", definition.icon.slice(1)))).toBe(true)
		}
	} finally {
		picker.destroy()
	}
})