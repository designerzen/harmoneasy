// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { SongVisualiserUI } from '../../../packages/audiobus/ui/song-visualiser-ui'
import { NOTE_ON, NOTE_OFF, CONTROL_CHANGE } from '../../../packages/audiobus/commands'
import type { IAudioCommand } from '../../../packages/audiobus/audio-command-interface'
import type OPFSStorage from '../../../packages/audiobus/storage/opfs-storage'

vi.mock('../../../packages/audiobus/ui/song-visualiser-worker.ts?worker', () => ({
    default: class { postMessage = vi.fn(); terminate = vi.fn() },
}))

beforeEach(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', { configurable: true, value: () => ({}) })
})
afterEach(() => {
    document.body.replaceChildren()
    delete (HTMLCanvasElement.prototype as any).transferControlToOffscreen
    vi.restoreAllMocks()
})

const command = (type = NOTE_ON, number = 60, startAt = 0, extra = {}) =>
    ({ type, number, startAt, velocity: 100, channel: 1, from: 'keyboard', ...extra } as IAudioCommand)

it('removes the MIDI sidebar and points transport details to the recording component', () => {
    const html = readFileSync('index.html', 'utf8')
    const page = new DOMParser().parseFromString(html, 'text/html')
    expect(page.querySelector('#sidebar, #midi-input-commands, #midi-output-commands')).toBeNull()
    expect(page.querySelector('#btn-transport-details')!.getAttribute('aria-controls')).toBe('recordings')
    expect(page.querySelector('#settings-dialog #ble-manual-send-fieldset')).not.toBeNull()
})

it('reads storage on request and pages all command types without rendering the whole recording', async () => {
    const commands = Array.from({ length: 1024 }, (_, i) => command(CONTROL_CHANGE, i % 128, i, { from: '<b>source</b>', value: i }))
    const readAll = vi.fn().mockResolvedValue(commands)
    const view = new SongVisualiserUI()
    view.setStorage({ readAll } as unknown as OPFSStorage)
    document.body.append(view)
    const shadow = view.shadowRoot!
    expect(readAll).not.toHaveBeenCalled()
    expect(shadow.querySelectorAll('tbody tr')).toHaveLength(0)
    await view.showCommands()
    expect(readAll).toHaveBeenCalledOnce()
    expect(shadow.querySelectorAll('tbody tr')).toHaveLength(100)
    expect(shadow.querySelector('tbody tr')!.textContent).toContain(CONTROL_CHANGE)
    expect(shadow.querySelector('tbody b')).toBeNull()
    expect(shadow.querySelector('tbody tr')!.textContent).toContain('<b>source</b>')
    ;(shadow.querySelector('.commands-next') as HTMLButtonElement).click()
    expect(shadow.querySelector('tbody tr td')!.textContent).toBe('100')
    expect(shadow.querySelector('.commands-page')!.textContent).toContain('Page 2 of 11')
    for (let i = 0; i < 9; i++) (shadow.querySelector('.commands-next') as HTMLButtonElement).click()
    expect(shadow.querySelectorAll('tbody tr')).toHaveLength(24)
    expect((shadow.querySelector('.commands-next') as HTMLButtonElement).disabled).toBe(true)
    expect(JSON.parse(view.getVisualiser()!.exportAsJSON())).toHaveLength(1024)
})

it('pairs recorded notes by input, channel and chain, preserving note zero and zero timestamps', async () => {
    const view = new SongVisualiserUI()
    document.body.append(view)
    await view.loadCommands([
        command(NOTE_ON, 0, 0, { time: 99, velocity: 45 }),
        command(NOTE_ON, 60, 0, { channel: 2, velocity: 80 }),
        command(NOTE_ON, 60, .1, { channel: 2, velocity: 90 }),
        command(NOTE_ON, 60, .2, { from: 'other', velocity: 60 }),
        command(NOTE_OFF, 0, .5),
        command(NOTE_OFF, 60, 1, { channel: 2 }),
        command(NOTE_ON, 60, 2, { channel: 2, velocity: 0 }),
        command(NOTE_OFF, 60, 3, { from: 'other' }),
    ])
    expect(view.getVisualiser()!.getNoteBars().map(bar => [bar.noteNumber, bar.startTime, bar.endTime, bar.velocity])).toEqual([
        [0, 0, .5, 45], [60, 0, 1, 80], [60, .1, 2, 90], [60, .2, 3, 60],
    ])
    expect(view.shadowRoot!.querySelector('.duration-value')!.textContent).toBe('3.00s')
})

it('uses a recording snapshot when storage is unavailable, with no automatic live updates', async () => {
    const commands = [command()]
    const source = vi.fn(() => commands)
    const view = new SongVisualiserUI()
    view.setCommandSource(source)
    document.body.append(view)
    await view.refresh()
    commands.push(command(NOTE_OFF, 60, 1))
    expect(view.getVisualiser()!.commandCount).toBe(1)
    expect(source).toHaveBeenCalledOnce()
    await view.refresh()
    expect(view.getVisualiser()!.commandCount).toBe(2)
    view.reset()
    expect(view.getVisualiser()!.commandCount).toBe(0)
    expect(commands).toHaveLength(2)
})

it('coalesces refresh requests, recovers from failures and ignores results after reset', async () => {
    let resolve!: (commands: IAudioCommand[]) => void
    const readAll = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockImplementation(() => new Promise(done => { resolve = done }))
    const view = new SongVisualiserUI()
    view.setStorage({ readAll } as unknown as OPFSStorage)
    document.body.append(view)
    await Promise.all([view.refresh(), view.refresh()])
    expect(view.shadowRoot!.querySelector('.recording-status')!.textContent).toContain('Unable to load')
    const first = view.refresh(), second = view.refresh()
    await Promise.resolve()
    expect(readAll).toHaveBeenCalledTimes(2)
    view.reset()
    resolve([command()])
    await Promise.all([first, second])
    expect(view.getVisualiser()!.commandCount).toBe(0)
    expect((view.shadowRoot!.querySelector('.load-from-opfs') as HTMLButtonElement).disabled).toBe(false)
})

it('keeps a loaded recording when the component is removed and mounted again', async () => {
    const view = new SongVisualiserUI()
    document.body.append(view)
    await view.loadCommands([command(NOTE_ON), command(NOTE_OFF, 60, 1)])
    view.remove()
    document.body.append(view)
    expect(view.getVisualiser()!.commandCount).toBe(2)
    expect(view.getVisualiser()!.getNoteBars()).toHaveLength(1)
})
