// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { createMixer } from "../source/services/mixer"
import { createMixerMeter } from "../source/services/mixer-meter"
import {
	EVENT_CHAINS_UPDATED,
	EVENT_VISIBILITY_CHANGE,
	EVENT_CANCEL,
	EVENT_CLOSE
} from "audiobus/event-constants"

let dispose: () => void
let hidden = false
let frames: Map<number, FrameRequestCallback>
let serial = 0
const analysers: any[] = [],
	splitters: any[] = []
function audio() {
	const context: any = {
		gains: [],
		createGain: vi.fn(() => {
			const gain = audio()
			gain.context = context
			context.gains.push(gain)
			return gain
		}),
		currentTime: 0,
		state: "running",
		createChannelSplitter: vi.fn(() => {
			const node = { connect: vi.fn(), disconnect: vi.fn() }
			splitters.push(node)
			return node
		}),
		createAnalyser: vi.fn(() => {
			const channel = analysers.length % 2
			const analyser = {
				fftSize: 1024,
				disconnect: vi.fn(),
				getFloatTimeDomainData: vi.fn((buffer: Float32Array) =>
					buffer.fill(channel ? -1.1 : 1.1)
				)
			}
			analysers.push(analyser)
			return analyser
		})
	}
	const node: any = {
		context,
		connect: vi.fn(),
		disconnect: vi.fn(),
		gain: {
			value: 0.5,
			setTargetAtTime: vi.fn((value: number) => {
				node.gain.value = value
			})
		}
	}
	return node
}
function next(now = 100) {
	const callbacks = [...frames.values()]
	frames.clear()
	callbacks.forEach((callback) => callback(now))
}
function setup() {
	const source = audio(),
		master = audio()
	master.context = source.context
	source.context.destination = master
	const output = { name: "Piano", output: source, hasAudioOutput: () => true }
	const manager: any = Object.assign(new EventTarget(), {
		devices: [{ device: output, direction: "output" }]
	})
	dispose = createMixer(manager, master)
	const dialog = document.querySelector<HTMLDialogElement>("#mixer-dialog")!
	dialog.show = () => {
		dialog.open = true
	}
	dialog.close = () => {
		dialog.open = false
		dialog.dispatchEvent(new Event(EVENT_CLOSE))
	}
	const open = () => {
		document.querySelector<HTMLButtonElement>("#btn-mixer")!.click()
		next()
	}
	return { source, master, manager, dialog, open, output }
}
beforeEach(() => {
	document.body.innerHTML =
		'<button id="btn-mixer" disabled>Mixer</button><input id="volume" type="range" min="0" max="100" value="50">'
	hidden = false
	serial = 0
	analysers.length = splitters.length = 0
	frames = new Map()
	vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden)
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		frames.set(++serial, callback)
		return serial
	})
	vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id))
})
afterEach(() => {
	dispose?.()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

it("allocates no meter taps or frames until opened, and places stereo meters to the right of every fader", () => {
	const { open, source } = setup()
	expect(analysers).toHaveLength(0)
	expect(frames.size).toBe(0)
	open()
	expect(document.querySelectorAll(".mixer-channel")).toHaveLength(2)
	expect(analysers).toHaveLength(4)
	expect(source.connect).toHaveBeenCalledExactlyOnceWith(source.context.gains[0])
	expect(source.context.gains[0].connect).toHaveBeenCalledWith(splitters[0])
	for (const fader of document.querySelectorAll(".mixer-fader")) {
		expect(fader.nextElementSibling?.classList.contains("mixer-meter")).toBe(true)
		expect(fader.nextElementSibling?.children).toHaveLength(2)
	}
	// Opposite stereo polarity still registers and clips: the taps never downmix.
	expect(document.querySelectorAll(".mixer-meter.is-clipping")).toHaveLength(2)
})
it("removes only meter connections and cancels frames on close, escape, visibility loss and disposal", () => {
	const { open, dialog, source } = setup()
	open()
	dialog.close()
	expect(source.context.gains[0].disconnect).toHaveBeenCalledExactlyOnceWith(splitters[0])
	expect(splitters[0].disconnect).toHaveBeenCalledOnce()
	expect(analysers.every((analyser) => analyser.disconnect.mock.calls.length === 1)).toBe(true)
	expect(frames.size).toBe(0)
	open()
	dialog.dispatchEvent(new Event(EVENT_CANCEL))
	expect(frames.size).toBe(0)
	dialog.open = false
	open()
	hidden = true
	document.dispatchEvent(new Event(EVENT_VISIBILITY_CHANGE))
	expect(frames.size).toBe(0)
	const count = analysers.length
	next(200)
	expect(analysers).toHaveLength(count)
	hidden = false
	document.dispatchEvent(new Event(EVENT_VISIBILITY_CHANGE))
	next(300)
	expect(analysers.length).toBeGreaterThan(count)
	dispose()
	expect(frames.size).toBe(0)
	expect(document.getElementById("mixer-dialog")).toBeNull()
})
it("tracks newly added and removed audio Outputs and excludes MIDI-only devices", () => {
	const { open, manager, source } = setup()
	open()
	const oldSplitter = splitters[0]
	manager.devices.push({
		direction: "output",
		device: { name: "Bass", output: audio(), hasAudioOutput: () => true }
	})
	manager.devices.push({
		direction: "output",
		device: { name: "MIDI", hasAudioOutput: () => false }
	})
	manager.dispatchEvent(new Event(EVENT_CHAINS_UPDATED))
	next(200)
	expect(document.querySelectorAll(".mixer-channel")).toHaveLength(3)
	expect(source.context.gains[0].disconnect).toHaveBeenCalledWith(oldSplitter)
	manager.devices.splice(0, 1)
	manager.dispatchEvent(new Event(EVENT_CHAINS_UPDATED))
	next(300)
	expect(document.querySelector('[aria-label="Piano channel"]')).toBeNull()
})
it("adjusts Output gain, preserves mute while closed, and synchronizes master with the existing volume control", () => {
	const { open, source, master, dialog } = setup()
	open()
	const fader = document.querySelector<HTMLInputElement>('[aria-label="Piano volume"]')!
	fader.value = "-6"
	fader.dispatchEvent(new Event("input"))
	expect(source.context.gains[0].gain.value).toBeCloseTo(10 ** (-6 / 20))
	expect(source.gain.value).toBe(0.5)
	document.querySelector<HTMLButtonElement>('[aria-label="Mute Piano"]')!.click()
	expect(source.context.gains[0].gain.value).toBe(0)
	dialog.close()
	expect(source.context.gains[0].gain.value).toBe(0)
	open()
	document.querySelector<HTMLButtonElement>('[aria-label="Mute Piano"]')!.click()
	expect(source.context.gains[0].gain.value).toBeCloseTo(10 ** (-6 / 20))
	expect(source.gain.value).toBe(0.5)
	const volume = document.querySelector<HTMLInputElement>("#volume")!
	volume.addEventListener("input", () => {
		master.gain.value = Number(volume.value) / 100
	})
	const masterFader = document.querySelector<HTMLInputElement>('[aria-label="Master volume"]')!
	masterFader.value = "-12"
	masterFader.dispatchEvent(new Event("input"))
	expect(Number(volume.value)).toBeCloseTo(100 * 10 ** (-12 / 20))
	expect(master.gain.value).toBeCloseTo(10 ** (-12 / 20))
})
it("releases a replaced source without disconnecting its audible route", () => {
	const host = document.createElement("div"),
		first = audio(),
		second = audio()
	let source = first
	const meter = createMixerMeter(host, () => source)
	meter.read(100)
	const firstSplitter = splitters[0]
	source = second
	meter.read(200)
	expect(first.disconnect).toHaveBeenCalledExactlyOnceWith(firstSplitter)
	expect(second.connect).toHaveBeenCalledExactlyOnceWith(splitters[1])
	meter.stop()
	expect(second.disconnect).toHaveBeenCalledExactlyOnceWith(splitters[1])
})