// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import OutputSiON from "../../../packages/audiobus/io/outputs/output-sion"
import {
	createOutputById,
	getAvailableOutputFactories
} from "../../../packages/audiobus/io/output-factory"
import { deviceDefinition } from "../../../packages/audiobus/io/device-definition"
import { musicalCommand } from "../../../packages/audiobus/io/event-clip"
import {
	NOTE_ON,
	NOTE_OFF,
	CONTROL_CHANGE,
	PITCH_BEND,
	PROGRAM_CHANGE
} from "../../../packages/audiobus/commands"
import { EVENT_CHANGE, EVENT_INPUT } from "../../../packages/audiobus/event-constants"
import { setAudioDestination } from "../../../packages/audiobus/audio-destination"

const mock = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock("../../../packages/sion/SiON.js", () => ({ createSiONSession: mock.create }))
const outputs: OutputSiON[] = []
const param = () => ({ value: 0, setValueAtTime: vi.fn() })
function setup() {
	const nodes: any[] = []
	const node = () => {
		const value = { gain: param(), pan: param(), connect: vi.fn(), disconnect: vi.fn() }
		nodes.push(value)
		return value
	}
	const context = {
		currentTime: 10,
		destination: {},
		createGain: node,
		createStereoPanner: node,
		resume: vi.fn().mockResolvedValue(undefined)
	} as any
	const tracks: any[] = []
	const session = {
		driver: {
			isPlaying: false,
			play: vi.fn(),
			stop: vi.fn(),
			noteOn: vi.fn(() => {
				const track = {}
				tracks.push(track)
				return track
			}),
			noteOff: vi.fn()
		},
		audio: {},
		presets: { "midi.piano1": {}, "midi.piano2": {}, "valsound.bass1": {} },
		voices: ["midi.piano1", "midi.piano2", "valsound.bass1"],
		dispose: vi.fn()
	}
	mock.create.mockResolvedValue(session)
	const output = new OutputSiON({ audioContext: context, preset: "midi.piano1" })
	outputs.push(output)
	return { context, output, session, tracks, nodes }
}
const command = (type: string, number = 60, channel = 1, value = 0) =>
	musicalCommand({ type, number, channel, velocity: 100, value })
beforeEach(() => {
	mock.create.mockReset()
	vi.stubGlobal("AudioWorkletNode", class {})
})
afterEach(() => {
	outputs.splice(0).forEach((output) => output.destroy())
	vi.unstubAllGlobals()
})

describe("SiON Output", () => {
	it("is offered as an Output and uses the configured audio destination", async () => {
		const { context } = setup()
		const destination = {} as AudioNode
		setAudioDestination(context, destination)
		expect(getAvailableOutputFactories().some((factory) => factory.id === "sion")).toBe(true)
		const output = (await createOutputById("sion", { audioContext: context })) as OutputSiON
		outputs.push(output)
		expect(deviceDefinition(output).type).toBe("sion")
		expect(output.output.connect as any).toHaveBeenCalledWith(destination)
	})
	it("plays presets with velocity and releases equal pitches independently by channel", async () => {
		const { output, session, tracks } = setup()
		await output.sendCommand(command(NOTE_ON))
		await output.sendCommand(command(NOTE_ON, 60, 2))
		expect(session.driver.noteOn.mock.calls[0].slice(0, 2)).toEqual([
			60,
			session.presets["midi.piano1"]
		])
		expect(tracks[0].velocity).toBe(100)
		expect(session.driver.noteOn.mock.calls[0][5]).not.toBe(
			session.driver.noteOn.mock.calls[1][5]
		)
		await output.sendCommand(command(NOTE_OFF))
		expect(session.driver.noteOff).toHaveBeenCalledWith(
			60,
			session.driver.noteOn.mock.calls[0][5],
			0,
			0,
			false
		)
		expect(session.driver.noteOff).toHaveBeenCalledTimes(1)
	})
	it("cancels notes released while the engine initializes", async () => {
		const { output, session } = setup()
		let resolve!: (session: any) => void
		mock.create.mockReturnValue(
			new Promise((done) => {
				resolve = done
			})
		)
		const pending = output.sendCommand(command(NOTE_ON))
		await vi.waitFor(() => expect(mock.create).toHaveBeenCalled())
		await output.sendCommand(command(NOTE_OFF))
		resolve(session)
		await pending
		expect(session.driver.noteOn).not.toHaveBeenCalled()
	})
	it("supports sustain and pitch bend on each channel", async () => {
		const { output, session, tracks } = setup()
		await output.sendCommand(command(PITCH_BEND, 0, 1, 16383))
		await output.sendCommand(command(NOTE_ON))
		expect(tracks[0].pitchBend).toBe(128)
		await output.sendCommand(command(CONTROL_CHANGE, 64, 1, 127))
		await output.sendCommand(command(NOTE_OFF))
		expect(session.driver.noteOff).not.toHaveBeenCalled()
		await output.sendCommand(command(CONTROL_CHANGE, 64, 1, 0))
		expect(session.driver.noteOff).toHaveBeenCalledTimes(1)
	})
	it("maps MIDI programs in preset insertion order", async () => {
		const { output, session } = setup()
		await output.sendCommand(command(PROGRAM_CHANGE, 0, 1, 1))
		await output.sendCommand(command(NOTE_ON))
		expect(session.driver.noteOn.mock.calls[0][1]).toBe(session.presets["midi.piano2"])
	})
	it("offers searchable instruments, persists controls, and provides a panic button", async () => {
		const { output, session } = setup()
		const gui = await output.createGui()
		const selector = gui.querySelector("select")!
		expect(selector.options.length).toBe(4)
		const filter = gui.querySelector<HTMLInputElement>("input[type=search]")!
		filter.value = "bass"
		filter.dispatchEvent(new Event(EVENT_INPUT))
		expect([...selector.options].some((option) => option.value === "valsound.bass1")).toBe(true)
		selector.value = "valsound.bass1"
		selector.dispatchEvent(new Event(EVENT_CHANGE))
		const volume = gui.querySelector<HTMLInputElement>("input[type=number]")!
		volume.value = "0.25"
		volume.dispatchEvent(new Event(EVENT_CHANGE))
		expect(output.options).toMatchObject({ preset: "valsound.bass1", volume: 0.25 })
		expect(output.output.gain.setValueAtTime).toHaveBeenCalledWith(0.25, 10)
		await output.noteOn(60, 100)
		const panic = [...gui.querySelectorAll("button")].find(
			(button) => button.textContent === "All notes off"
		)!
		panic.click()
		expect(session.driver.stop).toHaveBeenCalled()
		await output.destroyGui()
		expect(await output.createGui()).not.toBe(gui)
	})
	it("disconnects and disposes its own audio without closing the shared context", async () => {
		const { output, session, context, nodes } = setup()
		await output.noteOn(60, 100)
		await output.disconnect()
		expect(output.isConnected).toBe(false)
		expect(session.driver.stop).toHaveBeenCalled()
		expect(nodes[0].disconnect).toHaveBeenCalled()
		await output.connect()
		expect(output.isConnected).toBe(true)
		output.destroy()
		expect(session.dispose).toHaveBeenCalled()
		expect(context.close).toBeUndefined()
	})
})