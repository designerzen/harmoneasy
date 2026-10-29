// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import OutputDrumKit from "../../../packages/audiobus/io/outputs/output-drum-kit.ts"
import {
	createOutputById,
	getAvailableOutputFactories
} from "../../../packages/audiobus/io/output-factory.ts"
import { DRUM_KIT } from "../../../packages/audiobus/io/outputs/output-types.ts"
import { deviceDefinition } from "../../../packages/audiobus/io/device-definition.ts"
import { musicalCommand } from "../../../packages/audiobus/io/event-clip.ts"
import {
	NOTE_ON,
	NOTE_OFF,
	CONTROL_CHANGE,
	MIDI_STOP,
	PLAYBACK_STOP
} from "../../../packages/audiobus/commands.ts"
import { setAudioDestination } from "../../../packages/audiobus/audio-destination.ts"

const devices: OutputDrumKit[] = []
function setup() {
	const context = {
		currentTime: 10,
		state: "running",
		resume: vi.fn(async () => {
			context.state = "running"
		})
	}
	const percussion = { trigger: vi.fn(), allNotesOff: vi.fn() }
	const device = new OutputDrumKit({
		audioContext: context as unknown as AudioContext,
		percussionOutput: percussion
	})
	devices.push(device)
	return { device, context, percussion }
}
afterEach(() => {
	for (const device of devices.splice(0)) {
		device.destroy()
	}
	vi.unstubAllGlobals()
	document.body.replaceChildren()
})

describe("Playable synthesized drum kit", () => {
	it("routes the native synth into the master mix and cleans up its audio voices", () => {
		const parameter = () => ({
			value: 0,
			setValueAtTime: vi.fn(),
			linearRampToValueAtTime: vi.fn(),
			exponentialRampToValueAtTime: vi.fn(),
			setTargetAtTime: vi.fn()
		})
		const node = () => ({ connect: vi.fn(), disconnect: vi.fn() })
		const oscillator = { ...node(), frequency: parameter(), start: vi.fn(), stop: vi.fn() }
		const gains: ReturnType<typeof gain>[] = []
		const gain = () => {
			const result = { ...node(), gain: parameter() }
			gains.push(result)
			return result
		}
		const context = {
			currentTime: 10,
			state: "running",
			sampleRate: 48000,
			destination: node(),
			createGain: gain,
			createDynamicsCompressor: () => ({
				...node(),
				threshold: parameter(),
				ratio: parameter(),
				knee: parameter(),
				attack: parameter(),
				release: parameter()
			}),
			createBuffer: () => ({ getChannelData: () => new Float32Array(48000) }),
			createOscillator: () => oscillator
		} as unknown as AudioContext
		const mixer = node() as unknown as AudioNode
		setAudioDestination(context, mixer)
		const device = new OutputDrumKit({ audioContext: context, volume: 0.7 })
		devices.push(device)
		expect(gains[0].connect).toHaveBeenCalledWith(mixer)
		expect(gains[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(0.7, 10, 0.01)
		device.noteOn(36, 127)
		expect(oscillator.start).toHaveBeenCalledWith(10)
		expect(oscillator.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(
			expect.closeTo(42),
			expect.any(Number)
		)
		// Volume belongs on the bus, so full velocity must not be attenuated twice.
		expect(gains.at(-1)!.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.9, 10.002)
		device.destroy()
		expect(oscillator.stop).toHaveBeenLastCalledWith()
		expect(oscillator.disconnect).toHaveBeenCalled()
		expect(gains[0].disconnect).toHaveBeenCalled()
		expect(mixer.disconnect).not.toHaveBeenCalled()
	})
	it("maps drum notes directly without a clock, normalizes velocity and preserves one-shot tails", () => {
		const { device, percussion } = setup()
		for (const note of [36, 38, 42, 46, 45, 56, 63, 64]) {
			device.noteOn(note, 127)
		}
		expect(percussion.trigger.mock.calls.map(([hit]) => hit.part)).toEqual([
			"kick",
			"snare",
			"hatClosed",
			"hatOpen",
			"tomLow",
			"cowbell",
			"congaHigh",
			"congaLow"
		])
		expect(
			percussion.trigger.mock.calls.every(
				([hit]) => hit.triggerAt === 10 && hit.velocity === 0.55
			)
		).toBe(true)
		device.noteOff(36)
		device.sendCommand(musicalCommand({ type: NOTE_OFF, number: 38 }))
		expect(percussion.allNotesOff).not.toHaveBeenCalled()
		percussion.trigger.mockClear()
		for (const [note, velocity] of [
			[60, 0],
			[60, -1],
			[60, NaN],
			[34, 127],
			[88, 127],
			[36.5, 127]
		]) {
			device.noteOn(note, velocity)
		}
		expect(percussion.trigger).not.toHaveBeenCalled()
		device.noteOn(36, 254)
		expect(percussion.trigger.mock.lastCall![0].velocity).toBe(0.55)
	})
	it("accepts all channels by default and filters notes and panic controllers when selected", () => {
		const { device, percussion } = setup()
		for (const channel of [1, 10, 16]) {
			device.sendCommand(
				musicalCommand({ type: NOTE_ON, number: 36, velocity: 100, channel })
			)
		}
		expect(percussion.trigger).toHaveBeenCalledTimes(3)
		device.configure({ channel: 10 })
		device.sendCommand(musicalCommand({ type: NOTE_ON, number: 36, velocity: 100, channel: 1 }))
		expect(percussion.trigger).toHaveBeenCalledTimes(3)
		device.sendCommand(
			musicalCommand({ type: NOTE_ON, number: 38, velocity: 100, channel: 10 })
		)
		expect(percussion.trigger).toHaveBeenCalledTimes(4)
		device.sendCommand(musicalCommand({ type: CONTROL_CHANGE, number: 120, channel: 1 }))
		expect(percussion.allNotesOff).not.toHaveBeenCalled()
		for (const number of [120, 123]) {
			device.sendCommand(musicalCommand({ type: CONTROL_CHANGE, number, channel: 10 }))
		}
		for (const type of [MIDI_STOP, PLAYBACK_STOP]) {
			device.sendCommand(musicalCommand({ type }))
		}
		expect(percussion.allNotesOff).toHaveBeenCalledTimes(4)
	})
	it("scales tuning and decay, bounds settings, and returns a defensive settings copy", () => {
		const { device, percussion } = setup()
		device.configure({ volume: 0.8, tuning: 12, decay: 2 })
		device.noteOn(36, 127)
		const hit = percussion.trigger.mock.lastCall![0]
		expect(hit).toMatchObject({ velocity: 0.8, lengthScale: 2 })
		expect(440 * 2 ** ((hit.tuningNote - 69) / 12)).toBeCloseTo(84)
		device.configure({ volume: 5, tuning: -100, decay: 0, channel: 20 })
		expect(device.options).toEqual({ volume: 1, tuning: -24, decay: 0.1, channel: 16 })
		device.configure({ volume: NaN, decay: Infinity })
		device.options.volume = 0
		expect(device.options.volume).toBe(1)
		expect(device.options.decay).toBe(0.1)
	})
	it("silences disconnected and destroyed kits and resumes suspended audio on connection", async () => {
		const { device, context, percussion } = setup()
		await device.disconnect()
		device.noteOn(36)
		expect(percussion.trigger).not.toHaveBeenCalled()
		context.state = "suspended"
		await device.connect()
		expect(context.resume).toHaveBeenCalledOnce()
		device.noteOn(36)
		expect(percussion.trigger).toHaveBeenCalledOnce()
		device.destroy()
		await device.connect()
		device.noteOn(38)
		expect(device.isConnected).toBe(false)
		expect(percussion.trigger).toHaveBeenCalledOnce()
	})
	it("offers accessible touch and keyboard pads, updates controls and removes GUI listeners", async () => {
		const { device, percussion } = setup()
		const gui = await device.createGui()
		document.body.append(gui)
		const pads = gui.querySelectorAll("button")
		expect(pads).toHaveLength(12)
		pads[0].dispatchEvent(
			new PointerEvent("pointerdown", { button: 0, pointerType: "touch", pressure: 0.5 })
		)
		pads[0].dispatchEvent(new MouseEvent("click", { detail: 1 }))
		await Promise.resolve()
		expect(percussion.trigger).toHaveBeenCalledOnce()
		expect(percussion.trigger.mock.lastCall![0].velocity).toBeCloseTo(0.275)
		pads[1].click()
		await Promise.resolve()
		expect(percussion.trigger.mock.lastCall![0].part).toBe("snare")
		const tuning = gui.querySelector<HTMLInputElement>('[name="tuning"]')!
		tuning.value = "7"
		tuning.dispatchEvent(new Event("change"))
		expect(device.options.tuning).toBe(7)
		device.configure({ tuning: -12 })
		expect(tuning.value).toBe("-12")
		await device.destroyGui()
		expect(gui.isConnected).toBe(false)
		pads[0].click()
		await Promise.resolve()
		expect(percussion.trigger).toHaveBeenCalledTimes(2)
	})
	it("registers in the output browser and restores saved settings through the factory", async () => {
		const { device, context, percussion } = setup()
		vi.stubGlobal("AudioContext", class {})
		expect(getAvailableOutputFactories().find((factory) => factory.id === DRUM_KIT)?.name).toBe(
			"Drum Kit"
		)
		const restored = (await createOutputById(DRUM_KIT, {
			audioContext: context,
			percussionOutput: percussion,
			...device.options
		})) as OutputDrumKit
		devices.push(restored)
		restored.configure({ channel: 10, tuning: 7, decay: 0.5, volume: 0.7 })
		expect(deviceDefinition(restored)).toMatchObject({
			factory: "output",
			type: DRUM_KIT,
			options: restored.options
		})
		const again = (await createOutputById(DRUM_KIT, {
			...deviceDefinition(restored).options,
			audioContext: context,
			percussionOutput: percussion
		})) as OutputDrumKit
		devices.push(again)
		expect(again.options).toEqual(restored.options)
	})
})