import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoteTimeline } from '../../../packages/audiobus/ui/note-timeline'

afterEach(() => vi.unstubAllGlobals())

describe('note timeline', () => {
    it('retains short notes, chords and repeated pitches with separate durations', () => {
        const timeline = new NoteTimeline()
        timeline.noteOn(60, 0, 'red')
        timeline.noteOn(64, 0, 'blue')
        timeline.noteOn(60, .01, 'red')
        timeline.noteOff(60, .02)
        timeline.noteOff(60, .03)
        timeline.noteOn(64, .04, 'blue', 0)
        expect(timeline.notes.map(note => [note.note, note.start, note.end])).toEqual([
            [60, 0, .02], [64, 0, .04], [60, .01, .03],
        ])
        expect(timeline.active.size).toBe(0)
    })

    it('finishes all overlapping notes without discarding history', () => {
        const timeline = new NoteTimeline()
        for (const note of [0, 60, 60, 127]) timeline.noteOn(note, 1, 'red')
        timeline.noteOff(12, 2)
        timeline.allNotesOff(3)
        expect(timeline.notes.map(note => note.end)).toEqual([3, 3, 3, 3])
        expect(timeline.active.size).toBe(0)
    })

    it('renders durations at the selected zoom and preserves history after panning', async () => {
        let frame: FrameRequestCallback
        const context = Object.fromEntries(['fillRect', 'fillText', 'save', 'beginPath', 'rect', 'clip', 'restore'].map(name => [name, vi.fn()]))
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback })
        vi.stubGlobal('onmessage', null)
        vi.stubGlobal('performance', { timeOrigin: 1000, now: () => 3000 })
        await import('../../../packages/audiobus/ui/note-timeline-worker')
        const send = (data: object) => globalThis.onmessage!({ data } as MessageEvent)
        send({ canvas: { width: 1080, height: 320, getContext: () => context } })
        send({ type: 'noteOn', note: 72, colour: 'red', velocity: 1, time: 1000 })
        send({ type: 'noteOff', note: 72, time: 2000 })
        frame!(0)
        expect(context.fillRect).toHaveBeenCalledWith(48, 193, 100, 12)
        send({ type: 'zoom', factor: 2, anchor: 0 })
        frame!(0)
        expect(context.fillRect).toHaveBeenCalledWith(48, 193, 200, 12)
        send({ type: 'pan', x: 100, y: 0 })
        send({ type: 'pan', x: -100, y: 0 })
        context.fillRect.mockClear()
        frame!(0)
        expect(context.fillRect).toHaveBeenCalledWith(48, 193, 200, 12)
        send({ type: 'clear' })
        context.fillRect.mockClear()
        frame!(0)
        expect(context.fillRect).not.toHaveBeenCalledWith(48, 193, 200, 12)
        expect(context.fillText).toHaveBeenCalledWith('Play notes to build a timeline', 64, 54)
        send({ type: 'noteOn', note: 72, colour: 'red', velocity: 1, time: 4000 })
        send({ type: 'noteOff', note: 72, time: 4500 })
        frame!(0)
        expect(context.fillRect).toHaveBeenCalledWith(48, 193, 100, 12)
    })
})
