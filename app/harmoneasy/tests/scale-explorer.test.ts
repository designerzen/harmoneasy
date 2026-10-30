// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import {
	allPitchSetClasses,
	mapPitchSet,
	pitchClasses,
	pitchSetAnalysis,
	pitchSetClass,
	pitchSetMask,
	quantisePitchSet
} from "../../../packages/audiobus/tuning/pitch-class-set"
import {
	effectiveScaleSet,
	SCALE_EXPLORER_DEFAULTS
} from "../../../packages/audiobus/io/scale-explorer-controls"
import InputScaleExplorer from "../../../packages/audiobus/io/inputs/input-scale-explorer"
import {
	TransformerScaleExplorer,
	ID_SCALE_EXPLORER
} from "../../../packages/audiobus/io/transformers/transformer-scale-explorer"
import { tranformerFactory } from "../../../packages/audiobus/io/transformer-factory"
import { INPUT_FACTORIES } from "../../../packages/audiobus/io/input-factory"
import { createMusicalTorus, torusPitch } from "../../../packages/audiobus/ui/musical-torus"
import {
	EVENT_CHANGE,
	EVENT_KEY_DOWN,
	INPUT_EVENT
} from "../../../packages/audiobus/event-constants"
import { musicalCommand } from "../../../packages/audiobus/io/event-clip"
import { NOTE_ON, NOTE_OFF, CONTROL_CHANGE } from "../../../packages/audiobus/commands"

afterEach(() => {
	vi.useRealTimers()
	document.body.replaceChildren()
})

describe("complete pitch-set space", () => {
	it("enumerates 223 nonempty T/I classes and 351 transposition classes", () => {
		const classes = allPitchSetClasses()
		expect(classes).toHaveLength(223)
		expect(
			Array.from(
				{ length: 12 },
				(_, i) => classes.filter((mask) => pitchClasses(mask).length === i + 1).length
			)
		).toEqual([1, 6, 12, 29, 38, 50, 38, 29, 12, 6, 1, 1])
		const transpositions = new Set<number>()
		for (let mask = 1; mask <= 4095; mask++) {
			expect(classes).toContain(pitchSetClass(mask))
			transpositions.add(pitchSetClass(mask, false))
		}
		expect(transpositions.size).toBe(351)
	})
	it("distinguishes interval-class vectors from directed autocorrelation", () => {
		expect(pitchClasses(2741)).toEqual([0, 2, 4, 5, 7, 9, 11])
		expect(pitchSetAnalysis(2741).steps).toEqual([2, 2, 1, 2, 2, 2, 1])
		const tritone = pitchSetAnalysis(65)
		expect(tritone.autocorrelation[6]).toBe(2)
		expect(tritone.intervals).toEqual([0, 0, 0, 0, 0, 1])
		expect(pitchSetAnalysis(0).steps).toEqual([])
		expect(pitchSetAnalysis(1).steps).toEqual([12])
	})
	it("preserves every mask under twelve rotations and validates IDs", () => {
		for (let mask = 0; mask <= 4095; mask++) {
			expect(mapPitchSet(mask, 1, 12)).toBe(mask)
			expect(mapPitchSet(mapPitchSet(mask, -1), -1)).toBe(mask)
			expect(mapPitchSet(mapPitchSet(mask, 5), 5)).toBe(mask)
		}
		for (const invalid of ["", null, -1, 4096, 1.2, NaN, "notes"]) {
			expect(() => pitchSetMask(invalid)).toThrow()
		}
	})
	it("rotates modes after operations without forcing the tonic into custom sets", () => {
		const options = { ...SCALE_EXPLORER_DEFAULTS }
		expect(effectiveScaleSet({ ...options, mode: 1 })).toBe(1709)
		expect(effectiveScaleSet({ ...options, operation: "complement" })).toBe(4095 ^ 2741)
		expect(effectiveScaleSet({ ...options, mask: 2 })).toBe(2)
		expect(effectiveScaleSet({ ...options, mask: 0, mode: 4 })).toBe(0)
	})
	it("quantises sparse sets at MIDI boundaries, respects direction and ties", () => {
		expect(quantisePitchSet(61, 2741, 0)).toBe(60)
		expect(quantisePitchSet(61, 2741, 0, "up")).toBe(62)
		expect(quantisePitchSet(61, 2741, 0, "filter")).toBeUndefined()
		expect(quantisePitchSet(0, 2048, 0)).toBe(11)
		expect(quantisePitchSet(127, 1, 0, "up")).toBeUndefined()
		expect(quantisePitchSet(127, 1, 0)).toBe(120)
		expect(quantisePitchSet(60, 0, 0)).toBeUndefined()
	})
})

describe("scale transformer", () => {
	const note = (type: string, pitch: number, from = "keyboard") =>
		musicalCommand({
			type,
			number: pitch,
			velocity: type === NOTE_ON ? 100 : 0,
			channel: 2,
			startAt: 0,
			from
		})
	it("holds converging notes until the last source key releases", () => {
		const transformer = new TransformerScaleExplorer({ mask: 1 })
		expect(transformer.transform([note(NOTE_ON, 60)]).map((command) => command.number)).toEqual(
			[60]
		)
		expect(transformer.transform([note(NOTE_ON, 61)])).toEqual([])
		expect(transformer.transform([note(NOTE_OFF, 60)])).toEqual([])
		expect(transformer.transform([note(NOTE_OFF, 61)])).toEqual([
			expect.objectContaining({ type: NOTE_OFF, number: 60 })
		])
	})
	it("keeps releases bound to the original mapping across live configuration edits", () => {
		const transformer = new TransformerScaleExplorer()
		expect(transformer.transform([note(NOTE_ON, 61)])).toEqual([
			expect.objectContaining({ number: 60, channel: 2 })
		])
		transformer.setConfig("mask", 4095)
		transformer.setConfig("root", 7)
		expect(transformer.transform([note(NOTE_OFF, 61)])).toEqual([
			expect.objectContaining({ type: NOTE_OFF, number: 60 })
		])
		expect(transformer.transform([note(CONTROL_CHANGE, 1)])[0].type).toBe(CONTROL_CHANGE)
	})
	it("remembers suppressed attacks, handles velocity-zero releases, and restores settings", () => {
		const transformer = new TransformerScaleExplorer({ mask: 0 })
		expect(transformer.transform([note(NOTE_ON, 60)])).toEqual([])
		transformer.setConfig("mask", 4095)
		expect(transformer.transform([note(NOTE_OFF, 60)])).toEqual([])
		transformer.transform([note(NOTE_ON, 60)])
		expect(transformer.transform([{ ...note(NOTE_ON, 60), velocity: 0 }])[0].type).toBe(
			NOTE_OFF
		)
		const restored = tranformerFactory(
			ID_SCALE_EXPLORER,
			JSON.parse(transformer.exportConfig())
		)
		expect(restored.options).toMatchObject({ mask: 4095, source: "custom" })
		expect(() => transformer.setConfig("mask", 5000)).toThrow()
	})
})

describe("scale input and musical torus", () => {
	it("is discoverable and plays gated transport notes without bursting after a stall", async () => {
		const factory = INPUT_FACTORIES.find((item) => item.id === "scale-explorer")!
		expect(factory.isAvailable()).toBe(true)
		const input = (await factory.create({ mask: 661, now: () => 0 })) as InputScaleExplorer
		const receive = vi.fn()
		input.addEventListener(INPUT_EVENT, (event) => receive((event as any).command))
		input.updateTime(0)
		expect(receive).not.toHaveBeenCalled()
		input.startClock()
		input.updateTime(0)
		expect(receive).toHaveBeenLastCalledWith(
			expect.objectContaining({ type: NOTE_ON, number: 60 })
		)
		input.updateTime(0.2)
		expect(receive).toHaveBeenLastCalledWith(
			expect.objectContaining({ type: NOTE_OFF, number: 60 })
		)
		input.updateTime(0.25)
		expect(receive).toHaveBeenLastCalledWith(
			expect.objectContaining({ type: NOTE_ON, number: 62 })
		)
		input.updateTime(20)
		expect(receive.mock.calls.filter(([command]) => command.type === NOTE_ON)).toHaveLength(3)
		await input.disconnect()
		expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ type: NOTE_OFF }))
		input.destroy()
	})
	it("has correct seam identification and chromatic/fourths successors at every point", () => {
		for (let x = 0; x < 12; x++) {
			for (let y = 0; y < 12; y++) {
				expect(torusPitch(x + 12, y)).toBe(torusPitch(x, y))
				expect(torusPitch(x, y + 12)).toBe(torusPitch(x, y))
				expect(torusPitch(x + 1, y)).toBe((torusPitch(x, y) + 1) % 12)
				expect(torusPitch(x, y + 1)).toBe((torusPitch(x, y) + 5) % 12)
			}
		}
	})
	it("navigates the torus by keyboard and auditions or toggles the selected pitch", () => {
		const audition = vi.fn(),
			toggle = vi.fn(),
			torus = createMusicalTorus({ audition, toggle })
		document.body.append(torus.element)
		expect(torus.element.querySelectorAll('g[role="button"]')).toHaveLength(144)
		const key = (key: string) =>
			torus.element
				.querySelector('[tabindex="0"]')!
				.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key, bubbles: true }))
		key("ArrowLeft")
		key("Enter")
		expect(audition).toHaveBeenLastCalledWith(11)
		key("ArrowUp")
		key("Enter")
		expect(audition).toHaveBeenLastCalledWith(4)
		const select = torus.element.querySelector("select")!
		select.value = "edit"
		select.dispatchEvent(new Event(EVENT_CHANGE))
		key("Enter")
		expect(toggle).toHaveBeenLastCalledWith(4)
	})
	it("persists torus edits as custom sets and cancels audition releases on destruction", async () => {
		vi.useFakeTimers()
		const input = new InputScaleExplorer({ source: "2741", mode: 1 })
		const receive = vi.fn()
		input.addEventListener(INPUT_EVENT, (event) => receive((event as any).command))
		const panel = await input.createGui()
		const torus = panel.querySelector('section[aria-label="Musical torus"]')!
		const select = torus.querySelector("select")!
		select.value = "edit"
		select.dispatchEvent(new Event(EVENT_CHANGE))
		torus.querySelector('[tabindex="0"]')!.dispatchEvent(new MouseEvent("click"))
		expect(input.options).toMatchObject({
			source: "custom",
			mask: 1708,
			mode: 0,
			operation: "original"
		})
		select.value = "audition"
		select.dispatchEvent(new Event(EVENT_CHANGE))
		torus.querySelector('[tabindex="0"]')!.dispatchEvent(new MouseEvent("click"))
		expect(receive).toHaveBeenLastCalledWith(
			expect.objectContaining({ type: NOTE_ON, number: 60 })
		)
		input.destroy()
		expect(receive).toHaveBeenLastCalledWith(
			expect.objectContaining({ type: NOTE_OFF, number: 60 })
		)
		const count = receive.mock.calls.length
		vi.runAllTimers()
		expect(receive).toHaveBeenCalledTimes(count)
		const restored = new InputScaleExplorer(JSON.parse(JSON.stringify(input.options)))
		expect(restored.options.mask).toBe(1708)
		restored.destroy()
	})
})