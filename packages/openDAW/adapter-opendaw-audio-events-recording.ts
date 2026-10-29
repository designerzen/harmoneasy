import type RecorderAudioEvent from "audiobus/audio-event-recorder.ts"
import { NOTE_OFF, NOTE_ON } from "audiobus/commands"
import type { IAudioCommand } from "audiobus/audio-command-interface.ts"

// OpenDAW uses 960 pulses per quarter note; netronome uses 3840.
const OPENDAW_PPQ = 960

/**
 *  @param recording
 *  @param timer
 */
export const createOpenDAWProjectFromAudioEventRecording = async (
	recording: Pick<RecorderAudioEvent, "events" | "duration" | "name">,
	timer: { readonly BPM: number }
) => {
	const bpm = timer.BPM
	if (!Number.isFinite(bpm) || bpm < 30 || bpm > 1000) {
		throw new Error("OpenDAW requires a tempo between 30 and 1000 BPM.")
	}
	const toPulses = (seconds: number) => Math.round(((seconds * bpm) / 60) * OPENDAW_PPQ)
	const events = recording.events
		.filter((event) => Number.isFinite(event.startAt))
		.slice()
		.sort((a, b) => a.startAt - b.startAt)
	const pending = new Map<string, IAudioCommand[]>()
	const completed: { event: IAudioCommand; end: number }[] = []

	// Pair by chain, source, channel and pitch without mutating the recorder.
	// exportData() pairs only by pitch; AudioEvent.duration uses a different time origin.
	for (const event of events) {
		if (!Number.isInteger(event.number) || event.number < 0 || event.number > 127) {
			continue
		}
		const key = JSON.stringify([event.chainId ?? "", event.from, event.channel, event.number])
		if (event.type === NOTE_OFF || (event.type === NOTE_ON && event.velocity === 0)) {
			const on = pending.get(key)?.shift()
			if (on) {
				completed.push({ event: on, end: event.startAt })
			}
		} else if (
			event.type === NOTE_ON &&
			Number.isFinite(event.velocity) &&
			event.velocity > 0
		) {
			const queue = pending.get(key) ?? []
			queue.push(event)
			pending.set(key, queue)
		}
	}
	for (const queue of pending.values()) {
		for (const event of queue) {
			const end = event.endAt > event.startAt ? event.endAt : recording.duration
			completed.push({
				event,
				end: Number.isFinite(end) && end > event.startAt ? end : event.startAt + 0.1
			})
		}
	}
	completed.sort((a, b) => a.event.startAt - b.event.startAt)
	const startedAt = completed[0]?.event.startAt ?? 0
	const notes = completed.map(({ event, end }) => ({
		position: Math.max(0, toPulses(event.startAt - startedAt)),
		pitch: event.number,
		velocity: Math.min(127, event.velocity) / 127,
		duration: Math.max(1, toPulses(end - event.startAt))
	}))
	const duration = notes.reduce((end, note) => Math.max(end, note.position + note.duration), 1)

	// openDAW script editor (very early preview - under heavy construction)
	const script: string = `
    // Paste into https://opendaw.studio/scripting
    
    const project = openDAW.newProject(${JSON.stringify(recording.name ?? "New Harmoneasy Project")})
    project.bpm = ${bpm}
    project.duration = ${duration}
    project.output.volume = -6.0

    const notes = ${JSON.stringify(notes, null, 4)}
       
    project
        .addInstrumentUnit("Vaporisateur")
        .addNoteTrack()
        .addRegion({duration:${duration}, loopDuration:${duration}})
        .addEvents(notes)

    project.openInStudio()
    `

	return script
}