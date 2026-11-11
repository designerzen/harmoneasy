// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import AudioCommand from "audiobus/audio-command"
import { NOTE_ON, NOTE_OFF, CONTROL_CHANGE, PROGRAM_CHANGE, PITCH_BEND } from "audiobus/commands"
import { midiSong } from "audiobus/io/midi-song"
import { EnsembleSession, type EnsembleSettings } from "audiobus/io/ensemble-session"
import { TransformerEnsemble, ID_ENSEMBLE } from "audiobus/io/transformers/transformer-ensemble"
import { tranformerFactory } from "audiobus/io/transformer-factory"
import { getTransformerDefinition } from "audiobus/io/transformer-definitions"
import { advanceTransformers } from "audiobus/io/transformer-pipeline"
import OutputManager from "audiobus/io/output-manager"
import InputManager from "audiobus/io/input-manager"
import IOChain from "audiobus/io/IO-chain"
import { defineDevice, deviceDefinition, deviceId } from "audiobus/io/device-definition"
import AbstractInput from "audiobus/io/inputs/abstract-input"
import { INPUT_EVENT, EVENT_CHANGE } from "audiobus/event-constants"
import InputGamePad from "audiobus/io/inputs/input-gamepad"
import InputGamePadMusic from "audiobus/io/inputs/input-gamepad-music"
import { COMMANDS, GAME_PAD_DISCONNECTED, GamePadManager } from "audiobus/hardware/gamepad/gamepad"

const { Midi } = createRequire(resolve("../../packages/audiobus/package.json"))("@tonejs/midi")
function score() {
	const midi = new Midi()
	midi.header.setTempo(120)
	for (let channel = 0; channel < 3; channel++) {
		const track = midi.addTrack()
		track.channel = channel
		track.name = `Part ${channel + 1}`
		track.instrument.number = channel + 10
		for (let time = 0; time < 4; time += 0.5) {
			track.addNote({ midi: 60 + channel, time, duration: 0.25, velocity: 0.8 })
		}
		track.addCC({ number: 64, time: 0.1, value: 1 })
		track.addCC({ number: 64, time: 0.3, value: 0 })
		track.addPitchBend({ time: 0.2, value: 0.5 })
	}
	return midiSong(midi)
}
const settings = (changes: Partial<EnsembleSettings> = {}): EnsembleSettings => ({
	mode: "assisted",
	players: [
		{ source: "a", channels: [1] },
		{ source: "b", channels: [2] }
	],
	activityBeats: 2,
	assist: true,
	loop: false,
	stepBeats: 1,
	quorum: 2,
	waitSeconds: 0.5,
	...changes
})
function session(changes: Partial<EnsembleSettings> = {}) {
	const result = new EnsembleSession(settings(changes))
	result.setSong(score())
	return result
}
function advance(performance: EnsembleSession, from: number, to: number) {
	const output = []
	for (let t = from; t < to - 0.001; t += 0.1) {
		output.push(...performance.advance(Math.min(to, Math.round((t + 0.1) * 1000) / 1000)))
	}
	return output
}
const press = (from: string, at = 0) =>
	Object.assign(new AudioCommand(), {
		type: NOTE_ON,
		velocity: 100,
		from,
		number: 60,
		channel: 1,
		startAt: at
	})
const transformers: TransformerEnsemble[] = []
afterEach(() => {
	transformers.forEach((t) => t.destroy())
	transformers.length = 0
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})
async function transformer(config = {}) {
	const song = score()
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url) =>
			String(url).endsWith("index.json")
				? new Response("[]")
				: new Response(song.midi.toArray())
		)
	)
	const result = new TransformerEnsemble(config)
	transformers.push(result)
	await result.loadMIDIFile("song.mid")
	return result
}

describe("one shared ensemble performance", () => {
	it("keeps fast and slow players on the score and preserves every chord and duration", () => {
		const performance = session()
		const output = [...performance.press(0, 10)]
		for (let t = 10.05; t < 14; t += 0.05) {
			output.push(...performance.press(0, t))
			if (Math.round(t * 20) % 30 === 0) {
				output.push(...performance.press(1, t))
			}
		}
		output.push(...performance.advance(14))
		expect(output.filter((c) => c.type === NOTE_ON)).toHaveLength(24)
		for (const channel of [1, 2, 3]) {
			const on = output.filter((c) => c.type === NOTE_ON && c.channel === channel)
			const off = output.filter((c) => c.type === NOTE_OFF && c.channel === channel)
			expect(on.map((c) => Number(c.startAt.toFixed(3)))).toEqual(
				Array.from({ length: 8 }, (_, i) => 10 + i * 0.5)
			)
			expect(off.map((c, i) => Number((c.startAt - on[i].startAt).toFixed(3)))).toEqual(
				Array(8).fill(0.25)
			)
		}
	})
	it("keeps original MIDI channels, programs, sustain, pitch bend and tempo mapping", () => {
		const song = score()
		expect(
			song.events
				.filter((e) => e.command.type === PROGRAM_CHANGE)
				.map((e) => [e.command.channel, e.command.value])
		).toEqual([
			[1, 10],
			[2, 11],
			[3, 12]
		])
		expect(song.events.find((e) => e.command.type === PITCH_BEND)?.command.value).toBe(12288)
		expect(song.events.find((e) => e.command.type === CONTROL_CHANGE)?.command).toMatchObject({
			number: 64,
			value: 127
		})
		expect(song.midi.header.secondsToTicks(1)).toBe(song.midi.header.ppq * 2)
	})
	it("gates only the assigned current parts and never lets old button releases cut score notes", async () => {
		const t = await transformer({
			assist: false,
			players: [
				{ source: "a", channels: [1, 3] },
				{ source: "b", channels: [2] }
			],
			activityBeats: 1
		})
		const initial = t.transform([press("a")], { now: 0 } as any)
		expect(initial.filter((c) => c.type === NOTE_ON).map((c) => c.channel)).toEqual([1, 3])
		expect(
			t.transform([Object.assign(press("a", 0.1), { type: NOTE_OFF })], { now: 0.1 } as any)
		).toEqual([])
		const releases = t.tick(0.25, {} as any).filter((c) => c.type === NOTE_OFF)
		expect(releases.map((c) => c.channel)).toEqual([1, 3])
		t.tick(0.5, {} as any)
		const joined = t.transform([press("b", 0.75)], { now: 0.75 } as any)
		expect(joined.filter((c) => c.type === NOTE_ON)).toEqual([])
		expect(
			t
				.tick(1, {} as any)
				.filter((c) => c.type === NOTE_ON)
				.map((c) => c.channel)
		).toEqual([2])
	})
	it("brings active parts forward while assistance keeps inactive parts audible", () => {
		const output = session()
			.press(0, 0)
			.filter((c) => c.type === NOTE_ON)
		expect(output.find((c) => c.channel === 1)!.velocity).toBeGreaterThan(
			output.find((c) => c.channel === 2)!.velocity
		)
	})
	it("counts each player once for together steps and holds boundary notes for the next step", () => {
		const performance = session({ mode: "together", assist: false })
		expect(performance.press(0, 0)).toEqual([])
		expect(performance.press(0, 0.01)).toEqual([])
		expect(performance.press(1, 0.02).filter((c) => c.type === NOTE_ON)).toHaveLength(3)
		const output = advance(performance, 0.02, 1)
		expect(output.filter((c) => c.type === NOTE_ON)).toEqual([])
		expect(performance.state.position).toBe(0.5)
		performance.press(1, 1.1)
		const next = performance.press(0, 1.2).filter((c) => c.type === NOTE_ON)
		expect(next).toHaveLength(3)
		expect(next.map((c) => c.startAt)).toEqual([1.2, 1.2, 1.2])
	})
	it("assists a missing together vote after the configured timeout", () => {
		const performance = session({ mode: "together" })
		performance.press(0, 0)
		const output = advance(performance, 0, 0.6)
		expect(output.filter((c) => c.type === NOTE_ON)).toHaveLength(3)
	})
	it("smooths conductor tempo, bounds it, and gives players equal weight", () => {
		const performance = session({ mode: "conductor", loop: true })
		performance.press(0, 0)
		performance.press(1, 0)
		for (let n = 1; n < 60; n++) {
			const now = n * 0.1
			performance.advance(now)
			performance.press(0, now)
			if (n % 6 === 0) {
				performance.press(1, now)
			}
		}
		expect(performance.state.speed).toBeGreaterThanOrEqual(0.75)
		expect(performance.state.speed).toBeLessThan(1.2)
	})
	it("releases notes and sustain on reset, then starts from the beginning", () => {
		const performance = session()
		performance.press(0, 0)
		performance.advance(0.1)
		performance.reset()
		const output = performance.advance(0.2)
		expect(output.filter((c) => c.type === NOTE_OFF)).toHaveLength(3)
		expect(
			output.filter((c) => c.type === CONTROL_CHANGE && c.number === 64 && c.value === 0)
		).toHaveLength(3)
		expect(performance.advance(0.3)).toEqual([])
		expect(performance.press(0, 1).filter((c) => c.type === NOTE_ON)).toHaveLength(3)
	})
	it("loops with channel setup and stops cleanly when repeat is disabled", () => {
		const performance = session({ loop: true })
		performance.press(0, 0)
		const output = advance(performance, 0, 4)
		expect(output.filter((c) => c.type === PROGRAM_CHANGE)).toHaveLength(3)
		expect(performance.state.running).toBe(true)
		const finite = session()
		finite.press(0, 0)
		advance(finite, 0, 4)
		expect(finite.state.ended).toBe(true)
		expect(finite.press(1, 4.1)).toEqual([])
	})
	it("rejoins after host suspension without replaying a burst of missed notes", () => {
		const performance = session()
		performance.press(0, 0)
		const output = performance.advance(3.1)
		expect(output.filter((c) => c.type === NOTE_ON)).toHaveLength(0)
		expect(output.some((c) => c.type === CONTROL_CHANGE)).toBe(true)
		expect(performance.state.position).toBeCloseTo(3.1)
	})
	it("carries a player's activity window over the song loop", () => {
		const performance = session({ loop: true, assist: false, activityBeats: 4 })
		performance.press(0, 0)
		advance(performance, 0, 3.5)
		performance.press(0, 3.5)
		const output = advance(performance, 3.5, 4.1)
		expect(
			output.filter((c) => c.type === NOTE_ON && c.startAt >= 3.75).map((c) => c.channel)
		).toEqual([1])
	})
	it("handles tempo changes in score time rather than assuming a fixed BPM", () => {
		const song = score()
		song.midi.header.tempos = [
			{ ticks: 0, bpm: 120 },
			{ ticks: song.midi.header.ppq * 2, bpm: 60 }
		]
		song.midi.header.update()
		const performance = new EnsembleSession(settings({ assist: false, activityBeats: 4 }))
		performance.setSong(midiSong(song.midi))
		performance.press(0, 0)
		expect(song.midi.header.ticksToSeconds(song.midi.header.ppq * 4)).toBe(3)
		advance(performance, 0, 2)
		expect(performance.state.position).toBeCloseTo(2)
	})
})

describe("ensemble registration and unlimited local membership", () => {
	it("registers in the transformer factory and picker", () => {
		const t = tranformerFactory(ID_ENSEMBLE) as TransformerEnsemble
		transformers.push(t)
		expect(t).toBeInstanceOf(TransformerEnsemble)
		expect(getTransformerDefinition(ID_ENSEMBLE)?.name).toBe("Ensemble")
	})
	it("accepts more than six players, keeps identity across joins, and persists assignments", async () => {
		const t = await transformer()
		for (let n = 0; n < 20; n++) {
			t.transform([press(`controller-${n}`, n * 0.01)], { now: n * 0.01 } as any)
		}
		expect(t.options.players).toHaveLength(20)
		expect(t.performanceState.position).toBeCloseTo(0.19)
		expect(new Set(t.options.players.map((p) => p.source)).size).toBe(20)
		const saved = JSON.parse(t.exportConfig())
		const restored = new TransformerEnsemble({ ...saved, midiFileUrl: "" })
		transformers.push(restored)
		expect(restored.options.players).toEqual(t.options.players)
		t.transform([press("controller-0", 0.2)], { now: 0.2 } as any)
		expect(t.options.players).toHaveLength(20)
	})
	it("ignores unassigned inputs when automatic joining is disabled", async () => {
		const t = await transformer({ autoJoin: false })
		expect(t.transform([press("unknown")], { now: 0 } as any)).toEqual([])
		expect(t.performanceState.running).toBe(false)
	})
	it("keeps the playhead and other players' activity when membership is edited", async () => {
		const t = await transformer({ assist: false })
		t.transform([press("a"), press("b")], { now: 0 } as any)
		t.tick(0.25, {} as any)
		t.addPlayer()
		t.removePlayer(0)
		expect(t.performanceState.position).toBe(0.25)
		expect(
			t
				.tick(0.5, {} as any)
				.filter((c) => c.type === NOTE_ON)
				.map((c) => c.channel)
		).toEqual([2])
	})
	it("rejects an invalid replacement and ignores an older load finishing later", async () => {
		const t = await transformer()
		let finish!: (response: Response) => void
		vi.stubGlobal(
			"fetch",
			vi.fn((url) =>
				String(url).endsWith("old.mid")
					? new Promise<Response>((resolve) => {
							finish = resolve
						})
					: Promise.resolve(new Response("invalid MIDI"))
			)
		)
		const oldLoad = t.loadMIDIFile("old.mid")
		await t.loadMIDIFile("invalid.mid")
		finish(new Response(score().midi.toArray()))
		await oldLoad
		expect(t.transform([press("a")], { now: 0 } as any)).toEqual([])
		expect(t.performanceState.running).toBe(false)
	})
	it("does not leak input notes before a file is loaded or after destruction", () => {
		const t = new TransformerEnsemble()
		transformers.push(t)
		expect(t.transform([press("a")], {} as any)).toEqual([])
		t.destroy()
		expect(t.transform([press("a")], {} as any)).toEqual([])
	})
	it("advances through the clock pipeline even without more button presses", async () => {
		const t = await transformer()
		t.transform([press("a")], { now: 0 } as any)
		advanceTransformers([t], 0.25, {} as any)
		expect(
			advanceTransformers([t], 0.5, {} as any).filter((c) => c.type === NOTE_ON)
		).toHaveLength(3)
		t.setConfig("enabled", false)
		expect(
			advanceTransformers([t], 0.6, {} as any).filter((c) => c.type === NOTE_OFF)
		).toHaveLength(3)
		expect(advanceTransformers([t], 0.75, {} as any)).toEqual([])
	})
	it("renders dynamic player controls and learns an input without hand-entered IDs", async () => {
		const t = await transformer({ autoJoin: false })
		const gui = await t.createGui()
		for (let n = 0; n < 8; n++) {
			t.addPlayer()
		}
		expect(gui.querySelectorAll("fieldset")).toHaveLength(8)
		;(gui.querySelector("fieldset button") as HTMLButtonElement).click()
		t.transform([press("learned-pad")], { now: 0 } as any)
		expect(t.options.players[0].source).toBe("learned-pad")
		expect((gui.querySelector("fieldset input") as HTMLInputElement).value).toBe("learned-pad")
		t.removePlayer(7)
		expect(gui.querySelectorAll("fieldset")).toHaveLength(7)
	})
	it("keeps distinct input components separate even when their source labels are identical", () => {
		class Input extends AbstractInput {
			destroy() {}
		}
		const a = new Input(),
			b = new Input(),
			manager = new InputManager()
		manager.add(a)
		manager.add(b)
		const commands: any[] = []
		manager.addEventListener(INPUT_EVENT, (event: any) => commands.push(event.command))
		a.dispatch(press("same"))
		b.dispatch(press("same"))
		expect(commands.map((c) => c.inputId)).toEqual([deviceId(a), deviceId(b)])
		expect(commands[0].inputId).not.toBe(commands[1].inputId)
		manager.destroy()
	})
})

describe("output channel selection", () => {
	class Output extends EventTarget {
		uuid = "output"
		name = "output"
		description = ""
		isConnected = true
		isHidden = false
		options: Record<string, any> = {}
		noteOn = vi.fn()
		noteOff = vi.fn()
		allNotesOff = vi.fn()
		sendCommand = vi.fn()
		getNoteKey(c: any) {
			return `${c.channel}:${c.number}`
		}
	}
	it.each(["stop", "remove", "replace", "destroy"])(
		"releases pedals immediately on chain %s without waiting for another clock tick",
		async (action) => {
			const t = await transformer()
			const timer = { now: 0, BPM: 120 } as any
			const chain = new IOChain(timer)
			chain.setTransformers([t])
			const output = new Output()
			chain.addOutput(output)
			await chain.transform([press("player")], timer)
			await chain.triggerAudioCommandsOnDevice(chain.executeQueueAndClearComplete(0))
			timer.now = 0.1
			await chain.triggerAudioCommandsOnDevice(chain.updateTimeForCommandQueue(0.1, 1, {}))
			output.sendCommand.mockClear()
			if (action === "stop") {
				chain.clearNoteCommands()
			}
			if (action === "remove") {
				chain.transformerManager.removeTransformer(t)
			}
			if (action === "replace") {
				chain.setTransformers([])
			}
			if (action === "destroy") {
				chain.destroy()
			}
			await OutputManager.settled(output)
			expect(
				output.sendCommand.mock.calls.filter(
					([c]) => c.type === CONTROL_CHANGE && c.number === 64 && c.value === 0
				)
			).toHaveLength(3)
			expect(output.sendCommand.mock.calls.filter(([c]) => c.type === NOTE_OFF)).toHaveLength(
				3
			)
			chain.destroy()
		}
	)
	it("filters incoming channels before output remapping and preserves note releases", async () => {
		const manager = new OutputManager()
		const a = defineDevice(new Output(), {
			factory: "output",
			options: { receiveChannels: [1, 3] }
		})
		const b = defineDevice(new Output(), {
			factory: "output",
			options: { receiveChannels: [2] }
		})
		manager.add(a)
		manager.add(b)
		const notes = [1, 2, 3].map((channel) => Object.assign(press("song"), { channel }))
		await manager.triggerAudioCommandsOnOutputs(notes)
		await manager.triggerAudioCommandsOnOutputs(
			notes.map((c) => ({ ...c, type: NOTE_OFF, velocity: 0 }))
		)
		expect(a.sendCommand.mock.calls.map(([c]) => c.channel)).toEqual([1, 3, 1, 3])
		expect(b.sendCommand.mock.calls.map(([c]) => c.channel)).toEqual([2, 2])
		manager.destroy()
	})
	it("persists receive-channel edits and clears held notes when routing changes", async () => {
		const output = defineDevice(new Output(), { factory: "output" })
		const gui = await output.createGui!()
		const input = gui.querySelector("input")!
		input.value = "2, 10"
		input.dispatchEvent(new Event(EVENT_CHANGE))
		expect(output.allNotesOff).toHaveBeenCalledOnce()
		expect(deviceDefinition(output).options?.receiveChannels).toEqual([2, 10])
		input.value = "99"
		input.dispatchEvent(new Event(EVENT_CHANGE))
		expect(deviceDefinition(output).options?.receiveChannels).toEqual([2, 10])
	})
})

describe("independent identical gamepads", () => {
	function setup() {
		vi.stubGlobal("window", new EventTarget())
		vi.stubGlobal("navigator", { getGamepads: () => [] })
		vi.stubGlobal("requestAnimationFrame", () => 1)
		vi.stubGlobal("cancelAnimationFrame", () => {})
		vi.spyOn(console, "log").mockImplementation(() => {})
		vi.spyOn(console, "info").mockImplementation(() => {})
	}
	it("keeps raw button identities, velocities, sources and disconnect releases separate", () => {
		setup()
		const input = new InputGamePad({ now: () => 0 })
		const commands: any[] = []
		input.addEventListener(INPUT_EVENT, (event: any) => commands.push(event.command))
		const pad = (index: number) => ({ index, id: "identical model" }) as any
		;(input as any).onGamePadEvent(COMMANDS.A, 1, pad(0), 0)
		;(input as any).onGamePadEvent(COMMANDS.A, 1, pad(1), 0)
		;(input as any).onGamePadEvent(COMMANDS.A, 0, pad(0), 0)
		expect(commands[0].from).not.toBe(commands[1].from)
		expect(commands[0]).toMatchObject({ type: NOTE_ON, velocity: 127 })
		expect(input.gamepadHeld.size).toBe(1)
		;(input as any).onGamePadEvent(GAME_PAD_DISCONNECTED, 0, pad(1), 0)
		expect(commands.at(-1)).toMatchObject({ type: NOTE_OFF, from: commands[1].from })
		input.destroy()
	})
	it("keeps music modes and emitted sources separate per gamepad", () => {
		setup()
		const input = new InputGamePadMusic({ now: () => 0 })
		const commands: any[] = []
		input.addEventListener(INPUT_EVENT, (event: any) => commands.push(event.command))
		const pad = (index: number) => ({ index, id: "same" }) as any
		;(input as any).onGamePadEvent(COMMANDS.SELECT, 1, pad(0), 0)
		expect(input.state.currentMode).toBe("melodic")
		;(input as any).onGamePadEvent(COMMANDS.A, 1, pad(1), 0)
		expect(input.state.currentMode).toBe("chord")
		const source = commands.find((c) => c.type === NOTE_ON).from
		;(input as any).onGamePadEvent(COMMANDS.A, 1, pad(0), 0)
		expect(commands.filter((c) => c.type === NOTE_ON).at(-1).from).not.toBe(source)
		input.destroy()
	})
	it("keeps manager-held buttons and source identity when another controller disconnects", () => {
		setup()
		const manager = new GamePadManager()
		const connect = (index: number) => {
			const event = Object.assign(new Event("gamepadconnected"), {
				gamepad: {
					index,
					id: "same model",
					connected: true,
					mapping: "standard",
					buttons: [],
					axes: []
				}
			})
			window.dispatchEvent(event)
			return event.gamepad
		}
		const device = connect(0)
		connect(1)
		const pad = manager.controllers.get(0)!
		pad.dispatch("a", true)
		manager.controllers.get(1)!.dispatch("a", true)
		expect(manager.isHeld("a", 0)).toBe(true)
		expect(manager.isHeld("a", 2)).toBe(false)
		window.dispatchEvent(Object.assign(new Event("gamepaddisconnected"), { gamepad: device }))
		expect(pad.id).toBe("same model")
		expect(manager.isHeld("a", 0)).toBe(false)
		expect(manager.isHeld("a", 1)).toBe(true)
		manager.destroy()
	})
})
