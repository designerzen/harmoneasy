// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import InputEventLoop from "../../../packages/audiobus/io/inputs/input-event-loop"
import InputScaleExplorer from "../../../packages/audiobus/io/inputs/input-scale-explorer"
import { defineDevice } from "../../../packages/audiobus/io/device-definition"
import IOChain from "../../../packages/audiobus/io/IO-chain"
import IOChainManager from "../../../packages/audiobus/io/IO-chain-manager"
import AbstractInput from "../../../packages/audiobus/io/inputs/abstract-input"
import AudioEventRecorder from "../../../packages/audiobus/audio-event-recorder"
import { TransformerVelocityShaper } from "../../../packages/audiobus/io/transformers/transformer-velocity-shaper"
import { TransformerChordTrack } from "../../../packages/audiobus/io/transformers/transformer-chord-track"
import { TransformerProbabilityGate } from "../../../packages/audiobus/io/transformers/transformer-probability-gate"
import {
	EVENT_INPUT,
	EVENT_CHANGE,
	EVENT_WORKSPACE_RESTORED
} from "../../../packages/audiobus/event-constants"
import { EVENT_PROCESSOR_ACTIVITY } from "../../../packages/audiobus/event-constants"
import { NOTE_ON, NOTE_OFF, INPUT_EVENT } from "../../../packages/audiobus/commands"
import { musicalCommand } from "../../../packages/audiobus/io/event-clip"
import {
	createMusicalFeatureControls,
	capturedClip
} from "../source/services/musical-feature-controls"
import { macroTargets, mountPerformanceControls } from "../source/services/performance-tools"
import { MidiControls } from "../source/services/midi-controls"
import { domMidiTargets } from "../source/services/midi-control-panel"
import { AcousticTempoFollower } from "../source/services/acoustic-tempo"

const cleanups: (() => void)[] = []
afterEach(() => {
	cleanups
		.splice(0)
		.reverse()
		.forEach((fn) => fn())
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
	vi.useRealTimers()
	document.body.replaceChildren()
})
class Input extends AbstractInput {
	destroy() {}
}
function setup() {
	document.body.innerHTML =
		'<nav><button id="btn-settings">Settings</button><button id="btn-midi">MIDI</button></nav><dialog id="settings-dialog"><form id="settings-form"></form></dialog><dialog id="midi-dialog"><div id="midi-control-settings"></div><div id="midi-macro-controls"></div></dialog><div id="clock-controls"><select id="clock-source"></select></div><dialog id="export-dialog"></dialog><input id="volume" type="range" min="0" max="100" value="50"><input id="tempo" type="range" min="20" max="303" value="120"><input id="swing" type="range" min="0" max="1" step="0.01" value="0">'
	const timer = {
		now: 0,
		BPM: 120,
		isRunning: true,
		start: vi.fn(async () => {
			timer.isRunning = true
		}),
		stop: vi.fn(async () => {
			timer.isRunning = false
		}),
		resetTimer() {}
	}
	const sink = {
		uuid: "sink",
		name: "Synth",
		isConnected: true,
		isHidden: false,
		description: "",
		noteOn: vi.fn(),
		noteOff: vi.fn(),
		allNotesOff: vi.fn(),
		sendCommand: vi.fn(async () => {})
	}
	const input = new Input()
	input.setAsConnected()
	const manager = new IOChainManager({
		timer: timer as any,
		outputMixer: {} as any,
		externalDevices: { input, sink }
	})
	const chain = new IOChain(timer as any)
	chain.setTransformers([])
	chain.addInput(input)
	chain.addOutput(sink)
	manager.addChain(chain)
	const analyser = {
		fftSize: 256,
		disconnect: vi.fn(),
		getFloatTimeDomainData: (data: Float32Array) => data.fill(0)
	}
	const context = {
		state: "running",
		resume: vi.fn(async () => {}),
		createAnalyser: vi.fn(() => analyser)
	} as any
	const master = { gain: { value: 0.5 }, connect: vi.fn(), disconnect: vi.fn() } as any
	const midi = new MidiControls(() => domMidiTargets(document))
	cleanups.push(() => manager.destroy())
	return { timer, sink, input, manager, chain, context, master, midi }
}
const button = (label: string, root: ParentNode = document) =>
	[...root.querySelectorAll("button")].find((button) => button.textContent === label)!
const settle = async () => {
	await Promise.resolve()
	await Promise.resolve()
	await Promise.resolve()
}

describe("contextual musical controls", () => {
	it("identifies the processor suppressing commands and disables tracing when closed", async () => {
		const s = setup()
		const gate = new TransformerProbabilityGate({ chance: 0 })
		s.chain.setTransformers([gate])
		const trace = vi.fn()
		s.chain.addEventListener(EVENT_PROCESSOR_ACTIVITY, trace)
		s.chain.diagnosticsEnabled = true
		await s.chain.addCommandToQueue(
			musicalCommand({ type: NOTE_ON, number: 60, velocity: 100, channel: 1, startAt: 0 })
		)
		expect(trace.mock.calls[0][0].detail).toMatchObject({
			name: gate.name,
			input: 1,
			output: 0
		})
		s.chain.diagnosticsEnabled = false
		await s.chain.addCommandToQueue(
			musicalCommand({ type: NOTE_ON, number: 64, velocity: 100, channel: 1, startAt: 0 })
		)
		expect(trace).toHaveBeenCalledOnce()
	})
	it("uses transformer controls to change audible notes without adding toolbar dialogs", async () => {
		vi.useFakeTimers()
		const s = setup()
		const tools = createMusicalFeatureControls({
			...s,
			recorder: new AudioEventRecorder(),
			recording: {} as any,
			getBpm: () => 120,
			getSwing: () => 0,
			getNow: () => s.timer.now,
			beatsPerBar: () => 4,
			setTempo: vi.fn(),
			canFollow: () => true,
			persistMidi: vi.fn()
		})
		cleanups.push(tools.destroy)
		expect(
			document.querySelector(
				"#btn-music-tools, #btn-performance, #music-tools-dialog, #performance-dialog"
			)
		).toBeNull()
		expect(document.querySelectorAll("#midi-dialog .performance-macro")).toHaveLength(4)
		expect(
			domMidiTargets(document).some(
				(target) => target.id === "performance-macro-0:INPUT:value"
			)
		).toBe(true)
		const track = new TransformerChordTrack({ role: "chords" })
		s.chain.appendTransformer(track)
		const gui = await track.createGui()
		document.body.append(gui)
		const root = [...gui.querySelectorAll("label")]
			.find((label) => label.textContent?.startsWith("Root"))!
			.querySelector("select")!
		root.value = "2"
		root.dispatchEvent(new Event(EVENT_CHANGE))
		expect(s.manager.musicTools.progression[0]).toMatchObject({ root: 2, mask: 580 })
		tools.tick(0)
		await s.chain.addCommandToQueue(
			musicalCommand({ type: NOTE_ON, number: 60, velocity: 100, channel: 1, startAt: 0 })
		)
		await s.chain.triggerAudioCommandsOnDevice(s.chain.updateTimeForCommandQueue(0, 0, {}))
		expect(s.sink.sendCommand.mock.calls.map(([command]) => command.number)).toEqual([
			62, 66, 69
		])
		const details = [...document.querySelectorAll("#settings-form details")].find(
			(item) => item.querySelector("summary")?.textContent === "Sound diagnostics"
		)! as HTMLDetailsElement
		details.open = true
		details.dispatchEvent(new Event("toggle"))
		expect(s.chain.diagnosticsEnabled).toBe(true)
		document.getElementById("settings-dialog")!.dispatchEvent(new Event("close"))
		expect(s.chain.diagnosticsEnabled).toBe(false)
	})
	it("captures the next bar, retains releases and saves a usable groove", async () => {
		const s = setup()
		const tools = createMusicalFeatureControls({
			...s,
			recorder: new AudioEventRecorder(),
			recording: {} as any,
			getBpm: () => 120,
			getSwing: () => 0,
			getNow: () => s.timer.now,
			beatsPerBar: () => 4,
			setTempo: vi.fn(),
			canFollow: () => true,
			persistMidi: vi.fn()
		})
		cleanups.push(tools.destroy)
		const loop = defineDevice(new InputEventLoop(), { factory: "input", type: "event-loop" })
		s.manager.addDevice(s.chain, loop, "input")
		document.body.append(await loop.createGui())
		tools.tick(0)
		button("Capture next bar as groove").click()
		await settle()
		s.timer.now = 2
		tools.tick(4)
		for (const [time, type] of [
			[2.02, NOTE_ON],
			[2.2, NOTE_OFF],
			[2.52, NOTE_ON],
			[2.7, NOTE_OFF]
		] as const) {
			s.timer.now = time
			s.manager.dispatchEvent(
				new CustomEvent(INPUT_EVENT, {
					detail: {
						chainId: s.manager.activeChainId,
						command: musicalCommand({
							type,
							number: 60,
							channel: 1,
							velocity: type === NOTE_ON ? 90 : 0,
							startAt: time
						})
					}
				})
			)
		}
		s.timer.now = 4
		tools.tick(8)
		await settle()
		expect(s.manager.musicTools.grooves).toHaveLength(1)
		expect(s.manager.musicTools.grooves[0].velocities).toContain(90)
	})
	it("cancels a pending capture when the workspace is replaced", async () => {
		const s = setup()
		const tools = createMusicalFeatureControls({
			...s,
			recorder: new AudioEventRecorder(),
			recording: {} as any,
			getBpm: () => 120,
			getSwing: () => 0,
			getNow: () => s.timer.now,
			beatsPerBar: () => 4,
			setTempo: vi.fn(),
			canFollow: () => true,
			persistMidi: vi.fn()
		})
		cleanups.push(tools.destroy)
		const loop = defineDevice(new InputEventLoop(), { factory: "input", type: "event-loop" })
		s.manager.addDevice(s.chain, loop, "input")
		document.body.append(await loop.createGui())
		button("Capture next bar as groove").click()
		await settle()
		s.manager.dispatchEvent(new Event(EVENT_WORKSPACE_RESTORED))
		await settle()
		expect(document.body.textContent).toContain(
			"Capture cancelled because the workspace changed"
		)
	})
	it("applies groove timing to the Event Loop input and plays the edited notes through its output", async () => {
		const s = setup()
		const tools = createMusicalFeatureControls({
			...s,
			recorder: new AudioEventRecorder(),
			recording: {} as any,
			getBpm: () => 120,
			getSwing: () => 0,
			getNow: () => s.timer.now,
			beatsPerBar: () => 4,
			setTempo: vi.fn(),
			canFollow: () => true,
			persistMidi: vi.fn()
		})
		cleanups.push(tools.destroy)
		const loop = defineDevice(
			new InputEventLoop({
				duration: 1,
				commands: [
					musicalCommand({
						type: NOTE_ON,
						number: 64,
						channel: 1,
						velocity: 100,
						startAt: 0
					}),
					musicalCommand({
						type: NOTE_OFF,
						number: 64,
						channel: 1,
						velocity: 0,
						startAt: 0.2
					})
				]
			}),
			{ factory: "input", type: "event-loop" }
		)
		s.manager.addDevice(s.chain, loop, "input")
		const state = s.manager.musicTools
		state.grooves = [
			{ name: "Late and soft", division: 0.25, offsets: [0.1], velocities: [50] }
		]
		s.manager.setMusicTools(state)
		const gui = await loop.createGui()
		document.body.append(gui)
		button("Apply groove to this loop", gui).click()
		await settle()
		expect(loop.options.commands[0]).toMatchObject({ startAt: 0.05, velocity: 50 })
		expect(loop.options.commands[1].startAt).toBeCloseTo(0.25)
		loop.startClock()
		loop.updateTime(0)
		s.timer.now = 0.05
		loop.updateTime(0.05)
		await settle()
		await s.chain.triggerAudioCommandsOnDevice(s.chain.updateTimeForCommandQueue(0.05, 0, {}))
		expect(s.sink.sendCommand).toHaveBeenCalledWith(
			expect.objectContaining({ type: NOTE_ON, number: 64, velocity: 50 })
		)
	})
	it("auditions routes through the owning Scale Explorer chain even when another chain is active", async () => {
		const s = setup()
		const tools = createMusicalFeatureControls({
			...s,
			recorder: new AudioEventRecorder(),
			recording: {} as any,
			getBpm: () => 120,
			getSwing: () => 0,
			getNow: () => s.timer.now,
			beatsPerBar: () => 4,
			setTempo: vi.fn(),
			canFollow: () => true,
			persistMidi: vi.fn()
		})
		cleanups.push(tools.destroy)
		const explorer = defineDevice(
			new InputScaleExplorer({ ...s.manager.deviceOptions, source: "custom", mask: 145 }),
			{
				factory: "input",
				type: "scale-explorer"
			}
		)
		s.manager.addDevice(s.chain, explorer, "input")
		s.manager.setActiveChain(s.manager.createEmptyChain())
		const gui = await explorer.createGui()
		document.body.append(gui)
		button("Find musical routes", gui).click()
		await settle()
		button("Audition", gui).click()
		await settle()
		await s.chain.triggerAudioCommandsOnDevice(s.chain.updateTimeForCommandQueue(1, 0, {}))
		expect(
			s.sink.sendCommand.mock.calls
				.filter(([command]) => command.type === NOTE_ON)
				.map(([command]) => command.number)
		).toEqual([60, 64, 67])
		button("Use as chord progression", gui).click()
		await settle()
		expect(s.manager.musicTools.progression[0].mask).toBe(145)
		expect(s.manager.musicTools.progression.at(-1)!.mask).toBe(529)
	})
	it("normalizes recorded events and closes held notes at the end", () => {
		const clip = capturedClip([
			musicalCommand({ type: NOTE_ON, number: 60, channel: -1, velocity: 100, startAt: 100 })
		])
		expect(
			clip.commands.map((command) => [command.type, command.channel, command.startAt])
		).toEqual([
			[NOTE_ON, 1, 0],
			[NOTE_OFF, 1, 0.1]
		])
	})
})

describe("performance macro controls", () => {
	it("smooths numeric mappings, persists their values, exposes MIDI targets and survives missing devices", async () => {
		vi.useFakeTimers()
		const s = setup()
		const shaper = new TransformerVelocityShaper()
		s.chain.appendTransformer(shaper)
		const target = macroTargets(s.manager).find((target) => target.id.endsWith(":fixed"))!
		const state = s.manager.musicTools
		state.macros[0].smoothing = 0
		state.macros[0].mappings = [{ target: target.id, minimum: 20, maximum: 100 }]
		s.manager.setMusicTools(state)
		const host = document.createElement("div"),
			status = document.createElement("p")
		document.body.append(host, status)
		const controls = mountPerformanceControls(host, s.manager, s.midi, status)
		cleanups.push(controls.destroy)
		controls.refresh()
		const slider = document.getElementById("performance-macro-0") as HTMLInputElement
		slider.value = "0.5"
		slider.dispatchEvent(new Event(EVENT_INPUT))
		slider.dispatchEvent(new Event(EVENT_CHANGE))
		await vi.advanceTimersByTimeAsync(50)
		expect(shaper.options.fixed).toBe(60)
		expect(s.manager.musicTools.macros[0].value).toBe(0.5)
		expect(
			domMidiTargets(document).some(
				(target) => target.id === "performance-macro-0:INPUT:value"
			)
		).toBe(true)
		button("MIDI learn", host).click()
		await settle()
		expect(s.midi.learning).toBe("performance-macro-0:INPUT:value")
		s.chain.removeTransformer(shaper)
		slider.value = "1"
		slider.dispatchEvent(new Event(EVENT_INPUT))
		await vi.advanceTimersByTimeAsync(50)
		expect(status.textContent).not.toContain("Error")
	})
	it("offers stable brightness and expression targets for instrument outputs", async () => {
		const s = setup()
		const target = macroTargets(s.manager).find((target) => target.id.endsWith(":cc:74"))!
		await target.apply(64.7)
		expect(s.sink.sendCommand).toHaveBeenCalledWith(
			expect.objectContaining({ number: 74, value: 65, channel: 1 })
		)
	})
})

describe("acoustic follower resource lifecycle", () => {
	it("releases a late microphone permission result after cancellation", async () => {
		let grant!: (stream: any) => void
		vi.stubGlobal("navigator", {
			mediaDevices: { getUserMedia: vi.fn(() => new Promise((resolve) => (grant = resolve))) }
		})
		const track = { stop: vi.fn() }
		const context = { resume: vi.fn(async () => {}) } as any
		const follower = new AcousticTempoFollower(
			context,
			() => 120,
			vi.fn(),
			vi.fn(),
			() => true
		)
		const start = follower.start()
		await settle()
		follower.stop()
		grant({ getTracks: () => [track] })
		await start
		expect(track.stop).toHaveBeenCalledOnce()
		expect(follower.active).toBe(false)
	})
	it("disconnects microphone nodes and tracks if the clock source changes", async () => {
		let next!: FrameRequestCallback
		vi.stubGlobal(
			"requestAnimationFrame",
			vi.fn((callback) => {
				next = callback
				return 1
			})
		)
		vi.stubGlobal("cancelAnimationFrame", vi.fn())
		const track = { stop: vi.fn(), addEventListener: vi.fn() }
		vi.stubGlobal("navigator", {
			mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) }
		})
		const source = { connect: vi.fn(), disconnect: vi.fn() },
			analyser = { fftSize: 1024, disconnect: vi.fn(), getFloatTimeDomainData: vi.fn() }
		const context = {
			resume: vi.fn(async () => {}),
			createMediaStreamSource: vi.fn(() => source),
			createAnalyser: vi.fn(() => analyser)
		} as any
		let allowed = true
		const follower = new AcousticTempoFollower(
			context,
			() => 120,
			vi.fn(),
			vi.fn(),
			() => allowed
		)
		await follower.start()
		expect(follower.active).toBe(true)
		allowed = false
		next(0)
		expect(track.stop).toHaveBeenCalledOnce()
		expect(source.disconnect).toHaveBeenCalledOnce()
		expect(follower.active).toBe(false)
	})
})