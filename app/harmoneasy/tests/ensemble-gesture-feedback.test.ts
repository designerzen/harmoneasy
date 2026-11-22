// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { readFileSync } from "node:fs"
import { EnsembleSession, type EnsembleSettings } from "audiobus/io/ensemble-session"
import { midiSong } from "audiobus/io/midi-song"
import { TransformerEnsemble } from "audiobus/io/transformers/transformer-ensemble"
import { NOTE_ON, NOTE_OFF } from "audiobus/commands/commands"
import type { IAudioCommand } from "audiobus/commands/audio-command-interface"
import { setControlRenderer } from "audiobus/io/component-ui"
import { createDomGui } from "control-surface/dom"

const { Midi } = createRequire(resolve("../../packages/audiobus/package.json"))("@tonejs/midi")
const transformers: TransformerEnsemble[] = []
afterEach(() => {
	transformers.splice(0).forEach((t) => t.destroy())
	vi.unstubAllGlobals()
})
function score() {
	const midi = new Midi()
	midi.header.setTempo(120)
	for (const channel of [0, 1, 9]) {
		const track = midi.addTrack()
		track.channel = channel
		for (let time = 0; time < 16; time += 0.5) {
			track.addNote({
				midi: channel === 9 ? 36 : 60 + channel + time * 2,
				time,
				duration: 0.25,
				velocity: 0.8
			})
		}
	}
	return midi
}
function fixture(changes: Partial<EnsembleSettings> = {}, edit?: (midi: any) => void) {
	const midi = score()
	edit?.(midi)
	const settings: EnsembleSettings = {
		mode: "perform",
		players: [
			{ source: "a", channels: [1] },
			{ source: "b", channels: [2] },
			{ source: "drums", channels: [10] }
		],
		assist: false,
		loop: false,
		activityBeats: 1,
		pauseBeats: 0,
		stepBeats: 1,
		quorum: 1,
		waitSeconds: 1,
		recoveryBars: 2,
		...changes
	}
	const performance = new EnsembleSession(settings)
	performance.setSong(midiSong(midi))
	return { performance, midi, settings }
}
function tick(performance: EnsembleSession, from: number, to: number) {
	const output: IAudioCommand[] = []
	for (let now = from; now < to - 1e-7; ) {
		now = Math.min(to, Math.round((now + 0.05) * 1000) / 1000)
		output.push(...performance.advance(now))
	}
	return output
}
const attacks = (commands: IAudioCommand[], channel = 1) =>
	commands.filter((c) => c.type === NOTE_ON && c.channel === channel)
function tap(performance: EnsembleSession, player: number, now: number) {
	return [...performance.press(player, now), ...performance.releasePress(player, now)]
}
function chordScore(midi: any) {
	midi.tracks[0].notes = []
	for (const [midiNote, time] of [
		[60, 0],
		[64, 0.008],
		[67, 0.02],
		[72, 0.028]
	]) {
		midi.tracks[0].addNote({ midi: midiNote, time, duration: 0.5, velocity: 0.8 })
	}
}

describe("research-guided ensemble performance", () => {
	it("groups humanized chord tones from a fixed origin and preserves their offsets and lengths", () => {
		const { performance, midi } = fixture({}, chordScore)
		const output = tap(performance, 0, 0)
		expect(attacks(output).map((c) => c.number)).toEqual([60, 64])
		expect(attacks(output)[1].audioTime).toBeCloseTo(0.008)
		const off = tick(performance, 0, 0.6).filter((c) => c.type === NOTE_OFF && c.channel === 1)
		expect(off).toHaveLength(2)
		off.forEach((c, index) =>
			expect(c.audioTime).toBeCloseTo(
				midi.tracks[0].notes[index].time + midi.tracks[0].notes[index].duration
			)
		)
		expect(attacks(tap(performance, 0, 0.6)).map((c) => c.number)).toEqual([67, 72])
	})
	it("allows exact-onset grouping to be selected without resetting the song", () => {
		const { performance, settings } = fixture({ chordWindowMs: 0 }, chordScore)
		expect(attacks(tap(performance, 0, 0)).map((c) => c.number)).toEqual([60])
		tick(performance, 0, 0.1)
		performance.configure({ ...settings, chordWindowMs: 20 })
		expect(performance.state.position).toBeCloseTo(0.1)
		expect(attacks(tap(performance, 0, 0.1)).map((c) => c.number)).toEqual([64])
	})
	it("keeps repeated pitches and short grace notes as separate gestures", () => {
		const { performance } = fixture({}, (midi) => {
			midi.tracks[0].notes = []
			for (const [pitch, time, duration] of [
				[60, 0, 0.5],
				[60, 0.008, 0.5],
				[64, 0.016, 0.005]
			]) {
				midi.tracks[0].addNote({ midi: pitch, time, duration, velocity: 0.8 })
			}
		})
		expect(attacks(tap(performance, 0, 0))).toHaveLength(1)
		tick(performance, 0, 0.1)
		expect(attacks(tap(performance, 0, 0.1))).toHaveLength(1)
		tick(performance, 0.1, 0.2)
		expect(attacks(tap(performance, 0, 0.2)).map((c) => c.number)).toEqual([64])
	})
	it("never automatically plays the rest of a melodic phrase while held or assisted", () => {
		const { performance } = fixture({ assist: true })
		expect(attacks(performance.press(0, 0))).toHaveLength(1)
		expect(attacks(tick(performance, 0, 3))).toEqual([])
		expect(attacks(performance.press(0, 3))).toEqual([])
		performance.releasePress(0, 3)
		expect(attacks(tap(performance, 0, 3)).map((c) => c.number)).toEqual([61])
	})
	it("confirms an early gesture immediately while distinguishing queued from sounding", () => {
		const { performance } = fixture({ lookahead: 0.15 })
		tap(performance, 0, 0)
		tick(performance, 0, 0.3)
		const previous = performance.partFeedback(1).accepted
		expect(attacks(tap(performance, 0, 0.3))).toEqual([])
		expect(performance.partFeedback(1)).toMatchObject({
			phase: "queued",
			message: expect.stringContaining("Accepted")
		})
		expect(performance.partFeedback(1).accepted).toBeGreaterThan(previous)
		const scheduled = attacks(performance.advance(0.4))
		expect(scheduled[0].audioTime).toBeCloseTo(0.5)
		expect(performance.partFeedback(1).phase).toBe("queued")
		expect(performance.parts().live).not.toContain(1)
		performance.advance(0.5)
		expect(performance.partFeedback(1).phase).toBe("sounding")
	})
	it("shows a countdown for written rests, without requiring repeated taps", () => {
		const { performance } = fixture({}, (midi) => {
			midi.tracks[0].notes = midi.tracks[0].notes.filter((n: any) => n.time >= 4)
		})
		tap(performance, 1, 0)
		expect(performance.partFeedback(1)).toMatchObject({ phase: "rest", beatsUntil: 8 })
		tap(performance, 0, 0)
		tick(performance, 0, 2)
		expect(performance.partFeedback(1)).toMatchObject({ phase: "queued", beatsUntil: 4 })
		expect(attacks(tick(performance, 2, 4))).toHaveLength(1)
	})
	it("preserves nearby missed notes, but rejoins a recent section marker after a large gap", () => {
		const { performance } = fixture({}, (midi) =>
			midi.header.meta.push({ type: "marker", text: "Chorus", ticks: midi.header.ppq * 10 })
		)
		tap(performance, 0, 0)
		tick(performance, 0, 3)
		expect(attacks(tap(performance, 0, 3)).map((c) => c.number)).toEqual([61])
		tick(performance, 3, 6.2)
		expect(attacks(tap(performance, 0, 6.2)).map((c) => c.number)).toEqual([70])
		expect(attacks(tick(performance, 6.2, 7))).toEqual([])
	})
	it("allows an explicit rejoin without sounding a skipped phrase or rewinding others", () => {
		const { performance } = fixture({ recoveryBars: 8 })
		tap(performance, 0, 0)
		tap(performance, 1, 0)
		tick(performance, 0, 2.3)
		performance.rejoinPart(1)
		expect(attacks(performance.advance(2.3))).toEqual([])
		expect(attacks(tap(performance, 0, 2.3)).map((c) => c.number)).toEqual([64])
		expect(attacks(tap(performance, 1, 2.3), 2).map((c) => c.number)).toEqual([62])
		expect(performance.state.position).toBeCloseTo(2.3)
	})
	it("does not reuse a distant section marker after its recovery window", () => {
		const { performance } = fixture({}, (midi) =>
			midi.header.meta.push({ type: "marker", text: "Verse", ticks: 0 })
		)
		tap(performance, 0, 0)
		tick(performance, 0, 6.2)
		expect(attacks(tap(performance, 0, 6.2)).map((c) => c.number)).toEqual([72])
	})
	it("repeats a stable groove through a gap instead of latching a one-off fill", () => {
		const { performance } = fixture({}, (midi) => {
			midi.tracks[2].notes = []
			for (const [time, pitch] of [
				[0, 36],
				[2, 36],
				[4, 46]
			]) {
				midi.tracks[2].addNote({ midi: pitch, time, duration: 0.1, velocity: 0.8 })
			}
		})
		tap(performance, 2, 0)
		const notes = attacks(tick(performance, 0, 6.2), 10)
		expect(notes.filter((c) => c.audioTime! >= 4).map((c) => c.number)).toEqual([46, 36])
	})
	it("retains alternating two-bar groove phase through empty bars", () => {
		const { performance } = fixture({}, (midi) => {
			midi.tracks[2].notes = []
			for (const [time, pitch] of [
				[0, 36],
				[2, 38],
				[4, 36],
				[6, 38]
			]) {
				midi.tracks[2].addNote({ midi: pitch, time, duration: 0.1, velocity: 0.8 })
			}
		})
		tap(performance, 2, 0)
		const notes = attacks(tick(performance, 0, 10.2), 10).filter((c) => c.audioTime! >= 8)
		expect(notes.map((c) => c.number)).toEqual([36, 38])
	})
	it("respects section boundaries when selecting percussion fallback", () => {
		const { performance } = fixture({}, (midi) => {
			midi.tracks[2].notes = midi.tracks[2].notes.filter((n: any) => n.time < 4)
			midi.header.meta.push({ type: "marker", text: "Break", ticks: midi.header.ppq * 8 })
		})
		tap(performance, 2, 0)
		expect(attacks(tick(performance, 0, 6), 10).filter((c) => c.audioTime! >= 4)).toEqual([])
	})
	it("reports a groove as queued until the actual bar-aligned launch", () => {
		const { performance } = fixture()
		tap(performance, 0, 0)
		tick(performance, 0, 0.7)
		tap(performance, 2, 0.7)
		expect(performance.partFeedback(10).phase).toBe("queued")
		expect(performance.parts().live).not.toContain(10)
		tick(performance, 0.7, 2)
		expect(performance.partFeedback(10).phase).toBe("looping")
		performance.stopGroove(10)
		expect(performance.partFeedback(10).phase).toBe("stopping")
	})
	it("keeps scheduled groove attacks steady through uneven clock callbacks", () => {
		const { performance } = fixture({ lookahead: 0.15 })
		const output = tap(performance, 2, 10)
		const intervals = [0.06, 0.14, 0.08, 0.12]
		for (let now = 10, index = 0; now < 14; ) {
			now += intervals[index++ % intervals.length]
			output.push(...performance.advance(now))
		}
		expect(
			attacks(output, 10)
				.map((c) => Math.round(c.audioTime! * 1000))
				.filter((time) => time < 14000)
		).toEqual(Array.from({ length: 8 }, (_, i) => 10000 + i * 500))
	})
	it("keeps the actual Never Gonna parts gesture-controlled while drums continue", () => {
		const { performance } = fixture({ lookahead: 0.15 })
		const midi = new Midi(readFileSync("public/midi/never-gonna-give-you-up.mid"))
		performance.setSong(midiSong(midi))
		tap(performance, 0, 0)
		tap(performance, 2, 0)
		const output = tick(performance, 0, 20)
		const piano = attacks(output)
		expect(piano.length).toBeGreaterThan(0)
		expect(piano.every((c) => c.audioTime! - piano[0].audioTime! < 0.025)).toBe(true)
		expect(attacks(output, 10).length).toBeGreaterThan(20)
		const rejoined = [...tap(performance, 0, 20), ...tick(performance, 20, 21)]
		expect(attacks(rejoined).length).toBeGreaterThan(0)
	})
	it("can carry the complete Never Gonna arrangement with independent taps and a latched groove", () => {
		const { performance } = fixture({ lookahead: 0.15 })
		const song = midiSong(new Midi(readFileSync("public/midi/never-gonna-give-you-up.mid")))
		performance.setSong(song)
		const first = song.events.find((e) => e.command.type === NOTE_ON)!.at
		const output = tap(performance, 2, 0)
		const finish = Math.ceil(song.duration - first) + 4
		for (let step = 1; step <= finish * 20; step++) {
			const now = step / 20
			output.push(...performance.advance(now))
			if (step % 10 === 0 && performance.state.running) {
				output.push(...tap(performance, 0, now))
			}
			if (step % 15 === 0 && performance.state.running) {
				output.push(...tap(performance, 1, now))
			}
		}
		expect(performance.state.ended).toBe(true)
		expect(attacks(output).length).toBeGreaterThan(100)
		expect(attacks(output, 2).length).toBeGreaterThan(100)
		expect(attacks(output, 10).length).toBeGreaterThan(1000)
		expect(output.every((c) => Number.isFinite(c.audioTime))).toBe(true)
	})
	it("renders immediate acceptance and persists chord grouping controls", async () => {
		setControlRenderer(createDomGui)
		const midi = score()
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async (url) =>
					new Response(String(url).endsWith("index.json") ? "[]" : midi.toArray())
			)
		)
		const t = new TransformerEnsemble({
			autoInputs: "keyboard",
			assist: false,
			players: [{ source: "a", channels: [1] }]
		})
		transformers.push(t)
		await t.loadMIDIFile("song.mid")
		const gui = await t.createGui()
		const command = (type: string, now: number) =>
			({
				type,
				velocity: type === NOTE_ON ? 100 : 0,
				from: "a",
				channel: 1,
				number: 60,
				startAt: now
			}) as IAudioCommand
		t.transform([command(NOTE_ON, 0), command(NOTE_OFF, 0)], { now: 0 } as any)
		t.tick(0.3, {} as any)
		t.transform([command(NOTE_ON, 0.3)], { now: 0.3 } as any)
		const cue = gui.querySelector<HTMLElement>('[aria-label="Channel 1 playing guide"]')!
		expect(cue.dataset.phase).toBe("queued")
		expect(cue.textContent).toContain("Accepted")
		t.setConfig("chordWindowMs", 0)
		expect(JSON.parse(t.exportConfig()).chordWindowMs).toBe(0)
		expect(
			gui.querySelector('[aria-label="Rejoin channel 1 at the current section"]')
		).not.toBeNull()
		// Key badge in the GUI is directly playable via pointer/keyboard and updates the header beat meter.
		const keyTile = gui.querySelector<HTMLElement>(".ensemble-part kbd")!
		expect(keyTile.getAttribute("role")).toBe("button")
		keyTile.dispatchEvent(new Event("pointerup"))
		keyTile.dispatchEvent(new Event("pointerdown"))
		const fromTile = attacks(t.tick(0.6, {} as any))
		expect(fromTile.length).toBeGreaterThan(0)
		const meter = gui.querySelector<HTMLElement>(".ensemble-meter")!
		expect(meter.dataset.running).toBe("true")
	})
	it("supports full 0-50ms chord windows and rejects legato melodic steps that do not co-sustain", () => {
		const { performance } = fixture({ chordWindowMs: 35 }, (midi) => {
			midi.tracks[0].notes = []
			// First group: 32ms rolled chord where both tones co-sustain for 0.5s.
			midi.tracks[0].addNote({ midi: 60, time: 0, duration: 0.5, velocity: 0.8 })
			midi.tracks[0].addNote({ midi: 64, time: 0.032, duration: 0.5, velocity: 0.8 })
			// Second group: fast legato step where first note ends right as second starts.
			midi.tracks[0].addNote({ midi: 67, time: 0.5, duration: 0.025, velocity: 0.8 })
			midi.tracks[0].addNote({ midi: 69, time: 0.52, duration: 0.5, velocity: 0.8 })
		})
		expect(attacks(tap(performance, 0, 0)).map((c) => c.number)).toEqual([60, 64])
		expect(attacks(tap(performance, 0, 0.6)).map((c) => c.number)).toEqual([67])
		expect(attacks(tap(performance, 0, 0.7)).map((c) => c.number)).toEqual([69])
	})
	it("recovers at a phrase entry after a multi-beat rest when no MIDI marker is present", () => {
		const { performance } = fixture({}, (midi) => {
			// Create a 1-bar rest on channel 1 from 2.5s to 5.5s, with a phrase pickup at 5.5s (beat 11).
			midi.tracks[0].notes = midi.tracks[0].notes.filter(
				(n: any) => n.time <= 2 || n.time >= 5.5
			)
		})
		tap(performance, 0, 0)
		tick(performance, 0, 6.2)
		// At 6.2s (bar 4), the pickup at 5.5s (bar 3, after >4 beats rest) is within recoveryBars (2).
		expect(attacks(tap(performance, 0, 6.2)).map((c) => c.number)).toEqual([71])
	})
	it("respects authored groove loop, fill, and break regions and never captures empty bars in cycles", () => {
		const { performance } = fixture(
			{
				grooveRegions: [
					{ fromBar: 1, toBar: 1, kind: "loop" },
					{ fromBar: 2, toBar: 2, kind: "fill" },
					{ fromBar: 4, toBar: 4, kind: "break" }
				]
			},
			(midi) => {
				midi.tracks[2].notes = []
				midi.tracks[2].addNote({ midi: 36, time: 0, duration: 0.1, velocity: 0.8 })
				midi.tracks[2].addNote({ midi: 49, time: 2, duration: 0.1, velocity: 0.8 })
			}
		)
		const notes = attacks([...tap(performance, 2, 0), ...tick(performance, 0, 8)], 10)
		// Bar 1 plays 36, Bar 2 plays fill 49, Bar 3 repeats loop 36 (not fill 49), Bar 4 is silent break.
		expect(notes.map((c) => [Math.round(c.audioTime!), c.number])).toEqual([
			[0, 36],
			[2, 49],
			[4, 36]
		])
	})
	it("adapts group tempo gently from score-relative intervals across different note densities", () => {
		const { performance } = fixture({ tempoAdaptation: 0.4 }, (midi) => {
			midi.tracks[1].notes = []
			for (let time = 0; time < 16; time += 1) {
				midi.tracks[1].addNote({ midi: 48, time, duration: 0.5, velocity: 0.8 })
			}
		})
		tap(performance, 0, 0)
		tap(performance, 1, 0)
		// Player 0 has 0.5s score intervals; Player 1 has 1.0s score intervals.
		// Both perform 20% slower than score tempo (0.6s and 1.2s wall intervals).
		for (let step = 1; step <= 6; step++) {
			const wall = step * 0.6
			tick(performance, (step - 1) * 0.6, wall)
			tap(performance, 0, wall)
			if (step % 2 === 0) {
				tap(performance, 1, wall)
			}
		}
		expect(performance.state.speed).toBeLessThan(0.97)
		expect(performance.state.speed).toBeGreaterThan(0.85)
	})
	it("supports expressive velocity, optional hold articulation, and assistance disclosure with idle pause", async () => {
		const { performance } = fixture({
			assist: true,
			pauseBeats: 2,
			holdArticulation: true,
			velocityInfluence: 1,
			players: [{ source: "a", channels: [1] }]
		})
		const loud = attacks(performance.press(0, 0, 120))[0].velocity
		// Channel 2 is unassigned and assisted; it is disclosed in parts().assisted and does not block pauseBeats.
		expect(performance.parts().assisted).toContain(2)
		const releaseOut = [
			...performance.releasePress(0, 0.05),
			...tick(performance, 0.05, 0.3)
		].filter((c) => c.type === NOTE_OFF && c.channel === 1)
		expect(loud).toBe(120)
		expect(releaseOut[0].audioTime).toBeLessThanOrEqual(0.25)
		const soft = attacks(performance.press(0, 0.5, 40))[0].velocity
		performance.releasePress(0, 0.55)
		expect(soft).toBe(40)
		tick(performance, 0.55, 2)
		expect(performance.state.paused).toBe(true)
		expect(performance.telemetry()).toMatchObject({
			acceptedPresses: 2,
			playedOnsets: 2,
			immediateLate: 2
		})
	})
	it("enters grooves immediately in phase when legato launch is enabled and converges sustained one-bar lag", () => {
		const { performance } = fixture({ legatoGroove: true, recoveryBars: 2 })
		tap(performance, 0, 0)
		tick(performance, 0, 0.7)
		// Joining groove at 0.7s (beat 1.4) immediately voices a percussion hit and plays remaining beats of bar 1 (1.0s, 1.5s).
		const initialGroove = attacks(tap(performance, 2, 0.7), 10)
		expect(initialGroove.length).toBeGreaterThan(0)
		expect(performance.partFeedback(10).phase).toBe("looping")
		const bar1Remaining = attacks(tick(performance, 0.7, 2), 10)
		expect(bar1Remaining.map((c) => c.audioTime)).toEqual([1, 1.5, 2])
		// Player 0 is now at t=2.0s (beat 4, bar 2), while cursor is at note 1 (0.5s, beat 1).
		// First tap at 2.5s plays note 1 (61); second tap at 3.0s at song tempo (non-shrinking 1-bar lag) converges to current beat (66 at 3.0s).
		tick(performance, 2, 2.5)
		expect(attacks(tap(performance, 0, 2.5)).map((c) => c.number)).toEqual([61])
		tick(performance, 2.5, 3)
		expect(attacks(tap(performance, 0, 3)).map((c) => c.number)).toEqual([66])
	})
	it("voices in-harmony comping notes during long multi-bar rests and after part completion without losing the real entrance", () => {
		const { performance } = fixture({}, (midi) => {
			// Channel 1 rests until 4.0s (beat 8, bar 3) and ends after that single note.
			midi.tracks[0].notes = midi.tracks[0].notes.filter((n: any) => n.time === 4)
		})
		tap(performance, 1, 0)
		// First tap on channel 1 queues the entrance at 4.0s (8 beats away).
		expect(attacks(tap(performance, 0, 0))).toEqual([])
		expect(performance.partFeedback(1).phase).toBe("queued")
		// Subsequent taps during the long rest voice immediate in-harmony comping notes while keeping the 4.0s entrance queued.
		tick(performance, 0, 0.5)
		const comp = attacks(tap(performance, 0, 0.5))
		expect(comp).toHaveLength(1)
		expect(performance.partFeedback(1)).toMatchObject({
			phase: "sounding",
			message: expect.stringContaining("Comping")
		})
		// The real score entrance at 4.0s (pitch 68) still fires on time.
		const realEntrance = attacks(tick(performance, 0.5, 4.1))
		expect(realEntrance.map((c) => c.number)).toEqual([68])
		// After the part completes, further taps continue to voice comping notes instead of going dead.
		tick(performance, 4.1, 5)
		expect(performance.partFeedback(1).phase).toBe("complete")
		const postComplete = attacks(tap(performance, 0, 5))
		expect(postComplete).toHaveLength(1)
		expect(performance.partFeedback(1).message).toContain("Comping")
	})
	it("immediately comps without locking a distant future trigger when tapped outside the anticipation window", () => {
		const { performance } = fixture({ anticipationBeats: 2 }, (midi) => {
			// Channel 1 enters at 4.0s (beat 8, 8 beats ahead > anticipationBeats=2).
			midi.tracks[0].notes = midi.tracks[0].notes.filter((n: any) => n.time === 4)
		})
		tap(performance, 1, 0)
		// First tap at t=0 is 8 beats early (> 2), so it voices an immediate comp note without locking a request for t=4.0s.
		const immediate = attacks(tap(performance, 0, 0))
		expect(immediate).toHaveLength(1)
		expect(performance.partFeedback(1).message).toContain("Comping")
		// Because no distant trigger was locked, advancing to 4.1s without another tap does not auto-fire the 4.0s note.
		expect(attacks(tick(performance, 0, 3.2))).toEqual([])
		// Tapping at 3.3s (beat 6.6, within 1.4 beats <= anticipationBeats=2 of beat 8) queues the real entrance at 4.0s.
		expect(attacks(tap(performance, 0, 3.3))).toEqual([])
		expect(performance.partFeedback(1).phase).toBe("queued")
		expect(performance.partFeedback(1).approach).toBeGreaterThan(0.6)
		expect(attacks(tick(performance, 3.3, 4.1)).map((c) => c.number)).toEqual([68])
	})
	it("pairs unison/octave companion parts and lets a human seamlessly take over an assisted keyboard part", () => {
		const { performance } = fixture(
			{
				assist: true,
				pairCompanionParts: true,
				players: [
					{ source: "a", channels: [1] },
					{ source: "b", channels: [2] }
				]
			},
			(midi) => {
				// Add channel 3 as an octave-doubled companion to channel 1.
				const companion = midi.addTrack()
				companion.channel = 2
				for (let time = 0; time < 16; time += 0.5) {
					companion.addNote({
						midi: 72 + time * 2,
						time,
						duration: 0.25,
						velocity: 0.7
					})
				}
			}
		)
		expect(performance.companionChannels(1)).toContain(3)
		// Tapping player 0 (channel 1) pairs octave companion channel 3, while unclaimed channel 2 receives quiet assist backing.
		const firstTap = tap(performance, 0, 0)
		expect(attacks(firstTap, 1).map((c) => c.number)).toEqual([60])
		expect(attacks(firstTap, 3).map((c) => c.number)).toEqual([72])
		expect(performance.parts().assisted).toContain(2)
		// Advance to 2.0s while channel 2 is assisted, then player 1 takes over channel 2 right at the current beat (2.0s -> pitch 65).
		tick(performance, 0, 2)
		const takeover = attacks(tap(performance, 1, 2), 2)
		expect(takeover.map((c) => c.number)).toEqual([65])
	})
})