// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import AudioBus from "../source/audio"
import { getAudioDestination } from "../../../packages/audiobus/audio-destination"
import { insertCLAPEffect } from "../../../packages/audiobus/instruments/clap/clap-mixer"
import { EVENT_KEY_DOWN } from "audiobus/event-constants"

afterEach(() => vi.unstubAllGlobals())

it("opens a direct preset before audio activation and unlocks on the first playing gesture", async () => {
	const node = () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() })
	const pending: (() => void)[] = []
	class Context {
		state = "suspended"
		sampleRate = 48000
		destination = node()
		createGain = node
		createConvolver = node
		createBuffer = () => ({ getChannelData: () => new Float32Array(48000) })
		resume = vi.fn(() => new Promise<void>((resolve) => pending.push(resolve)))
	}
	vi.stubGlobal("AudioContext", Context)
	const bus = new AudioBus(0.5, false)
	await bus.loaded
	const context = bus.audioContext as unknown as Context
	expect(context.resume).toHaveBeenCalledTimes(1)
	document.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: "a" }))
	expect(context.resume).toHaveBeenCalledTimes(2)
	context.state = "running"
	pending.forEach((resolve) => resolve())
	await vi.waitFor(() => expect(context.state).toBe("running"))
	await new Promise((resolve) => setTimeout(resolve, 0))
	document.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: "b" }))
	expect(context.resume).toHaveBeenCalledTimes(2)
})

it("keeps a dry signal after insert effects and applies master volume to every local audio route", async () => {
	const node = () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() })
	const gains: ReturnType<typeof node>[] = []
	const reverb = node()
	class Context {
		state = "running"
		sampleRate = 48000
		destination = node()
		createGain() {
			const gain = node()
			gains.push(gain)
			return gain
		}
		createConvolver() {
			return reverb
		}
		createBuffer() {
			return { getChannelData: () => new Float32Array(48000) }
		}
	}
	vi.stubGlobal("AudioContext", Context)
	const bus = new AudioBus(0.5)
	await bus.loaded
	const [mixer, master, effectsOutput, dry, wet] = gains
	expect(mixer.gain.value).toBe(1)
	expect(master.gain.value).toBe(0.5)
	expect(getAudioDestination(bus.audioContext)).toBe(master)
	expect(effectsOutput.connect).toHaveBeenCalledWith(dry)
	expect(effectsOutput.connect).toHaveBeenCalledWith(reverb)
	expect(dry.connect).toHaveBeenCalledWith(master)
	expect(reverb.connect).toHaveBeenCalledWith(wet)
	expect(wet.connect).toHaveBeenCalledWith(master)
	expect(dry.gain.value).toBe(0.85)
	expect(wet.gain.value).toBe(0.15)
	const effect = node()
	const remove = insertCLAPEffect(bus.mixer, effect as any)
	expect(mixer.disconnect).toHaveBeenCalledExactlyOnceWith(effectsOutput)
	expect(effect.connect).toHaveBeenCalledExactlyOnceWith(effectsOutput)
	remove()
	bus.volume = 0
	expect(master.gain.value).toBe(0)
	bus.volume = 1
	expect(master.gain.value).toBe(1)
	bus.volume = NaN
	expect(master.gain.value).toBe(0)
})