// @vitest-environment happy-dom
import OutputRecorder from '../../../packages/audiobus/io/outputs/output-recorder'
import type IOChainManager from '../../../packages/audiobus/io/IO-chain-manager'
import { EVENT_CHAINS_UPDATED } from '../../../packages/audiobus/event-constants'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RECORDING_STATE_CHANGED } from '../source/services/recording-format'
import { createRecordingControls } from '../source/services/recording-dialog'

vi.mock('../source/services/audio-recording', () => ({
    AudioRecording: class extends EventTarget {
        state = 'idle'
        frames = 0
        sampleRate = 48000
        storage = 'opfs'
        error = ''
        duration = 3
        ready = Promise.resolve()
        get hasTake() { return this.frames > 0 }
        change() { this.dispatchEvent(new Event(RECORDING_STATE_CHANGED)) }
        async start() { this.frames = 0; this.state = 'recording'; this.change() }
        async stop() { this.frames = 144000; this.state = 'idle'; this.change() }
        wave = vi.fn(async () => new Blob(['audio'], { type: 'audio/wav' }))
    },
}))

const button = (id: string) => document.querySelector<HTMLButtonElement>(`#${id}`)!
const status = () => document.querySelector('#recording-status')!.textContent
let createURL: ReturnType<typeof vi.spyOn>
let revokeURL: ReturnType<typeof vi.spyOn>
beforeEach(() => {
    const markup = new DOMParser().parseFromString(readFileSync(resolve('index.html'), 'utf8'), 'text/html')
    document.body.replaceChildren(
        markup.querySelector('#midi-transport-control')!.cloneNode(true),
        markup.querySelector('#recording-dialog')!.cloneNode(true),
    )
    createURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:take')
    revokeURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); delete (window as any).showSaveFilePicker })

it('flashes only while recording and opens a playable take on stop', async () => {
    const recording = createRecordingControls({} as AudioContext, {} as AudioNode)
    await recording.ready
    button('btn-record').click()
    await vi.waitFor(() => expect(button('btn-record').classList.contains('is-recording')).toBe(true))
    expect(button('btn-record').getAttribute('aria-pressed')).toBe('true')
    expect(button('btn-recording-review').disabled).toBe(true)
    const clock = document.querySelector('#clock')!
    expect(document.querySelector('#recording-clock')).toBeNull()
    expect(clock.classList.contains('is-recording')).toBe(true)
    expect(clock.getAttribute('aria-label')).toContain('recording audio')
    expect(clock.textContent).toBe('00:00:00:00')
    button('btn-record').click()
    await vi.waitFor(() => expect(button('recording-save').disabled).toBe(false))
    expect(button('btn-record').classList.contains('is-recording')).toBe(false)
    expect(clock.classList.contains('is-recording')).toBe(false)
    expect(document.activeElement).toBe(button('recording-save'))
    expect(document.querySelector<HTMLDialogElement>('#recording-dialog')!.open).toBe(true)
    expect(document.querySelector<HTMLAudioElement>('#recording-playback')!.src).toBe('blob:take')
    expect(createURL).toHaveBeenCalled()
    button('recording-close').click()
    button('btn-recording-review').click()
    await vi.waitFor(() => expect(button('recording-save').disabled).toBe(false))
    expect(revokeURL).toHaveBeenCalledWith('blob:take')
    button('recording-close').click()
    button('btn-record').click()
    expect(recording.hasTake).toBe(false)
})

it('keeps the take and playback when the save picker is cancelled', async () => {
    const recording = createRecordingControls({} as AudioContext, {} as AudioNode)
    await recording.ready
    button('btn-record').click()
    button('btn-record').click()
    await vi.waitFor(() => expect(button('recording-save').disabled).toBe(false))
    ;(window as any).showSaveFilePicker = vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError'))
    button('recording-save').click()
    await vi.waitFor(() => expect(status()).toContain('Save cancelled'))
    expect(recording.hasTake).toBe(true)
    expect(button('recording-save').disabled).toBe(false)
    expect(document.querySelector<HTMLAudioElement>('#recording-playback')!.src).toBe('blob:take')
})

it('streams the selected WAV format to the chosen destination', async () => {
    const recording = createRecordingControls({} as AudioContext, {} as AudioNode)
    await recording.ready
    button('btn-record').click()
    button('btn-record').click()
    await vi.waitFor(() => expect(button('recording-save').disabled).toBe(false))
    const write = vi.fn()
    const close = vi.fn()
    const output = new WritableStream({ write, close })
    ;(window as any).showSaveFilePicker = vi.fn().mockResolvedValue({ createWritable: async () => output })
    document.querySelector<HTMLSelectElement>('#recording-format')!.value = '32'
    button('recording-save').click()
    await vi.waitFor(() => expect(status()).toContain('Recording saved'))
    expect(recording.wave).toHaveBeenLastCalledWith(32)
    expect(write).toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
})

it('only shows the global recording toggle while Recorder outputs are attached and synchronises their controls', async () => {
    const outputs: OutputRecorder[] = []
    const manager = Object.assign(new EventTarget(), { chains: [{ outputs }] })
    const recording = createRecordingControls({} as AudioContext, {} as AudioNode, document, manager as unknown as IOChainManager)
    await recording.ready
    expect(button('btn-record').hidden).toBe(true)
    expect(button('btn-recording-review').hidden).toBe(true)
    const first = new OutputRecorder()
    const second = new OutputRecorder()
    const firstGui = await first.createGui()
    const secondGui = await second.createGui()
    outputs.push(first, second)
    manager.dispatchEvent(new Event(EVENT_CHAINS_UPDATED))
    await vi.waitFor(() => expect(recording.state).toBe('recording'))
    expect(button('btn-record').hidden).toBe(false)
    expect(document.querySelector('#clock')!.classList.contains('is-recording')).toBe(true)
    for (const gui of [firstGui, secondGui]) expect(gui.querySelector('[data-record]')!.getAttribute('aria-pressed')).toBe('true')
    button('btn-record').click()
    await vi.waitFor(() => expect(button('recording-save').disabled).toBe(false))
    for (const gui of [firstGui, secondGui]) expect(gui.querySelector('[data-record]')!.getAttribute('aria-pressed')).toBe('false')
    button('recording-close').click()
    firstGui.querySelector<HTMLButtonElement>('[data-record]')!.click()
    await vi.waitFor(() => expect(recording.state).toBe('recording'))
    outputs.splice(0)
    manager.dispatchEvent(new Event(EVENT_CHAINS_UPDATED))
    await vi.waitFor(() => expect(recording.state).toBe('idle'))
    expect(button('btn-record').hidden).toBe(true)
    expect(document.querySelector('#clock')!.classList.contains('is-recording')).toBe(false)
    expect(document.body.classList.contains('is-recording')).toBe(false)
})
