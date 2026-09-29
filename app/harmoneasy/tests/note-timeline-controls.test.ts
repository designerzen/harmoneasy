import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const worker = vi.hoisted(() => ({ postMessage: vi.fn(), terminate: vi.fn() }))
vi.mock('../../../packages/audiobus/ui/note-timeline-worker.ts?worker', () => ({
    default: class { postMessage = worker.postMessage; terminate = worker.terminate },
}))
import NoteTimelineVisualiser from '../../../packages/audiobus/ui/note-timeline-visualiser'

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

it('mounts the interactive canvas and recording controls after the chain graph', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    expect(html.indexOf('id="note-timeline"')).toBeGreaterThan(html.indexOf('id="recordings"'))
    expect(html.indexOf('id="recordings"')).toBeGreaterThan(html.indexOf('id="graph"'))
    expect(html.match(/id="btn-reset"/g)).toHaveLength(1)
    expect(html).toContain('data-timeline-action="zoom-in"')
})

it('wires overlay buttons, keyboard navigation, note events and cleanup', () => {
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class { observe() {}; disconnect = disconnect })
    const buttons = ['zoom-in', 'zoom-out', 'follow'].map(action => Object.assign(new EventTarget(), { dataset: { timelineAction: action } }))
    const canvas = Object.assign(new EventTarget(), {
        width: 1080, height: 320,
        transferControlToOffscreen: () => ({}),
        setAttribute: vi.fn(),
        parentElement: { querySelectorAll: () => buttons },
    })
    const view = new NoteTimelineVisualiser(canvas as unknown as HTMLCanvasElement)
    for (const button of buttons) button.dispatchEvent(new Event('click'))
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'zoom', factor: 1.25, anchor: .5 })
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'zoom', factor: .8, anchor: .5 })
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'follow' })
    canvas.dispatchEvent(Object.assign(new Event('keydown'), { key: 'ArrowLeft' }))
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'pan', x: -100, y: 0 })
    view.noteOn(60, 1)
    view.noteOff(60)
    view.clear()
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'noteOn', note: 60 }))
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'noteOff', note: 60 }))
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'clear' })
    view.destroy()
    worker.postMessage.mockClear()
    buttons[0].dispatchEvent(new Event('click'))
    expect(worker.postMessage).not.toHaveBeenCalled()
    expect(disconnect).toHaveBeenCalled()
    expect(worker.terminate).toHaveBeenCalled()
})
