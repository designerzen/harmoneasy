import { describe, expect, it, vi } from "vitest"
import { NOTE_OFF, NOTE_ON } from "../../../packages/audiobus/commands"
import type { IAudioCommand } from "../../../packages/audiobus/audio-command-interface"
import { createOpenDAWProjectFromAudioEventRecording } from "../../../packages/openDAW/adapter-opendaw-audio-events-recording"

const command = (
	type: string,
	startAt: number,
	extra: Partial<IAudioCommand> = {}
): IAudioCommand =>
	({
		type,
		startAt,
		number: 60,
		velocity: 100,
		channel: 1,
		from: "Keyboard",
		...extra
	}) as IAudioCommand

async function runExport(events: IAudioCommand[], bpm = 120, duration = 100, name = "Harmoneasy") {
	const addEvents = vi.fn(
		(_notes: { position: number; duration: number; pitch: number; velocity: number }[]) => {}
	)
	const addRegion = vi.fn((_props: { duration: number; loopDuration: number }) => ({ addEvents }))
	const addNoteTrack = vi.fn(() => ({ addRegion }))
	const project = {
		bpm: 0,
		duration: 0,
		output: { volume: 0 },
		addInstrumentUnit: vi.fn(() => ({ addNoteTrack })),
		openInStudio: vi.fn()
	}
	const newProject = vi.fn((_name: string) => project)
	const script = await createOpenDAWProjectFromAudioEventRecording(
		{ events, duration, name },
		{ BPM: bpm }
	)
	new Function("openDAW", script)({ newProject })
	return {
		project,
		newProject,
		notes: addEvents.mock.calls[0][0],
		region: addRegion.mock.calls[0][0]
	}
}

describe("OpenDAW script export", () => {
	it.each([60, 120, 180])("exports quarter notes as 960 pulses at %i BPM", async (bpm) => {
		const beat = 60 / bpm
		const events = [
			command(NOTE_ON, 40),
			command(NOTE_OFF, 40 + beat),
			command(NOTE_ON, 40 + 2 * beat),
			command(NOTE_OFF, 40 + 3 * beat)
		]
		const before = JSON.stringify(events)
		const { notes, project } = await runExport(events, bpm)
		expect(notes.map((note) => [note.position, note.duration])).toEqual([
			[0, 960],
			[1920, 960]
		])
		expect(notes[0].velocity).toBeCloseTo(100 / 127)
		expect(project.bpm).toBe(bpm)
		expect(project.openInStudio).toHaveBeenCalledOnce()
		expect(JSON.stringify(events)).toBe(before)
	})

	it("covers the whole take without looping after the first bar or clipping a long final note", async () => {
		const { notes, region, project } = await runExport([
			command(NOTE_ON, 40),
			command(NOTE_OFF, 40.5),
			command(NOTE_ON, 44),
			command(NOTE_OFF, 47)
		])
		expect(notes[1]).toMatchObject({ position: 7680, duration: 5760 })
		expect(region).toEqual({ duration: 13440, loopDuration: 13440 })
		expect(project.duration).toBe(13440)
	})

	it.each(["channel", "from", "chainId"] as const)(
		"pairs overlapping pitches independently by %s",
		async (field) => {
			const different = field === "channel" ? { channel: 2 } : { [field]: "other" }
			const { notes } = await runExport([
				command(NOTE_ON, 40),
				command(NOTE_ON, 40, different),
				command(NOTE_OFF, 40.5),
				command(NOTE_OFF, 41, different)
			])
			expect(notes.map((note) => note.duration)).toEqual([960, 1920])
		}
	)

	it("pairs repeated pitches FIFO and treats zero velocity as note off", async () => {
		const { notes } = await runExport([
			command(NOTE_ON, 40),
			command(NOTE_ON, 40.5),
			command(NOTE_ON, 41, { velocity: 0 }),
			command(NOTE_OFF, 42)
		])
		expect(notes.map((note) => [note.position, note.duration])).toEqual([
			[0, 1920],
			[960, 2880]
		])
	})

	it("uses timestamp differences rather than AudioEvent duration or noteNumber getters", async () => {
		const on = Object.assign(command(NOTE_ON, 40), { time: 500, duration: -459 })
		const { notes } = await runExport([on, command(NOTE_OFF, 41)])
		expect(notes[0]).toMatchObject({ pitch: 60, duration: 1920 })
	})

	it("closes held notes and exports a minimum one-pulse duration", async () => {
		const { notes } = await runExport(
			[command(NOTE_ON, 40), command(NOTE_OFF, 40), command(NOTE_ON, 41, { number: 64 })],
			120,
			42
		)
		expect(notes.map((note) => note.duration)).toEqual([1, 1920])
	})

	it("escapes the project name as data in executable scripts", async () => {
		const name = 'Take "A"\\B\nnext line'
		const { newProject } = await runExport([], 120, 0, name)
		expect(newProject).toHaveBeenCalledWith(name)
	})

	it("rejects invalid tempos before producing a script", async () => {
		await expect(runExport([], NaN)).rejects.toThrow("tempo")
	})
})