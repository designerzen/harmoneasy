// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import AudioCommand from "audiobus/commands/audio-command"
import {
	NOTE_ON,
	NOTE_OFF,
	CONTROL_CHANGE,
	PROGRAM_CHANGE,
	PITCH_BEND
} from "audiobus/commands/commands"
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
import { INPUT_EVENT, EVENT_CHANGE } from "audiobus/events/event-constants"
import InputGamePad from "audiobus/io/inputs/input-gamepad"
import InputGamePadMusic from "audiobus/io/inputs/input-gamepad-music"
import { COMMANDS, GAME_PAD_DISCONNECTED, GamePadManager } from "audiobus/hardware/gamepad/gamepad"
import { setControlRenderer } from "audiobus/io/component-ui"
import { createDomGui } from "control-surface/dom"

setControlRenderer(createDomGui)

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
			track.addNote({
				midi: 60 + channel,
				time,
				duration: 0.25,
				velocity: 0.8
			})
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
	it("plays only requested onsets and never lets button releases cut score notes", async () => {
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
		// Releases are sent ahead at the score's own time, never at the button release.
		const releases = t
			.transform([Object.assign(press("a", 0.1), { type: NOTE_OFF })], {
				now: 0.1
			} as any)
			.filter((c) => c.type === NOTE_ON || c.type === NOTE_OFF)
		expect(
			releases.map((c) => [c.type, c.channel, Math.round(c.audioTime! * 1000) / 1000])
		).toEqual([
			[NOTE_OFF, 1, 0.25],
			[NOTE_OFF, 3, 0.25]
		])
		t.tick(0.25, {} as any)
		t.tick(0.5, {} as any)
		const joined = t.transform([press("b", 0.75)], { now: 0.75 } as any)
		expect(joined.filter((c) => c.type === NOTE_ON).map((c) => c.channel)).toEqual([2])
		expect(
			t
				.tick(1, {} as any)
				.filter((c) => c.type === NOTE_ON)
				.map((c) => c.channel)
		).toEqual([])
	})
	it("brings active parts forward while assistance keeps inactive parts audible", () => {
		const output = session()
			.press(0, 0)
			.filter((c) => c.type === NOTE_ON)
		expect(output.find((c) => c.channel === 1)!.velocity).toBeGreaterThan(
			output.find((c) => c.channel === 2)!.velocity
		)
	})
	it("sends notes ahead at their score time however unevenly the clock ticks", () => {
		const onsets = (ticks: number[]) => {
			const performance = session({ lookahead: 0.15 })
			const sent = [
				...performance.press(0, 0).map((c) => [0, c] as const),
				...ticks.flatMap((t) => performance.advance(t).map((c) => [t, c] as const))
			].filter(([, c]) => c.type === NOTE_ON && c.channel === 1)
			// Each note reaches the outputs on a tick no later than the moment it should sound.
			for (const [tick, c] of sent) {
				expect(tick).toBeLessThanOrEqual(c.audioTime! + 1e-9)
			}
			return sent.map(([, c]) => Math.round(c.audioTime! * 1000) / 1000)
		}
		const steady = Array.from({ length: 75 }, (_, i) => (i + 1) * 0.02)
		const uneven = [0.13, 0.2, 0.33, 0.45, 0.58, 0.61, 0.74, 0.88, 1, 1.12, 1.25, 1.39, 1.5]
		expect(onsets(uneven)).toEqual([0, 0.5, 1, 1.5])
		expect(onsets(steady)).toEqual([0, 0.5, 1, 1.5])
	})
	it("never releases a note sent ahead before it starts", () => {
		const performance = session({ lookahead: 0.15 })
		performance.press(0, 0)
		const ahead = advance(performance, 0, 0.4).find(
			(c) => c.type === NOTE_ON && c.channel === 1 && c.audioTime === 0.5
		)
		expect(ahead?.startAt).toBeLessThanOrEqual(0.4)
		performance.reset()
		const release = performance
			.advance(0.41)
			.find((c) => c.type === NOTE_OFF && c.channel === 1)
		expect(release?.audioTime).toBe(0.5)
	})
	it("plays a joining part's notes that were skipped ahead at their own time", () => {
		const performance = session({ assist: false, lookahead: 0.15 })
		performance.press(0, 0)
		expect(
			advance(performance, 0, 0.4).filter((c) => c.type === NOTE_ON && c.channel === 2)
		).toEqual([])
		const joined = performance.press(1, 0.42).filter((c) => c.type === NOTE_ON)
		expect(joined.map((c) => [c.channel, Math.round(c.audioTime! * 1000) / 1000])).toEqual([
			[2, 0.5]
		])
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
		const output = [...performance.press(0, 0), ...advance(performance, 0, 4.2)]
		// Unchanged programs are not resent on each loop, where they could reset a voice.
		expect(output.filter((c) => c.type === PROGRAM_CHANGE)).toHaveLength(3)
		// The 3.75s score wraps straight back to its first beat.
		expect(output.filter((c) => c.type === NOTE_ON && c.startAt >= 3.7)).toHaveLength(3)
		expect(performance.state.running).toBe(true)
		const finite = session()
		finite.press(0, 0)
		advance(finite, 0, 4)
		expect(finite.state.ended).toBe(true)
		expect(finite.press(1, 4.1)).toEqual([])
	})
	it("resumes after host suspension where it was, without a burst of missed notes", () => {
		const performance = session()
		performance.press(0, 0)
		const output = performance.advance(3.1)
		expect(output.filter((c) => c.type === NOTE_ON)).toHaveLength(0)
		expect(performance.state.position).toBe(0)
		expect(performance.advance(3.2).filter((c) => c.type === NOTE_ON)).toEqual([])
		expect(performance.state.position).toBeCloseTo(0.1)
	})
	it("skips stale attacks after a short stall but keeps the song position", () => {
		const performance = session()
		performance.press(0, 0)
		const output = performance.advance(0.9)
		// Notes at 0.5 are 0.4s late and skipped; nothing is left hanging without a release.
		expect(output.filter((c) => c.type === NOTE_ON)).toEqual([])
		expect(output.filter((c) => c.type === NOTE_OFF)).toHaveLength(3)
		expect(performance.state.position).toBeCloseTo(0.9)
		expect(performance.advance(1).filter((c) => c.type === NOTE_ON)).toHaveLength(3)
	})
	it("carries a player's activity window over the song loop", () => {
		const performance = session({
			loop: true,
			assist: false,
			activityBeats: 4
		})
		performance.press(0, 0)
		advance(performance, 0, 3.5)
		performance.press(0, 3.5)
		const output = advance(performance, 3.5, 4.1)
		expect(
			output.filter((c) => c.type === NOTE_ON && c.startAt >= 3.75).map((c) => c.channel)
		).toEqual([1])
	})
	it("starts on the bar of the first note rather than playing leading silence", () => {
		const song = score()
		for (const track of song.midi.tracks) {
			for (const note of track.notes) {
				note.time += 5
			}
		}
		const performance = new EnsembleSession(settings({ assist: false }))
		performance.setSong(midiSong(song.midi))
		performance.press(0, 0)
		// Bars last two seconds at 120 BPM, so the first note at 5s sits in the bar from 4s.
		expect(performance.state.position).toBe(4)
		const notes = advance(performance, 0, 1.05).filter((c) => c.type === NOTE_ON)
		expect(notes).toHaveLength(1)
		expect(notes[0].startAt).toBeCloseTo(1)
	})
	it("keeps a held part playing and lets a released part run out after its activity window", () => {
		const performance = session({ assist: false, activityBeats: 1 })
		performance.press(0, 0)
		const held = advance(performance, 0, 2)
		expect(held.filter((c) => c.type === NOTE_ON && c.channel === 1)).toHaveLength(4)
		performance.releasePress(0, 2)
		const released = advance(performance, 2, 3.5)
		// One beat (0.5s) after letting go the part falls silent; sounding notes still finish.
		expect(
			released.filter((c) => c.type === NOTE_ON && c.channel === 1).map((c) => c.startAt)
		).toEqual([2.5])
		expect(released.filter((c) => c.type === NOTE_OFF && c.channel === 1)).toHaveLength(2)
	})
	it("sounds a part's note already under way when its player joins", () => {
		const song = score()
		song.midi.tracks[1].addNote({
			midi: 40,
			time: 0.6,
			duration: 2,
			velocity: 0.8
		})
		const performance = new EnsembleSession(settings({ assist: false }))
		performance.setSong(midiSong(song.midi))
		performance.press(0, 0)
		advance(performance, 0, 1.1)
		const joined = performance.press(1, 1.1).filter((c) => c.type === NOTE_ON)
		// The long note is joined mid-way; the short one began within the catch window.
		expect(joined.map((c) => [c.channel, c.number, c.startAt])).toEqual([
			[2, 61, 1.1],
			[2, 40, 1.1]
		])
	})
	it("pauses when everybody stops and carries on from the bar where the music stopped", () => {
		const performance = session({
			assist: false,
			activityBeats: 1,
			pauseBeats: 2
		})
		performance.press(0, 0)
		performance.releasePress(0, 0)
		advance(performance, 0, 2)
		expect(performance.state).toMatchObject({
			running: false,
			paused: true,
			position: 0
		})
		expect(performance.advance(3)).toEqual([])
		const resumed = performance.press(0, 3).filter((c) => c.type === NOTE_ON)
		expect(resumed.map((c) => c.channel)).toEqual([1])
		expect(performance.state.running).toBe(true)
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
	it("upgrades saved phrase-gated setups and persists part behaviour overrides", async () => {
		const t = await transformer({ mode: "assisted" })
		expect(t.options.mode).toBe("perform")
		t.setConfig("partRoles", { 1: "groove", 2: "notes", 99: "groove", 3: "invalid" })
		expect(t.options.partRoles).toEqual({ 1: "groove", 2: "notes" })
		const restored = new TransformerEnsemble({
			...JSON.parse(t.exportConfig()),
			midiFileUrl: ""
		})
		transformers.push(restored)
		expect(restored.options.partRoles).toEqual(t.options.partRoles)
		expect(restored.options.mode).toBe("perform")
	})
	it("offers part roles, live note feedback, and a working explicit groove stop", async () => {
		const t = await transformer({
			autoInputs: "keyboard",
			players: [{ source: "a", channels: [1] }]
		})
		const gui = await t.createGui()
		const role = gui.querySelector<HTMLSelectElement>('[aria-label="Channel 1 behaviour"]')!
		expect(gui.querySelector(".ensemble-part-status")!.textContent).toContain("Next: C4")
		role.value = "groove"
		role.dispatchEvent(new Event("change"))
		expect(t.options.partRoles[1]).toBe("groove")
		expect(
			gui.querySelector<HTMLButtonElement>(
				'[aria-label="Stop channel 1 groove at next bar"]'
			)!.hidden
		).toBe(false)
		t.transform([press("a")], { now: 0 } as any)
		expect(gui.querySelector(".ensemble-part-status")!.textContent).toContain("Looping")
		gui.querySelector<HTMLButtonElement>(
			'[aria-label="Stop channel 1 groove at next bar"]'
		)!.click()
		expect(gui.querySelector(".ensemble-part-status")!.textContent).toContain("Stopping")
		t.tick(1, {} as any)
		t.tick(2, {} as any)
		expect(gui.querySelector(".ensemble-part-status")!.textContent).toBe("Tap to loop")
	})
	it("registers in the transformer factory and picker", () => {
		const t = tranformerFactory(ID_ENSEMBLE) as TransformerEnsemble
		transformers.push(t)
		expect(t).toBeInstanceOf(TransformerEnsemble)
		expect(getTransformerDefinition(ID_ENSEMBLE)?.name).toBe("Ensemble")
	})
	it("accepts more than six players, keeps identity across joins, and persists assignments", async () => {
		const t = await transformer()
		for (let n = 0; n < 20; n++) {
			t.transform([press(`controller-${n}`, n * 0.01)], {
				now: n * 0.01
			} as any)
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
	it("keeps the playhead and surviving note cursors when membership is edited", async () => {
		const t = await transformer({ assist: false })
		t.transform([press("a"), press("b")], { now: 0 } as any)
		t.tick(0.25, {} as any)
		t.addPlayer()
		t.removePlayer(0)
		expect(t.performanceState.position).toBe(0.25)
		t.transform([Object.assign(press("b", 0.25), { type: NOTE_OFF })], { now: 0.25 } as any)
		t.transform([press("b", 0.3)], { now: 0.3 } as any)
		expect(
			t
				.tick(0.5, {} as any)
				.filter((c) => c.type === NOTE_ON)
				.map((c) => [c.channel, c.number])
		).toEqual([[2, 61]])
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
	it("advances unassigned backing through the clock pipeline without autoplaying assigned notes", async () => {
		const t = await transformer()
		t.transform([press("a")], { now: 0 } as any)
		advanceTransformers([t], 0.25, {} as any)
		expect(
			advanceTransformers([t], 0.5, {} as any).filter((c) => c.type === NOTE_ON)
		).toHaveLength(2)
		t.setConfig("enabled", false)
		expect(
			advanceTransformers([t], 0.6, {} as any).filter((c) => c.type === NOTE_OFF)
		).toHaveLength(2)
		expect(advanceTransformers([t], 0.75, {} as any)).toEqual([])
	})
	it("renders dynamic player controls and learns an input without hand-entered IDs", async () => {
		const t = await transformer({ autoJoin: false })
		const gui = await t.createGui()
		for (let n = 0; n < 8; n++) {
			t.addPlayer()
		}
		expect(gui.querySelectorAll(".ensemble-player")).toHaveLength(8)
		;(gui.querySelector(".ensemble-player button") as HTMLButtonElement).click()
		t.transform([press("learned-pad")], { now: 0 } as any)
		expect(t.options.players[0].source).toBe("learned-pad")
		expect(gui.querySelector(".ensemble-player-source")!.textContent).toBe("learned-pad")
		t.removePlayer(7)
		expect(gui.querySelectorAll(".ensemble-player")).toHaveLength(7)
	})
	it("assigns song parts to a player with checkboxes instead of typed channel numbers", async () => {
		const t = await transformer({ autoJoin: false })
		const gui = await t.createGui()
		t.addPlayer()
		const boxes = [...gui.querySelectorAll<HTMLInputElement>(".ensemble-player-parts input")]
		expect(boxes.map((box) => box.parentElement!.textContent)).toEqual([
			"1 · Part 1",
			"2 · Part 2",
			"3 · Part 3"
		])
		expect(boxes.map((box) => box.checked)).toEqual([true, false, false])
		boxes[2].checked = true
		boxes[2].dispatchEvent(new Event("change"))
		expect(t.options.players[0].channels).toEqual([1, 3])
	})
	it("lists generated part controls read-only and shows only the current mode's timing", async () => {
		const t = await transformer({ autoInputs: "keyboard" })
		const gui = await t.createGui()
		expect(gui.querySelector(".ensemble-add-player")!.hasAttribute("hidden")).toBe(true)
		expect(
			[...gui.querySelectorAll(".ensemble-part kbd")].map((key) => key.textContent)
		).toEqual(["A", "S", "D"])
		const visible = () =>
			[...gui.querySelectorAll<HTMLElement>(".ensemble-timing .component-control")]
				.filter((control) => !control.hidden)
				.map((control) => control.firstElementChild!.firstChild!.textContent)
		expect(visible()).toEqual(["Rejoin when behind (bars)", "Pause after silence (beats)"])
		t.setControlValue("mode", "together")
		expect(visible()).toEqual([
			"Step length (beats)",
			"Players per step",
			"Assist a step after (seconds)"
		])
		expect(gui.querySelector(".ensemble-timing output")!.textContent).toBe("2")
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
			// Before the score's releases enter the lookahead window, so notes are still held.
			timer.now = 0.05
			await chain.triggerAudioCommandsOnDevice(chain.updateTimeForCommandQueue(0.05, 1, {}))
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
		expect(commands.at(-1)).toMatchObject({
			type: NOTE_OFF,
			from: commands[1].from
		})
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
		window.dispatchEvent(
			Object.assign(new Event("gamepaddisconnected"), {
				gamepad: device
			})
		)
		expect(pad.id).toBe("same model")
		expect(manager.isHeld("a", 0)).toBe(false)
		expect(manager.isHeld("a", 1)).toBe(true)
		manager.destroy()
	})
})