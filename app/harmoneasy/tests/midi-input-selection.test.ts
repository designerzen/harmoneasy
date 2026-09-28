import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import InputWebMIDIDevice from '../../../packages/audiobus/io/inputs/input-webmidi-device'
import { acceptsMidiInput } from '../../../packages/audiobus/io/inputs/midi-input-controls'
import { NOTE_OFF, NOTE_ON } from '../../../packages/audiobus/commands'

const midi = vi.hoisted(() => ({ inputs: [] as any[], enable: vi.fn(async () => {}), addListener: vi.fn(), removeListener: vi.fn() }))
vi.mock('../../../packages/audiobus/node_modules/webmidi/dist/esm/webmidi.esm.js', () => ({ WebMidi: midi }))

class Element {
    style = {}
    children: Element[] = []
    value = ''
    textContent = ''
    onchange?: () => void
    append(...items: Element[]) { this.children.push(...items) }
    replaceChildren(...items: Element[]) { this.children = items }
    remove() {}
}
function device(id: string) {
    const callbacks = new Set<(event: any) => void>()
    return { id, name: id, manufacturer: 'Test', type: 'input',
        addListener: vi.fn((_type, callback) => callbacks.add(callback)),
        removeListener: vi.fn((_type, callback) => callbacks.delete(callback)),
        close: vi.fn(), destroy: vi.fn(),
        send: (channel: number, velocity = 100) => {
            for (const callback of callbacks) callback({ type: 'midimessage', message: { data: [0x90 + channel - 1, 60, velocity] } })
        }
    }
}
async function setup(options = {}) {
    const input = new InputWebMIDIDevice(options)
    const dispatch = vi.spyOn(input, 'dispatch')
    await input.connect()
    const gui = await input.createGui() as unknown as Element
    const deviceSelect = gui.children[0].children[0]
    const channelSelect = gui.children[1].children[0]
    const select = (element: Element, value: string) => { element.value = value; element.onchange!() }
    return { input, dispatch, deviceSelect, channelSelect, select }
}
beforeEach(() => {
    vi.clearAllMocks()
    midi.inputs = [device('a'), device('b')]
    vi.stubGlobal('document', { createElement: () => new Element() })
})
afterEach(() => vi.unstubAllGlobals())

describe('MIDI input selection', () => {
    it('routes two inputs independently by device and channel, including All', async () => {
        const a = await setup()
        const b = await setup()
        a.select(a.deviceSelect, 'a')
        a.select(a.channelSelect, '2')
        b.select(b.deviceSelect, 'b')
        midi.inputs[0].send(1)
        midi.inputs[0].send(2)
        midi.inputs[1].send(16)
        expect(a.dispatch).toHaveBeenCalledTimes(1)
        expect(a.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ type: NOTE_ON, channel: 2, velocity: 100 }))
        expect(b.dispatch).toHaveBeenCalledTimes(1)
        a.select(a.deviceSelect, '')
        a.select(a.channelSelect, '0')
        a.dispatch.mockClear()
        midi.inputs[1].send(1)
        midi.inputs[0].send(16)
        expect(a.dispatch).toHaveBeenCalledTimes(2)
        await a.input.destroy()
        await b.input.destroy()
    })

    it('releases held notes when switching and does not close another input\'s device', async () => {
        const a = await setup()
        const b = await setup()
        midi.inputs[0].send(1)
        a.select(a.channelSelect, '3')
        expect(a.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ type: NOTE_OFF, number: 60 }))
        await a.input.destroy()
        b.dispatch.mockClear()
        midi.inputs[0].send(1, 0)
        expect(b.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ type: NOTE_OFF }))
        expect(midi.inputs[0].close).not.toHaveBeenCalled()
        expect(midi.inputs[0].destroy).not.toHaveBeenCalled()
        await b.input.destroy()
    })

    it('restores selections and retains an unavailable device through hotplug', async () => {
        const a = await setup({ selectedDevice: 'later', selectedChannel: 16 })
        expect(a.deviceSelect.value).toBe('later')
        expect(a.channelSelect.value).toBe('16')
        midi.inputs[0].send(16)
        expect(a.dispatch).not.toHaveBeenCalled()
        const later = device('later')
        midi.inputs.push(later)
        const connected = midi.addListener.mock.calls.find(([type]) => type === 'connected')![1]
        connected({ type: 'connected', port: later })
        connected({ type: 'connected', port: later })
        later.send(16)
        expect(a.dispatch).toHaveBeenCalledTimes(1)
        expect(later.addListener).toHaveBeenCalledTimes(1)
        expect(a.deviceSelect.children.some(option => option.value === 'later' && !option.textContent.includes('unavailable'))).toBe(true)
        await a.input.destroyGui()
        const gui = await a.input.createGui() as unknown as Element
        expect(gui.children[0].children[0].value).toBe('later')
        await a.input.destroy()
    })

    it('offers All choices without devices and accepts saved legacy channel lists and native index zero', async () => {
        midi.inputs = []
        const a = await setup()
        expect(a.deviceSelect.children[0].textContent).toBe('All devices')
        expect(a.channelSelect.children).toHaveLength(17)
        expect(acceptsMidiInput({ selectedDevice: 0, channels: [2, 3] }, '0', 3)).toBe(true)
        expect(acceptsMidiInput({ selectedDevice: 0, channels: [2, 3] }, '1', 3)).toBe(false)
        expect(acceptsMidiInput({ channels: [2, 3] }, 'a', 1)).toBe(false)
        await a.input.destroy()
    })
})


