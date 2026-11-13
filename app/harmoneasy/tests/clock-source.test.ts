// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import IOChain from "../../../packages/audiobus/io/IO-chain"
import IOChainManager from "../../../packages/audiobus/io/IO-chain-manager"
import AbstractInput from "../../../packages/audiobus/io/inputs/abstract-input"
import { DVS_CONTROL_VINYL_INPUT_ID } from "../../../packages/audiobus/io/inputs/input-dvs-control-vinyl"
import { createAudioCommand } from "../../../packages/audiobus/commands/audio-command-factory"
import * as Commands from "../../../packages/audiobus/commands/commands"
import { midiToCommand } from "../../../packages/audiobus/midi/midi-command-conversion"
import {
	ClockSourceController,
	clockDvsInputs,
	clockMidiPorts
} from "../source/services/clock-source"
import { createClockSourceControls } from "../source/services/clock-source-controls"
import Timer from "../../../packages/netronome/src/timer"

class MidiInput extends AbstractInput {
	inputDevices = [
		{ id: "clock", name: "Controller" },
		{ id: "other", name: "Other controller" }
	]
	hasMidiInput() {
		return true
	}
	send(bytes: number[], now: number, from = "clock", origin = {}) {
		this.dispatch(midiToCommand(bytes, now, from)!, origin)
	}
}
class DvsInput extends AbstractInput {
	referenceBPM = 120
	setReferenceBPM = vi.fn((bpm: number) => {
		this.referenceBPM = bpm
	})
	get name() {
		return DVS_CONTROL_VINYL_INPUT_ID
	}
	send(type: string, audioTime?: number) {
		const command = createAudioCommand(type, 0, 0, this.name)
		command.audioTime = audioTime
		this.dispatch(command)
	}
}
const dispose: (() => void)[] = []
afterEach(() => {
	dispose.splice(0).forEach((cleanup) => cleanup())
	document.body.replaceChildren()
})
function setup<T extends AbstractInput = MidiInput>(
	connected = true,
	input: T = new MidiInput() as unknown as T
) {
	const timer = {
		now: 0,
		BPM: 120,
		isRunning: false,
		lastRecordedExternalTime: 0,
		ticks: 0,
		bypassed: false,
		start: vi.fn(async () => {
			timer.isRunning = true
		}),
		stop: vi.fn(async () => {
			timer.isRunning = false
		}),
		resetTimer: vi.fn(() => {
			timer.ticks = 0
		}),
		bypass: vi.fn((external: boolean) => {
			timer.bypassed = external
		}),
		externalTrigger: vi.fn(() => {
			if (timer.isRunning && timer.bypassed) {
				timer.ticks++
			}
		})
	}
	if (connected) {
		input.setAsConnected()
	}
	const manager = new IOChainManager({
		timer: timer as any,
		outputMixer: {} as GainNode,
		externalDevices: { input }
	})
	const chain = new IOChain(timer as any)
	chain.setTransformers([])
	chain.addInput(input)
	const id = manager.addChain(chain)
	const link = { setSource: vi.fn(async () => {}) }
	const changed = vi.fn(),
		error = vi.fn()
	const clock = new ClockSourceController(timer, manager, link, changed, error)
	dispose.push(() => {
		clock.destroy()
		manager.destroy()
	})
	const send = (bytes: number[], time = timer.now, from = "clock", origin = {}) => {
		timer.now = time
		;(input as unknown as MidiInput).send(bytes, time, from, origin)
	}
	return { timer, manager, chain, id, input, clock, link, changed, error, send }
}

describe("Main clock source", () => {
	it("drives the real timer at 24 PPQN with the first pulse on beat zero and no internal backend", async () => {
		class ExternalTimer extends Timer {
			clockTime = 0
			get now() {
				return this.clockTime ?? 0
			}
			get clockUnitsToSecondsScale() {
				return 1
			}
		}
		const timer = new ExternalTimer({ type: "audio-worklet", divisions: 24 }, true)
		await timer.loaded
		const divisions: number[] = []
		timer.setCallback((event) => divisions.push(event.divisionsElapsed))
		const input = new MidiInput()
		input.setAsConnected()
		const manager = new IOChainManager({
			timer,
			outputMixer: {} as GainNode,
			externalDevices: { input }
		})
		const chain = new IOChain(timer)
		chain.setTransformers([])
		chain.addInput(input)
		manager.addChain(chain)
		const clock = new ClockSourceController(
			timer,
			manager,
			{ setSource: async () => {} },
			() => {},
			() => {}
		)
		dispose.push(() => {
			clock.destroy()
			manager.destroy()
		})
		await clock.setSource("midi")
		input.send([0xfa], 0)
		for (let i = 0; i < 25; i++) {
			timer.clockTime = i / 48
			input.send([0xf8], timer.now)
			await clock.settled()
		}
		expect(divisions).toEqual([...Array.from({ length: 24 }, (_, i) => i), 0])
		expect(timer.BPM).toBeCloseTo(120)
		expect(timer.isRunning).toBe(true)
		input.send([0xfc], timer.now)
		await clock.settled()
		expect(timer.isRunning).toBe(false)
	})
	it("uses the internal timer and ignores unselected external MIDI clocks and transport", async () => {
		const { clock, timer, send } = setup()
		await clock.setSource("internal")
		expect(timer.bypassed).toBe(false)
		timer.stop.mockClear()
		send([0xfc])
		send([0xf8])
		send([0xfa])
		await clock.settled()
		expect(timer.externalTrigger).not.toHaveBeenCalled()
		expect(timer.stop).not.toHaveBeenCalled()
		expect(timer.isRunning).toBe(true)
		expect(clock.handle(midiToCommand([0x90, 94, 127], 0, "clock")!)).toBe(false)
	})
	it("starts from MIDI Start, emits every incoming pulse, estimates tempo, pauses and continues without rewinding", async () => {
		const { clock, timer, send } = setup()
		await clock.setSource("midi")
		expect(timer.bypassed).toBe(true)
		expect(timer.isRunning).toBe(false)
		send([0xfa])
		for (let i = 1; i <= 24; i++) {
			send([0xf8], i / 48)
		}
		await clock.settled()
		expect(timer.ticks).toBe(24)
		expect(timer.BPM).toBeCloseTo(120)
		expect(timer.resetTimer).toHaveBeenCalledTimes(1)
		send([0xfc])
		send([0xf8], 0.7)
		await clock.settled()
		expect(timer.ticks).toBe(24)
		send([0xfb])
		send([0xf8], 0.8)
		await clock.settled()
		expect(timer.ticks).toBe(25)
		expect(timer.resetTimer).toHaveBeenCalledTimes(1)
		send([0xfa])
		send([0xf8], 0.9)
		await clock.settled()
		expect(timer.ticks).toBe(1)
	})
	it("does not combine different devices and consumes a shared input only once across inactive chains", async () => {
		const { clock, timer, send, manager, chain, id } = setup()
		const clone = manager.getChain(manager.cloneChain(id))!
		await clock.setSource("midi")
		chain.setActive(false)
		clone.setActive(false)
		send([0xfa])
		send([0xf8], 0.1, "other")
		send([0xf8], 0.2)
		await clock.settled()
		expect(timer.ticks).toBe(1)
		expect(timer.resetTimer).toHaveBeenCalledTimes(1)
		await clock.setMidiDevice("other")
		expect(timer.isRunning).toBe(false)
		send([0xfa], 0.3, "other")
		send([0xf8], 0.4, "clock")
		send([0xf8], 0.5, "other")
		await clock.settled()
		expect(timer.ticks).toBe(1)
	})
	it("handles Mackie play, stop and rewind on channel 1 without treating button releases as notes", async () => {
		const { clock, timer, send } = setup()
		await clock.setSource("midi")
		send([0x90, 94, 127])
		send([0x80, 94, 0])
		send([0xf8], 0.1)
		await clock.settled()
		expect(timer.isRunning).toBe(true)
		expect(timer.ticks).toBe(1)
		expect(timer.resetTimer).not.toHaveBeenCalled()
		send([0x90, 93, 127])
		send([0x90, 93, 0])
		await clock.settled()
		expect(timer.isRunning).toBe(false)
		send([0x90, 91, 127])
		await clock.settled()
		expect(timer.resetTimer).toHaveBeenCalledTimes(1)
		expect(clock.handle(midiToCommand([0x91, 94, 127], 0, "clock")!)).toBe(false)
		expect(clock.handle(midiToCommand([0x90, 60, 127], 0, "clock")!)).toBe(false)
	})
	it("accepts MIDI Machine Control play and stop without confusing them with clock pulses", async () => {
		const { clock, timer, send } = setup()
		await clock.setSource("midi")
		send([0xf0, 0x7f, 0x7f, 6, 2, 0xf7])
		await clock.settled()
		expect(timer.isRunning).toBe(true)
		expect(timer.ticks).toBe(0)
		send([0xf0, 0x7f, 0x7f, 6, 1, 0xf7])
		await clock.settled()
		expect(timer.isRunning).toBe(false)
	})
	it("halts MIDI transport on disconnect and rejects MIDI mode when no connected port exists", async () => {
		const { clock, timer, input, send } = setup()
		await clock.setSource("midi")
		send([0xfa])
		await clock.settled()
		input.setAsDisconnected()
		await clock.settled()
		expect(timer.isRunning).toBe(false)
		expect(clockMidiPorts(setup(false).manager)).toEqual([])
		await expect(setup(false).clock.setSource("midi")).rejects.toThrow("Connect a MIDI input")
	})
	it("keeps the selected clock port on hot unplug instead of following another connected device", async () => {
		const { clock, timer, input, send } = setup()
		await clock.setSource("midi")
		send([0xfa])
		await clock.settled()
		input.inputDevices = [{ id: "other", name: "Other controller" }]
		input.dispatchEvent(new Event("deviceListChanged"))
		await clock.settled()
		expect(timer.isRunning).toBe(false)
		expect(clock.midiDevice).toBe("clock")
		send([0xfa], 0.1, "other")
		send([0xf8], 0.2, "other")
		await clock.settled()
		expect(timer.isRunning).toBe(false)
		expect(timer.ticks).toBe(0)
	})
	it("keeps shared clock authority with the room and restores the internal worker when switching back", async () => {
		const { clock, timer, manager, send, link } = setup()
		await clock.setSource("shared")
		expect(timer.bypassed).toBe(true)
		expect(timer.isRunning).toBe(false)
		timer.isRunning = true // A room session has started the timer.
		expect(manager.transportRunning).toBe(true)
		send([0xfc])
		send([0xf8], 0.1)
		await clock.settled()
		expect(timer.isRunning).toBe(true)
		expect(timer.ticks).toBe(0)
		expect(clock.handle({ type: "tempoTap" } as any)).toBe(true)
		expect(clock.handle({ type: "playbackToggle" } as any)).toBe(true)
		await clock.setSource("internal")
		expect(link.setSource).toHaveBeenLastCalledWith("internal")
		expect(timer.bypassed).toBe(false)
		expect(timer.isRunning).toBe(true)
	})
	it("allows one manual tick per press, and does not advance while paused", async () => {
		const { clock, timer, manager } = setup()
		await clock.setSource("manual")
		await clock.manualTick()
		expect(timer.ticks).toBe(1)
		await manager.transport("stop")
		await clock.manualTick()
		expect(timer.ticks).toBe(1)
		await clock.setSource("internal")
		await clock.manualTick()
		expect(timer.ticks).toBe(1)
	})
})

describe("DVS clock source", () => {
	const dvsSetup = () => setup(true, new DvsInput())
	it("is rejected unless a connected DVS input exists", async () => {
		await expect(setup(false, new DvsInput()).clock.setSource("dvs")).rejects.toThrow(
			"Connect a DVS control vinyl input"
		)
		await expect(setup().clock.setSource("dvs")).rejects.toThrow("Connect a DVS")
		expect(clockDvsInputs(dvsSetup().manager)).toHaveLength(1)
	})
	it("pulses the timer from DVS_CLOCK using the audio time, starting on DVS_START without rewinding later", async () => {
		const { clock, timer, input } = dvsSetup()
		await clock.setSource("dvs")
		expect(timer.bypassed).toBe(true)
		expect(timer.isRunning).toBe(false)
		timer.start.mockClear()
		input.send(Commands.DVS_START, 5)
		for (let i = 0; i < 24; i++) {
			input.send(Commands.DVS_CLOCK, 5 + i / 48)
		}
		await clock.settled()
		// timer.now never moved: tempo comes from the worklet's audio time
		expect(timer.now).toBe(0)
		expect(timer.isRunning).toBe(true)
		expect(timer.start).toHaveBeenCalledTimes(1)
		expect(timer.resetTimer).toHaveBeenCalledTimes(1)
		expect(timer.ticks).toBe(24)
		expect(timer.externalTrigger.mock.calls[0]).toEqual([false])
		expect(timer.BPM).toBeCloseTo(120)
	})
	it("starts on the first tick when the platter was already spinning, and swallows local transport", async () => {
		const { clock, timer, input } = dvsSetup()
		await clock.setSource("dvs")
		input.send(Commands.DVS_CLOCK, 1)
		await clock.settled()
		expect(timer.isRunning).toBe(true)
		input.send(Commands.PLAYBACK_STOP)
		await clock.settled()
		expect(timer.isRunning).toBe(true)
		input.send(Commands.DVS_STOP, 2)
		await clock.settled()
		expect(timer.isRunning).toBe(false)
		input.send(Commands.PLAYBACK_START)
		await clock.settled()
		expect(timer.isRunning).toBe(false)
	})
	it("does not pulse or touch transport from DVS commands in other modes", async () => {
		const { clock, timer, input } = dvsSetup()
		for (const source of ["internal", "manual"] as const) {
			await clock.setSource(source)
			timer.start.mockClear()
			timer.stop.mockClear()
			timer.externalTrigger.mockClear()
			input.send(Commands.DVS_START, 1)
			input.send(Commands.DVS_CLOCK, 1)
			input.send(Commands.DVS_STOP, 2)
			await clock.settled()
			expect(timer.externalTrigger).not.toHaveBeenCalled()
			expect(timer.start).not.toHaveBeenCalled()
			expect(timer.stop).not.toHaveBeenCalled()
		}
	})
	it("halts transport when the DVS input disconnects", async () => {
		const { clock, timer, input } = dvsSetup()
		await clock.setSource("dvs")
		input.send(Commands.DVS_START, 1)
		await clock.settled()
		expect(timer.isRunning).toBe(true)
		input.setAsDisconnected()
		await clock.settled()
		expect(timer.isRunning).toBe(false)
	})
	it("re-aligns the downbeat on the manual tick instead of pulsing, and pushes the reference BPM to inputs", async () => {
		const { clock, timer, input } = dvsSetup()
		await clock.setSource("dvs")
		input.send(Commands.DVS_START, 1)
		input.send(Commands.DVS_CLOCK, 1)
		await clock.settled()
		timer.resetTimer.mockClear()
		timer.externalTrigger.mockClear()
		await clock.manualTick()
		expect(timer.resetTimer).toHaveBeenCalledTimes(1)
		expect(timer.externalTrigger).not.toHaveBeenCalled()
		input.send(Commands.DVS_CLOCK, 1.02)
		await clock.settled()
		expect(timer.externalTrigger).toHaveBeenCalledWith(false)
		clock.setDvsReferenceBPM(90)
		expect(input.referenceBPM).toBe(90)
		expect(() => clock.setDvsReferenceBPM(0)).toThrow(RangeError)
	})
})

describe("Clock source controls", () => {
	it("offers DVS control vinyl only while a DVS input is connected, with a reference BPM field", async () => {
		document.body.innerHTML = readFileSync("index.html", "utf8").replace(
			/<script\b[^>]*>[\s\S]*?<\/script>/gi,
			""
		)
		const { timer, manager, input } = setup(false, new DvsInput())
		const persistBpm = vi.fn()
		const clock = createClockSourceControls(
			timer,
			manager,
			{ setSource: vi.fn(async () => {}) },
			vi.fn(),
			vi.fn(),
			async () => {},
			persistBpm
		)
		dispose.push(() => clock.destroy())
		const select = document.getElementById("clock-source") as HTMLSelectElement
		const bpm = document.getElementById("clock-dvs-bpm") as HTMLInputElement
		expect(select.querySelector('option[value="dvs"]')).toBeNull()
		input.setAsConnected()
		expect(select.querySelector('option[value="dvs"]')).not.toBeNull()
		expect(document.getElementById("clock-dvs-label")!.hidden).toBe(true)
		await clock.setSource("dvs")
		expect(document.getElementById("clock-dvs-label")!.hidden).toBe(false)
		bpm.value = "98"
		bpm.dispatchEvent(new Event("change"))
		expect(clock.dvsReferenceBPM).toBe(98)
		expect(input.referenceBPM).toBe(98)
		expect(persistBpm).toHaveBeenCalledWith(98)
		window.dispatchEvent(new Event("pagehide"))
	})
	it("starts microphone following from the select and returns to Internal on failure", async () => {
		document.body.innerHTML = readFileSync("index.html", "utf8").replace(
			/<script\b[^>]*>[\s\S]*?<\/script>/gi,
			""
		)
		const { timer, manager } = setup(false)
		const follow = vi.fn(async (_enabled: boolean) => {})
		const clock = createClockSourceControls(
			timer,
			manager,
			{ setSource: vi.fn(async () => {}) },
			vi.fn(),
			vi.fn(),
			follow
		)
		dispose.push(() => clock.destroy())
		const select = document.getElementById("clock-source") as HTMLSelectElement
		const choose = async (value: string) => {
			select.value = value
			select.dispatchEvent(new Event("change"))
			await vi.waitFor(() => expect(select.disabled).toBe(false))
		}
		await choose("microphone")
		expect(follow).toHaveBeenLastCalledWith(true)
		expect(select.value).toBe("microphone")
		expect(clock.source).toBe("internal")
		expect(timer.bypassed).toBe(false)
		await choose("manual")
		expect(follow).toHaveBeenLastCalledWith(false)
		expect((document.getElementById("btn-swing-up") as HTMLButtonElement).disabled).toBe(true)
		follow.mockImplementation(async (enabled) => {
			if (enabled) {
				throw new Error("Microphone denied")
			}
		})
		await choose("microphone")
		expect(select.value).toBe("internal")
		expect(document.getElementById("clock-source-status")!.textContent).toBe(
			"Microphone denied"
		)
		window.dispatchEvent(new Event("pagehide"))
	})

	it("adds the MIDI option on connection, hides QR controls for external clocks, and ticks via Space without typing interference", async () => {
		document.body.innerHTML = readFileSync("index.html", "utf8").replace(
			/<script\b[^>]*>[\s\S]*?<\/script>/gi,
			""
		)
		const { timer, manager, input } = setup(false)
		const persist = vi.fn()
		const clock = createClockSourceControls(
			timer,
			manager,
			{ setSource: vi.fn(async () => {}) },
			persist,
			vi.fn()
		)
		dispose.push(() => clock.destroy())
		const select = document.getElementById("clock-source") as HTMLSelectElement
		expect(select.querySelector('option[value="midi"]')).toBeNull()
		input.setAsConnected()
		expect(select.querySelector('option[value="midi"]')).not.toBeNull()
		await clock.setSource("manual")
		window.dispatchEvent(
			new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true })
		)
		await clock.settled()
		expect(timer.ticks).toBe(1)
		const text = document.createElement("textarea")
		document.body.append(text)
		text.dispatchEvent(
			new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true })
		)
		window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", repeat: true }))
		await clock.settled()
		expect(timer.ticks).toBe(1)
		expect((document.getElementById("tempo") as HTMLInputElement).disabled).toBe(true)
		expect(document.getElementById("btn-clock-tick")!.hidden).toBe(false)
		expect(persist).toHaveBeenCalledWith("manual", "clock")
		window.dispatchEvent(new Event("pagehide"))
	})
})