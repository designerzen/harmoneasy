// @vitest-environment happy-dom
import { describe, expect, it } from "vitest"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { readFileSync } from "node:fs"
import { EnsembleSession, type EnsembleSettings } from "audiobus/io/ensemble-session"
import { midiSong } from "audiobus/io/midi-song"
import { NOTE_ON, NOTE_OFF } from "audiobus/commands/commands"
import type { IAudioCommand } from "audiobus/commands/audio-command-interface"

const { Midi } = createRequire(resolve("../../packages/audiobus/package.json"))("@tonejs/midi")
function fixture(changes: Partial<EnsembleSettings> = {}, edit?: (midi: any) => void) {
	const midi = new Midi()
	midi.header.setTempo(120)
	for (const channel of [0, 1, 9]) {
		const track = midi.addTrack()
		track.channel = channel
		if (channel === 9) {
			for (const time of [0, 0.5, 1, 1.5, 4, 4.5, 5, 5.5]) {
				track.addNote({ midi: time < 4 ? 36 : 42, time, duration: 0.1, velocity: 0.6 })
			}
		} else {
			for (let time = 0; time < 16; time += 0.5) {
				track.addNote({
					midi: 60 + channel + time * 2,
					time,
					duration: 0.25,
					velocity: 0.8
				})
			}
		}
	}
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
const attacks = (commands: IAudioCommand[], channel?: number) =>
	commands.filter((c) => c.type === NOTE_ON && (channel === undefined || c.channel === channel))
function tap(performance: EnsembleSession, player: number, now: number) {
	const output = performance.press(player, now)
	output.push(...performance.releasePress(player, now))
	return output
}

describe("gesture-controlled ensemble notes and phase-aligned grooves", () => {
	it("keeps groove attacks evenly scheduled despite uneven clock callbacks", () => {
		const { performance } = fixture({ lookahead: 0.15 })
		const output = tap(performance, 2, 10)
		const intervals = [0.06, 0.14, 0.08, 0.12, 0.07, 0.1]
		for (let now = 10, index = 0; now < 16; ) {
			now += intervals[index++ % intervals.length]
			output.push(...performance.advance(now))
		}
		const times = attacks(output, 10)
			.filter((c) => c.audioTime! < 16)
			.map((c) => Math.round(c.audioTime! * 1000))
		expect(times).toEqual(Array.from({ length: 12 }, (_, i) => 10000 + i * 500))
	})
	it("never sends reset releases before already scheduled future attacks", () => {
		const { performance } = fixture({ lookahead: 0.15 })
		tap(performance, 0, 0)
		tick(performance, 0, 0.3)
		tap(performance, 0, 0.3)
		const scheduled = attacks(performance.advance(0.4), 1)
		expect(scheduled[0].audioTime).toBeCloseTo(0.5)
		performance.reset()
		const off = performance.advance(0.41).find((c) => c.type === NOTE_OFF && c.number === 61)!
		expect(off.audioTime).toBeGreaterThanOrEqual(scheduled[0].audioTime!)
	})
	it("selects an unscheduled stop boundary when a bar attack was already sent ahead", () => {
		const { performance } = fixture({ lookahead: 0.15 })
		tap(performance, 2, 0)
		tick(performance, 0, 1.9)
		performance.stopGroove(10)
		expect(performance.partState(10)).toBe("Stopping at bar 3")
		const output = attacks(tick(performance, 1.9, 5), 10)
		expect(output.some((c) => c.audioTime! >= 4)).toBe(false)
		expect(performance.partState(10)).toBe("Tap to loop")
	})
	it("performs Never Gonna with individual melody gestures and continuous drums", () => {
		const { performance } = fixture({ lookahead: 0.15 })
		const midi = new Midi(readFileSync("public/midi/never-gonna-give-you-up.mid"))
		const song = midiSong(midi)
		const melody = song.channels.find((channel) => channel !== 10)!
		performance.configure({
			...performance.settings,
			players: [
				{ source: "melody", channels: [melody] },
				{ source: "drums", channels: [10] }
			]
		})
		performance.setSong(song)
		const initial = tap(performance, 0, 0)
		const initialMelody = attacks(initial, melody)
		expect(initialMelody).toEqual([])
		expect(performance.partState(melody)).toContain("Queued")
		tap(performance, 1, 0)
		const output = tick(performance, 0, 12)
		expect(attacks(output, melody)).toHaveLength(1)
		expect(attacks(output, melody)[0].audioTime).toBeCloseTo(
			midi.tracks.find((t: any) => t.channel + 1 === melody && t.notes.length)!.notes[0]
				.time - song.events.find((e) => e.command.type === NOTE_ON)!.at
		)
		expect(attacks(output, 10).length).toBeGreaterThan(8)
		const next = attacks(tap(performance, 0, 12), melody)
		expect(next.length).toBeGreaterThan(0)
		expect(new Set(next.map((c) => c.audioTime)).size).toBe(1)
	})
	it("prevents an old release from cutting a rapidly retriggered MIDI pitch", () => {
		const { performance } = fixture({}, (midi) => {
			for (const note of midi.tracks[0].notes) {
				note.midi = 60
				note.duration = 1
			}
		})
		tap(performance, 0, 0)
		tick(performance, 0, 0.6)
		const second = tap(performance, 0, 0.6).filter(
			(c) => c.channel === 1 && [NOTE_ON, NOTE_OFF].includes(c.type)
		)
		expect(second.map((c) => c.type)).toEqual([NOTE_OFF, NOTE_ON])
		const off = tick(performance, 0.6, 1.7).filter(
			(c) => c.channel === 1 && c.type === NOTE_OFF
		)
		expect(off).toHaveLength(1)
		expect(off[0].audioTime).toBeGreaterThan(1.5)
	})
	it("repeats the song on a bar boundary without duplicate groove attacks", () => {
		const { performance } = fixture({ loop: true, lookahead: 0.15 })
		const output = [...tap(performance, 2, 0), ...tick(performance, 0, 17)]
		const times = attacks(output, 10).map((c) => Math.round(c.audioTime! * 1000))
		expect(times.filter((t) => t === 16000)).toHaveLength(1)
		expect(times.filter((t) => t >= 16000)).toEqual([16000, 16500, 17000])
	})
	it("cleans up sounding notes when switching between performance and legacy modes", () => {
		const { performance, settings } = fixture()
		tap(performance, 0, 0)
		performance.configure({ ...settings, mode: "together" })
		expect(performance.advance(0.1).some((c) => c.type === NOTE_OFF && c.channel === 1)).toBe(
			true
		)
		performance.press(0, 0.2)
		performance.configure(settings)
		expect(performance.advance(0.3).some((c) => c.type === NOTE_OFF && c.channel === 1)).toBe(
			true
		)
	})
	it("plays just one onset while held, even with assistance enabled", () => {
		const { performance } = fixture({ assist: true })
		expect(attacks(performance.press(0, 0), 1).map((c) => c.number)).toEqual([60])
		expect(attacks(tick(performance, 0, 3), 1)).toEqual([])
		expect(attacks(performance.press(0, 3), 1)).toEqual([])
		performance.releasePress(0, 3)
		expect(attacks(tap(performance, 0, 3), 1).map((c) => c.number)).toEqual([61])
	})
	it("plays simultaneous chord notes together and retains their separate durations", () => {
		const { performance } = fixture({}, (midi) =>
			midi.tracks[0].addNote({ midi: 48, time: 0, duration: 0.75, velocity: 0.8 })
		)
		expect(
			attacks(tap(performance, 0, 0), 1)
				.map((c) => c.number)
				.sort()
		).toEqual([48, 60])
		const off = tick(performance, 0, 1).filter((c) => c.type === NOTE_OFF && c.channel === 1)
		expect(off.map((c) => [c.number, Math.round(c.audioTime! * 1000)])).toEqual([
			[60, 250],
			[48, 750]
		])
	})
	it("keeps missed notes in order when less than two bars behind", () => {
		const { performance } = fixture()
		tap(performance, 0, 0)
		tick(performance, 0, 3)
		expect(attacks(tap(performance, 0, 3), 1).map((c) => c.number)).toEqual([61])
		expect(attacks(tap(performance, 0, 3.1), 1).map((c) => c.number)).toEqual([62])
	})
	it("recovers a part many bars behind to the current bar without playing a burst", () => {
		const { performance } = fixture()
		tap(performance, 0, 0)
		tick(performance, 0, 6.2)
		expect(attacks(tap(performance, 0, 6.2), 1).map((c) => c.number)).toEqual([72])
		expect(performance.partState(1)).toContain("Rejoining")
		expect(attacks(tick(performance, 6.2, 7), 1)).toEqual([])
	})
	it("uses the configured recovery window", () => {
		const { performance } = fixture({ recoveryBars: 4 })
		tap(performance, 0, 0)
		tick(performance, 0, 6.2)
		expect(attacks(tap(performance, 0, 6.2), 1).map((c) => c.number)).toEqual([61])
	})
	it("holds at most one early request and aligns it to its score onset", () => {
		const { performance } = fixture({ lookahead: 0.15 })
		tap(performance, 0, 0)
		expect(attacks(tap(performance, 0, 0.05), 1)).toEqual([])
		tap(performance, 0, 0.1)
		expect(performance.partState(1)).toContain("Queued: C♯4")
		const notes = attacks(tick(performance, 0.1, 1.5), 1)
		expect(notes.map((c) => c.number)).toEqual([61])
		expect(notes[0].audioTime).toBeCloseTo(0.5)
	})
	it("preserves independent progress for players tapping at different rates", () => {
		const { performance } = fixture()
		tap(performance, 0, 0)
		tap(performance, 1, 0)
		tick(performance, 0, 0.5)
		tap(performance, 0, 0.5)
		tick(performance, 0.5, 1)
		expect(attacks(tap(performance, 0, 1), 1).map((c) => c.number)).toEqual([62])
		expect(attacks(tap(performance, 1, 1), 2).map((c) => c.number)).toEqual([62])
	})
	it("loops drums through empty bars and adopts new score patterns", () => {
		const { performance } = fixture({ pauseBeats: 1 })
		const notes = attacks([...tap(performance, 2, 0), ...tick(performance, 0, 6)], 10)
		expect(
			notes.filter((c) => c.audioTime! >= 2 && c.audioTime! < 4).map((c) => c.number)
		).toEqual([36, 36, 36, 36])
		expect(
			notes.filter((c) => c.audioTime! >= 4 && c.audioTime! < 6).map((c) => c.number)
		).toEqual([42, 42, 42, 42])
		expect(performance.state.running).toBe(true)
		expect(performance.partState(10)).toContain("Looping")
	})
	it("joins a running groove at a bar boundary instead of restarting its pattern", () => {
		const { performance } = fixture()
		tap(performance, 0, 0)
		tick(performance, 0, 0.7)
		expect(attacks(tap(performance, 2, 0.7), 10)).toEqual([])
		expect(performance.partState(10)).toContain("queued")
		const notes = attacks(tick(performance, 0.7, 2.6), 10)
		expect(notes.map((c) => c.audioTime)).toEqual([2, 2.5])
	})
	it("accents a running groove without extra attacks or phase resets", () => {
		const { performance } = fixture()
		tap(performance, 2, 0)
		tick(performance, 0, 0.7)
		expect(attacks(tap(performance, 2, 0.7), 10)).toEqual([])
		const notes = attacks(tick(performance, 0.7, 1.6), 10)
		expect(notes.map((c) => c.audioTime)).toEqual([1, 1.5])
		expect(notes[0].velocity).toBeGreaterThan(notes[1].velocity)
	})
	it("stops loops explicitly on a bar boundary and can relaunch them", () => {
		const { performance } = fixture()
		tap(performance, 2, 0)
		tick(performance, 0, 0.7)
		performance.stopGroove(10)
		const notes = attacks(tick(performance, 0.7, 3), 10)
		expect(notes.map((c) => c.audioTime)).toEqual([1, 1.5])
		expect(performance.partState(10)).toBe("Tap to loop")
		tap(performance, 2, 3)
		expect(attacks(tick(performance, 3, 4.1), 10).map((c) => c.audioTime)).toEqual([4])
	})
	it("does not carry a percussion pattern across an explicit section marker", () => {
		const { performance } = fixture({}, (midi) => {
			midi.header.meta.push({ type: "marker", text: "Break", ticks: midi.header.ppq * 4 })
		})
		tap(performance, 2, 0)
		const notes = attacks(tick(performance, 0, 5), 10)
		expect(notes.filter((c) => c.audioTime! >= 2 && c.audioTime! < 4)).toEqual([])
		expect(notes.some((c) => c.audioTime === 4)).toBe(true)
	})
	it("allows notes on drums and grooves on pitched parts, preserving written rests", () => {
		const { performance } = fixture({ partRoles: { 10: "notes", 1: "groove" } }, (midi) => {
			midi.tracks[0].notes = midi.tracks[0].notes.filter(
				(n: any) => n.time < 2 || n.time >= 4
			)
		})
		expect(performance.partRole(10)).toBe("notes")
		tap(performance, 2, 0)
		tap(performance, 0, 0)
		const output = tick(performance, 0, 5)
		expect(attacks(output, 10)).toEqual([])
		expect(attacks(output, 1).filter((c) => c.audioTime! >= 2 && c.audioTime! < 4)).toEqual([])
		expect(attacks(output, 1).some((c) => c.audioTime === 4)).toBe(true)
	})
	it("pauses idle note-only performances and resumes without rewinding progress", () => {
		const { performance } = fixture({ pauseBeats: 2 })
		tap(performance, 0, 0)
		tick(performance, 0, 1.2)
		expect(performance.state.paused).toBe(true)
		expect(attacks(tap(performance, 0, 2), 1).map((c) => c.number)).toEqual([61])
	})
	it("resets notes, queued gestures, and latched grooves together", () => {
		const { performance } = fixture()
		tap(performance, 0, 0)
		tap(performance, 0, 0.1)
		tap(performance, 2, 0.1)
		performance.reset()
		expect(attacks(tick(performance, 0.1, 3))).toEqual([])
		expect(attacks(tap(performance, 0, 3), 1).map((c) => c.number)).toEqual([60])
		expect(performance.partState(10)).toBe("Tap to loop")
	})
	it("keeps groove beat phase through tempo and meter changes", () => {
		const { performance, midi } = fixture({}, (midi) => {
			midi.header.tempos = [
				{ ticks: 0, bpm: 120 },
				{ ticks: midi.header.ppq * 4, bpm: 60 }
			]
			midi.header.timeSignatures = [
				{ ticks: 0, timeSignature: [4, 4] },
				{ ticks: midi.header.ppq * 4, timeSignature: [3, 4] }
			]
			midi.header.update()
		})
		tap(performance, 2, 0)
		const notes = attacks(tick(performance, 0, 3.1), 10)
		expect(
			notes.some(
				(c) =>
					Math.abs(c.audioTime! - midi.header.ticksToSeconds(midi.header.ppq * 4)) < 1e-7
			)
		).toBe(true)
		expect(performance.state.bar).toBe(2)
	})
})