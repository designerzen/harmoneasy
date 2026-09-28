import { secondsToTicks } from '@audiotool/nexus/utils'
import type { SafeTransactionBuilder } from '@audiotool/nexus/document'

export interface RecordedCommand {
    type: string
    number: number
    startAt: number
    endAt?: number
    velocity: number
    channel: number
    from: string
    chainId?: string
    chainName?: string
}

export interface TakeNote {
    chainId?: string
    chainName?: string
    source: string
    channel: number
    pitch: number
    velocity: number
    positionTicks: number
    durationTicks: number
}

export interface AudioToolTake {
    name: string
    bpm: number
    startedAt: number
    notes: TakeNote[]
}

/** Snapshot without mutating the recorder or pairing notes across inputs. */
export function captureAudioToolTake(commands: readonly RecordedCommand[], bpm: number, endedAt: number, name = 'Harmoneasy'): AudioToolTake {
    if (!Number.isFinite(bpm) || bpm < 30 || bpm > 1000) throw new Error('AudioTool requires a tempo between 30 and 1000 BPM.')
    const events = commands.filter(event => Number.isFinite(event.startAt)).slice().sort((a, b) => a.startAt - b.startAt)
    const pending = new Map<string, RecordedCommand[]>()
    const completed: { event: RecordedCommand, end: number }[] = []
    for (const event of events) {
        if (!Number.isInteger(event.number) || event.number < 0 || event.number > 127) continue
        const key = JSON.stringify([event.chainId ?? '', event.from, event.channel, event.number])
        if (event.type === 'noteOff' || (event.type === 'noteOn' && event.velocity === 0)) {
            const on = pending.get(key)?.shift()
            if (on) completed.push({ event: on, end: event.startAt })
        } else if (event.type === 'noteOn' && Number.isFinite(event.velocity) && event.velocity > 0) {
            const queue = pending.get(key) ?? []
            queue.push(event)
            pending.set(key, queue)
        }
    }
    for (const queue of pending.values()) {
        for (const event of queue) {
            const end = event.endAt && event.endAt > event.startAt ? event.endAt : endedAt
            completed.push({ event, end: Number.isFinite(end) && end > event.startAt ? end : event.startAt + 0.1 })
        }
    }
    if (!completed.length) throw new Error('Play or record some notes before sending a take.')
    completed.sort((a, b) => a.event.startAt - b.event.startAt)
    const startedAt = completed[0].event.startAt
    return {
        name, bpm, startedAt,
        notes: completed.map(({ event, end }) => ({
            chainId: event.chainId, chainName: event.chainName,
            source: event.from || 'Harmoneasy', channel: event.channel, pitch: event.number,
            velocity: Math.min(127, event.velocity) / 127,
            positionTicks: Math.max(0, Math.round(secondsToTicks(event.startAt - startedAt, bpm))),
            durationTicks: Math.max(1, Math.round(secondsToTicks(Math.max(0, end - event.startAt), bpm)))
        }))
    }
}

export interface TakeDestination {
    trackId?: string
    placement: 'start' | 'end'
    setTempo?: boolean
}

// Nexus validates each mutation as it is applied. Reject malformed takes before
// entering the transaction so a failed note cannot leave half a take behind.
export function validateAudioToolTake(take: AudioToolTake): void {
    if (!take || typeof take.name !== 'string' || !Number.isFinite(take.bpm) || take.bpm < 30 || take.bpm > 1000) throw new Error('Invalid take name or tempo.')
    if (!Array.isArray(take.notes) || !take.notes.length) throw new Error('The take contains no notes.')
    for (const note of take.notes) {
        if (!Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127
            || !Number.isFinite(note.velocity) || note.velocity < 0 || note.velocity > 1
            || !Number.isInteger(note.positionTicks) || note.positionTicks < 0
            || !Number.isInteger(note.durationTicks) || note.durationTicks < 1
            || note.positionTicks + note.durationTicks > 2147483647
            || typeof note.source !== 'string') throw new Error('The take contains invalid note data.')
    }
}

/** Only creates new regions/devices; existing project content is never removed. */
export function validateAudioToolDestination(t: SafeTransactionBuilder, take: AudioToolTake, destination: TakeDestination) {
    validateAudioToolTake(take)
    const selected = destination.trackId ? t.entities.ofTypes('noteTrack').get().find(track => track.id === destination.trackId) : undefined
    if (destination.trackId && !selected) throw new Error('The selected track no longer exists. Refresh the project and choose a track.')
    const regions = t.entities.ofTypes('noteRegion', 'audioRegion', 'patternRegion').get()
    const position = destination.placement === 'end' ? regions.reduce((end, item) => Math.max(end, item.fields.region.fields.positionTicks.value + item.fields.region.fields.durationTicks.value), 0) : 0
    const duration = take.notes.reduce((end, note) => Math.max(end, note.positionTicks + note.durationTicks), 1)
    if (position + duration > 2147483647) throw new Error('This take would exceed AudioTool’s timeline length.')
    return { selected, position, duration }
}

export function appendAudioToolTake(t: SafeTransactionBuilder, take: AudioToolTake, destination: TakeDestination): string[] {
    const { selected, position, duration } = validateAudioToolDestination(t, take, destination)
    const config = t.entities.ofTypes('config').get()[0]
        ?? t.create('config', { tempoBpm: destination.setTempo ? take.bpm : 125, defaultGroove: t.create('groove', {}).location })
    if (destination.setTempo) {
        t.update(config.fields.tempoBpm, take.bpm)
    }
    if (config.fields.durationTicks.value < position + duration) t.update(config.fields.durationTicks, position + duration)
    if (!t.entities.ofTypes('mixerMaster').get().length) t.create('mixerMaster', {})

    let order = t.entities.ofTypes('noteTrack', 'audioTrack', 'patternTrack', 'automationTrack').get().reduce((max, track) => Math.max(max, track.fields.orderAmongTracks.value), -1) + 1
    let stripOrder = t.entities.ofTypes('mixerChannel', 'mixerGroup', 'mixerAux', 'mixerDelayAux', 'mixerReverbAux').get().reduce((max, strip) => Math.max(max, strip.fields.displayParameters.fields.orderAmongStrips.value), -1) + 1
    const groups = new Map<string, TakeNote[]>()
    for (const note of take.notes) {
        const key = selected ? selected.id : JSON.stringify([note.chainId ?? '', note.source, note.channel])
        const group = groups.get(key) ?? []
        group.push(note)
        groups.set(key, group)
    }
    const ids: string[] = []
    for (const notes of groups.values()) {
        const first = notes[0]
        const label = `${first.chainName || take.name} — ${first.source}${first.channel >= 0 ? ` / channel ${first.channel}` : ''}`.slice(0, 120)
        let track = selected
        if (!track) {
            const channel = t.create('mixerChannel', { displayParameters: { displayName: label, orderAmongStrips: stripOrder++ } })
            const instrument = t.create('tonematrix', { displayName: label, positionX: order * 400, positionY: 0 })
            t.create('desktopAudioCable', { fromSocket: instrument.fields.audioOutput.location, toSocket: channel.fields.audioInput.location })
            track = t.create('noteTrack', { player: instrument.location, orderAmongTracks: order++ })
        }
        const collection = t.create('noteCollection', {})
        const region = t.create('noteRegion', {
            collection: collection.location, track: track.location,
            region: { displayName: take.name.slice(0, 120), positionTicks: position, durationTicks: duration, loopDurationTicks: duration }
        })
        ids.push(region.id)
        for (const note of notes) t.create('note', { collection: collection.location, pitch: note.pitch, velocity: note.velocity, positionTicks: note.positionTicks, durationTicks: note.durationTicks })
    }
    return ids
}
