// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { INPUT_EVENT, NOTE_OFF, NOTE_ON } from "../../../packages/audiobus/commands/commands"
import { createInputById } from "../../../packages/audiobus/io/input-factory"
import { getInputDefinition } from "../../../packages/audiobus/io/input-definitions"
import type InputWebComponent from "../../../packages/audiobus/io/inputs/input-web-component"
import {
	createModalString,
	driveModalHarmonic,
	exciteModalHarmonic,
	modalStringAmplitude,
	sampleModalString,
	shapeModalString,
	stepModalString
} from "../../../packages/audiobus/ui/shared/modal-string"
import { HarmonicsWaves } from "../../../packages/audiobus/ui/controllers/harmonics/harmonics"
import { HarmonicStrings } from "../../../packages/audiobus/ui/controllers/harmonic-strings/harmonic-strings"
import {
	ARPEGGIO_PATTERNS,
	ArpeggiosWheel,
	arpeggioChordNotes
} from "../../../packages/audiobus/ui/controllers/arpeggios/arpeggios"
import { ChordKeyboard } from "../../../packages/audiobus/ui/controllers/chords/chords"
import {
	MelodyMaker,
	parseMelodyPattern,
	serializeMelodyPattern
} from "../../../packages/audiobus/ui/controllers/melody-maker/melody-maker"
import { ScrollingPianoRoll } from "../../../packages/audiobus/ui/controllers/scrolling-piano-roll/scrolling-piano-roll"
import { PIANO_ROLL_SCORE_IDS } from "../../../packages/audiobus/ui/controllers/scrolling-piano-roll/scores"
import { SoundWaves } from "../../../packages/audiobus/ui/controllers/sound-waves/sound-waves"

const mountedInputs: InputWebComponent[] = []

afterEach(() => {
	vi.useRealTimers()
	for (const input of mountedInputs.splice(0)) {
		input.destroy()
	}
	document.body.replaceChildren()
})

function collectNoteEvents(element: HTMLElement) {
	const events: { type: string; note: number; velocity: number; id: number }[] = []
	for (const type of [NOTE_ON, NOTE_OFF]) {
		element.addEventListener(type, (event) => {
			const { note, velocity, id } = (event as CustomEvent).detail
			events.push({ type, note: note.noteNumber, velocity, id })
		})
	}
	return events
}

function mockCanvasRect(canvas: HTMLCanvasElement, width: number, height: number) {
	canvas.getBoundingClientRect = () =>
		({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0 }) as DOMRect
}

describe("shared modal string physics", () => {
	it("shapes, oscillates, and decays plucked strings", () => {
		const string = createModalString(48, 5)
		shapeModalString(string, 0.5, 12)
		// 5-mode Fourier triangle partial sum at u=0.5 is 12 * (8/pi^2) * (1 + 1/9 + 1/25) ≈ 11.2
		expect(sampleModalString(string, 0.5)).toBeGreaterThan(10.5)
		expect(sampleModalString(string, 0.5)).toBeLessThanOrEqual(12)
		expect(sampleModalString(string, 0)).toBeCloseTo(0, 5)
		expect(sampleModalString(string, 1)).toBeCloseTo(0, 5)
		const initial = modalStringAmplitude(string)
		stepModalString(string, 0.25, 2)
		expect(modalStringAmplitude(string)).toBeLessThan(initial)
	})

	it("excites and drives pure standing-wave harmonic modes with zero crossings at nodes", () => {
		const string = createModalString(53, 6)
		exciteModalHarmonic(string, 2, 10)
		expect(sampleModalString(string, 0.25)).toBeCloseTo(10, 4)
		expect(sampleModalString(string, 0.5)).toBeCloseTo(0, 4)
		expect(sampleModalString(string, 0.75)).toBeCloseTo(-10, 4)
		driveModalHarmonic(string, 2, 16, 0.05, 12)
		expect(Math.hypot(string.a[1], string.b[1])).toBeGreaterThan(10)
	})
})

describe("Chrome Music Lab input registrations", () => {
	const ids = [
		"arpeggios",
		"chords",
		"harmonics",
		"harmonic-strings",
		"melody-maker",
		"scrolling-piano-roll",
		"sound-waves"
	] as const

	it.each(ids)(
		"registers %s with Google Creative Lab attribution and mounts via InputWebComponent",
		async (id) => {
			const def = getInputDefinition(id)
			expect(def).toBeDefined()
			expect(def?.category).toBe("UI")
			expect(def?.attribution?.sourceUrl).toBe(
				"https://github.com/googlecreativelab/chrome-music-lab"
			)

			const input = (await createInputById(id, { now: () => 0 })) as InputWebComponent
			mountedInputs.push(input)
			const element = await input.createGui()
			document.body.append(element)
			expect(element.shadowRoot?.childElementCount).toBeGreaterThan(0)
		}
	)
})

describe("HarmonicsWaves", () => {
	it("computes the harmonic series from F3 and emits noteOn/noteOff across dragged columns", () => {
		const element = document.createElement("harmonics-waves") as HarmonicsWaves
		const canvas = element.shadowRoot!.querySelector("canvas")!
		mockCanvasRect(canvas, 300, 180)
		document.body.append(element)
		const events = collectNoteEvents(element)

		expect(element.notes).toEqual([53, 65, 72, 77, 81, 84])

		canvas.dispatchEvent(
			new PointerEvent("pointerdown", {
				pointerId: 1,
				pointerType: "touch",
				clientX: 25,
				clientY: 90,
				buttons: 1
			})
		)
		canvas.dispatchEvent(
			new PointerEvent("pointermove", {
				pointerId: 1,
				pointerType: "touch",
				clientX: 125,
				clientY: 90,
				buttons: 1
			})
		)
		canvas.dispatchEvent(
			new PointerEvent("pointerup", {
				pointerId: 1,
				pointerType: "touch",
				clientX: 125,
				clientY: 90,
				buttons: 0
			})
		)

		expect(events.map((e) => [e.type, e.note])).toEqual([
			[NOTE_ON, 53],
			[NOTE_OFF, 53],
			[NOTE_ON, 72],
			[NOTE_OFF, 72]
		])
	})
})

describe("HarmonicStrings", () => {
	it("creates divided harmonic segments and plucks crossed segments in order", () => {
		const element = document.createElement("harmonic-strings") as HarmonicStrings
		const canvas = element.shadowRoot!.querySelector("canvas")!
		mockCanvasRect(canvas, 300, 200)
		document.body.append(element)
		const events = collectNoteEvents(element)

		// 6 columns: 1 + 2*5 = 11 segments
		expect(element.notes).toHaveLength(11)
		expect(element.notes[0]).toBe(48) // 1/1 = C3
		expect(element.notes[1]).toBe(60) // 1/2 top = C4
		expect(element.notes[2]).toBe(60) // 1/2 bottom = C4
		expect(element.notes[3]).toBe(55) // 2/3 top = G3
		expect(element.notes[4]).toBe(67) // 1/3 bottom = G4

		// Swipe rapidly across the top portion to cross column 0 (1/1) and column 1 top (1/2)
		const down = new PointerEvent("pointerdown", {
			pointerId: 1,
			pointerType: "touch",
			clientX: 5,
			clientY: 40,
			buttons: 1
		})
		Object.defineProperty(down, "timeStamp", { value: 10 })
		const move = new PointerEvent("pointermove", {
			pointerId: 1,
			pointerType: "touch",
			clientX: 100,
			clientY: 40,
			buttons: 1
		})
		Object.defineProperty(move, "timeStamp", { value: 20 })
		canvas.dispatchEvent(down)
		canvas.dispatchEvent(move)

		expect(events.filter((e) => e.type === NOTE_ON).map((e) => e.note)).toEqual([48, 60])
		element.stop()
		expect(events.filter((e) => e.type === NOTE_OFF)).toHaveLength(2)
	})
})

describe("ChordKeyboard", () => {
	it("plays major and minor triads and releases cleanly on stop", () => {
		const element = document.createElement("chord-keyboard") as ChordKeyboard
		element.setAttribute("roll", "false")
		document.body.append(element)
		const events = collectNoteEvents(element)

		element.triggerChord(60)
		expect(events.map((e) => [e.type, e.note])).toEqual([
			[NOTE_ON, 60],
			[NOTE_ON, 64],
			[NOTE_ON, 67]
		])

		// Switching mode while held re-triggers the chord in the new quality
		element.mode = "minor"
		const lastOns = events.slice(-3)
		expect(lastOns.map((e) => [e.type, e.note])).toEqual([
			[NOTE_ON, 60],
			[NOTE_ON, 63],
			[NOTE_ON, 67]
		])

		element.stop()
		expect(events.filter((e) => e.type === NOTE_ON)).toHaveLength(6)
		expect(events.filter((e) => e.type === NOTE_OFF)).toHaveLength(6)
	})
})

describe("ArpeggiosWheel", () => {
	it("computes 3-octave chord tones and steps through arpeggio patterns", () => {
		vi.useFakeTimers()
		expect(arpeggioChordNotes("C", "major", 3).slice(0, 4)).toEqual([48, 52, 55, 60])
		expect(arpeggioChordNotes("A", "minor", 3).slice(0, 3)).toEqual([57, 60, 64])
		expect(ARPEGGIO_PATTERNS).toHaveLength(5)

		const element = document.createElement("arpeggios-wheel") as ArpeggiosWheel
		element.setAttribute("bpm", "120")
		document.body.append(element)
		const events = collectNoteEvents(element)

		element.play()
		vi.advanceTimersByTime(520)
		element.stop()

		const onNotes = events.filter((e) => e.type === NOTE_ON).map((e) => e.note)
		expect(onNotes.slice(0, 3)).toEqual([48, 52, 55])
		expect(events.filter((e) => e.type === NOTE_OFF).length).toBe(onNotes.length)
	})
})

describe("MelodyMaker", () => {
	it("toggles cells, generates ghost harmony notes, and persists patterns via attributes", async () => {
		vi.useFakeTimers()
		const serialized = serializeMelodyPattern([0, null, 2, 4, null, null, null, null])
		expect(parseMelodyPattern(serialized)).toEqual([0, null, 2, 4, null, null, null, null])

		const input = (await createInputById("melody-maker", {
			now: () => 0,
			attributes: { pattern: serialized, harmony: "right", bpm: "120" }
		})) as InputWebComponent
		mountedInputs.push(input)
		const commands: any[] = []
		input.addEventListener(INPUT_EVENT, (event: any) => commands.push(event.command))
		const element = (await input.createGui()) as MelodyMaker
		document.body.append(element)

		// Column 2 has melody row 2 (E3 = 52) AND ghost shadow from column 0 shifted right +2 (C3 = 48)
		expect(element.notesAtColumn(2)).toEqual([52, 48])

		element.play()
		vi.advanceTimersByTime(550)
		element.stop()
		expect(commands.some((c) => c.type === NOTE_ON && c.number === 48)).toBe(true)
		expect(commands.some((c) => c.type === NOTE_ON && c.number === 52)).toBe(true)
	})
})

describe("ScrollingPianoRoll", () => {
	it("loads all 5 classical scores and auditions crossed notes when scrubbing", () => {
		vi.useFakeTimers()
		expect(PIANO_ROLL_SCORE_IDS).toEqual([
			"preludeInC",
			"turkishMarch",
			"beethoven5",
			"minuetInG",
			"satie"
		])

		const element = document.createElement("scrolling-piano-roll") as ScrollingPianoRoll
		document.body.append(element)
		const events = collectNoteEvents(element)

		element.seek(0.5, true)
		expect(events.filter((e) => e.type === NOTE_ON).map((e) => e.note)).toEqual([60, 64, 67])
		vi.advanceTimersByTime(150)
		expect(events.filter((e) => e.type === NOTE_OFF)).toHaveLength(3)

		element.scoreId = "beethoven5"
		expect(element.position).toBe(0)
	})
})

describe("SoundWaves", () => {
	it("emits noteOn/noteOff from keyboard presses and toggles particle zoom", async () => {
		const input = (await createInputById("sound-waves", { now: () => 0 })) as InputWebComponent
		mountedInputs.push(input)
		const commands: any[] = []
		input.addEventListener(INPUT_EVENT, (event: any) => commands.push(event.command))
		const element = (await input.createGui()) as SoundWaves
		document.body.append(element)

		element.noteDown(60, "test", 0.75)
		expect(commands.at(-1)).toMatchObject({ type: NOTE_ON, number: 60 })
		element.noteUp("test")
		expect(commands.at(-1)).toMatchObject({ type: NOTE_OFF, number: 60 })

		const zoomBtn = element.shadowRoot!.querySelector<HTMLButtonElement>("[data-zoom]")!
		zoomBtn.click()
		expect(element.zoom).toBe(true)
		expect(input.options.attributes.zoom).toBe("true")
	})
})