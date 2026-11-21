// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import InputDeviceMotion, {
	MOTION_CONTROLS,
	MOTION_MODES
} from "../../../packages/audiobus/io/inputs/input-device-motion"
import { CONTROL_CHANGE, NOTE_OFF, NOTE_ON } from "../../../packages/audiobus/commands/commands"
import { createInputById } from "../../../packages/audiobus/io/input-factory"
import { INPUT_GUIDANCE } from "../source/components/graph/device-card"

const inputs: InputDeviceMotion[] = []
afterEach(() => {
	inputs.splice(0).forEach((input) => input.destroy())
	vi.useRealTimers()
})

async function setup(options: Record<string, unknown> = {}) {
	let time = 0
	const input = new InputDeviceMotion({
		smoothing: 0,
		now: () => time,
		...options
	})
	inputs.push(input)
	await Promise.resolve()
	const sent: {
		type: string
		number: number
		velocity?: number
		value?: number
	}[] = []
	vi.spyOn(input, "dispatch").mockImplementation((command: any) => {
		sent.push({
			type: command.type,
			number: command.number,
			velocity: command.velocity,
			value: command.value
		})
	})
	const notes = () => sent.filter((c) => c.type === NOTE_ON || c.type === NOTE_OFF)
	const controls = () => sent.filter((c) => c.type === CONTROL_CHANGE)
	return {
		input,
		sent,
		notes,
		controls,
		advance: (seconds: number) => (time += seconds)
	}
}

it("walks the scale by rolling and only plays while the pad is held", async () => {
	const { input, notes } = await setup({ sendControls: false, octaves: 1 })
	input.processOrientation(-40, 0)
	expect(notes()).toEqual([])
	input.setHolding(true)
	// Eight cells: C major from C4 to C5; full left roll is C4.
	expect(notes()).toEqual([{ type: NOTE_ON, number: 60, velocity: 84, value: 0 }])
	input.processOrientation(40, 40)
	expect(
		notes()
			.slice(1)
			.map((n) => [n.type, n.number])
	).toEqual([
		[NOTE_OFF, 60],
		[NOTE_ON, 72]
	])
	expect(notes()[2].velocity).toBe(127)
	input.setHolding(false)
	expect(notes().at(-1)).toMatchObject({ type: NOTE_OFF, number: 72 })
})

it("holds a note near a cell boundary instead of flickering", async () => {
	const { input, notes } = await setup({
		sendControls: false,
		holdToPlay: false,
		octaves: 1
	})
	// Cell width is 2/8 of the tilt range; boundary between cells 3 and 4 sits at tilt 0.
	input.processOrientation(-1, 0)
	const first = notes().length
	input.processOrientation(1, 0)
	input.processOrientation(-1, 0)
	expect(notes().length).toBe(first)
	input.processOrientation(10, 0)
	expect(notes().length).toBe(first + 2)
})

it("turns to choose chords of the key, relative to the level point", async () => {
	const { input, notes } = await setup({
		sendControls: false,
		mode: "compass"
	})
	input.processOrientation(0, 0, 90)
	input.setLevel()
	input.setHolding(true)
	const played = () =>
		notes()
			.filter((n) => n.type === NOTE_ON)
			.map((n) => n.number)
	expect(played()).toEqual([60, 64, 67])
	// A seventh of a turn clockwise is chord ii.
	input.processOrientation(0, 0, 90 + 360 / 7)
	expect(played().slice(3)).toEqual([62, 65, 69])
	// Wrapping anticlockwise past north reaches vii°.
	input.processOrientation(0, 0, 90 - 360 / 7)
	expect(played().slice(6)).toEqual([71, 74, 77])
})

it("strikes drums by direction with a refractory gap and shake CC pulses", async () => {
	vi.useFakeTimers()
	const { input, notes, controls, advance } = await setup({
		mode: "strike",
		ccBase: 20
	})
	input.processMotion(0, 0, -30)
	input.processMotion(0, 0, -30)
	advance(0.2)
	input.processMotion(25, 0, 0)
	advance(0.2)
	input.processMotion(0, 20, 0)
	expect(
		notes()
			.filter((n) => n.type === NOTE_ON)
			.map((n) => n.number)
	).toEqual([36, 38, 42])
	// Shake is CC base + 4, pressed then released.
	expect(
		controls()
			.filter((c) => c.number === 24)
			.map((c) => c.value)
	).toEqual([127])
	vi.advanceTimersByTime(200)
	expect(
		controls()
			.filter((c) => c.number === 24)
			.map((c) => c.value)
	).toEqual([127, 0])
	expect(notes().filter((n) => n.type === NOTE_OFF)).toHaveLength(3)
})

it("streams movement as CC without notes in control mode and can send one movement alone", async () => {
	const { input, notes, controls } = await setup({ mode: "controls" })
	input.setHolding(true)
	// Holding sends the resting position: level tilt, facing the start, no energy.
	expect(controls().map((c) => [c.number, c.value])).toEqual([
		[16, 64],
		[17, 64],
		[18, 0],
		[19, 0]
	])
	input.processOrientation(40, -40, 180)
	expect(notes()).toEqual([])
	expect(
		controls()
			.slice(4)
			.map((c) => [c.number, c.value])
	).toEqual([
		[16, 127],
		[17, 0],
		[18, 64]
	])
	input.processOrientation(40, -40, 180)
	expect(controls()).toHaveLength(7)
	input.soloControl("tiltY")
	expect(controls().slice(7)).toEqual([expect.objectContaining({ number: 17, value: 0 })])
	input.processOrientation(0, 0, 0)
	expect(
		controls()
			.slice(8)
			.map((c) => c.number)
	).toEqual([17])
})

it("documents every mode and control and is registered for the device browser", async () => {
	for (const mode of Object.values(MOTION_MODES)) {
		expect(mode.steps.length).toBeGreaterThan(1)
	}
	expect(MOTION_CONTROLS.map((c) => c.id)).toEqual([
		"tiltX",
		"tiltY",
		"heading",
		"energy",
		"shake"
	])
	expect(INPUT_GUIDANCE["device-motion"].requirements).toContain("HTTPS")
	const input = (await createInputById("device-motion")) as InputDeviceMotion
	inputs.push(input)
	expect(input.name).toBe("Device Motion")
	const gui = await input.createGui()
	expect(gui.querySelector("select")?.value).toBe("tilt")
	expect(gui.querySelectorAll("ol li")).toHaveLength(MOTION_MODES.tilt.steps.length)
	const mode = gui.querySelector("select")!
	mode.value = "strike"
	mode.dispatchEvent(new Event("change"))
	expect(gui.querySelector("ol li")?.textContent).toBe(MOTION_MODES.strike.steps[0])
	expect(gui.querySelector('[role="status"]')?.textContent).toMatch(/drag on the pad/i)
	await input.destroyGui()
})