// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import IOChainManager from '../../../packages/audiobus/io/IO-chain-manager'
import IOChain from '../../../packages/audiobus/io/IO-chain'
import InputWebMIDIDevice from '../../../packages/audiobus/io/inputs/input-webmidi-device'
import InputMIDI2Native from '../../../packages/audiobus/io/inputs/input-midi2-native-device'
import InputProfiledMidiDevice from '../../../packages/audiobus/io/inputs/input-profiled-midi-device'
import { startKnownMidiInputs, type MidiInputDiscovery } from '../../../packages/audiobus/io/known-midi-inputs'
import { createInputById } from '../../../packages/audiobus/io/input-factory'
import { deviceDefinition, deviceId } from '../../../packages/audiobus/io/device-definition'
import { restoreDevice } from '../../../packages/audiobus/io/workspace-devices'
import { MIDI_DEVICE_PROFILES, matchMidiDeviceProfile, isMidiProfilePortClaimed } from '../../../packages/audiobus/midi/device-profiles'
import { INPUT_EVENT, EVENT_CONNECTED, EVENT_DISCONNECTED, EVENT_INPUT, EVENT_CHANGE } from '../../../packages/audiobus/event-constants'
import { CONTROL_CHANGE, NOTE_OFF, NOTE_ON } from '../../../packages/audiobus/commands'
import { domMidiTargets } from '../source/services/midi-control-panel'

const midi = vi.hoisted(() => ({ inputs: [] as any[], enable: vi.fn(async () => {}), addListener: vi.fn(), removeListener: vi.fn() }))
vi.mock('../../../packages/audiobus/node_modules/webmidi/dist/esm/webmidi.esm.js', () => ({ WebMidi: midi }))

function port(id: string, name = id) {
    const callbacks = new Set<(event: any) => void>()
    return { id, name, manufacturer: '', type: 'input', state: 'connected',
        addListener: vi.fn((_type: string, callback: (event: any) => void) => callbacks.add(callback)),
        removeListener: vi.fn((_type: string, callback: (event: any) => void) => callbacks.delete(callback)),
        send(data: number[]) { const event = { message: { data } }; callbacks.forEach(callback => callback(event)) }
    }
}
const stops: MidiInputDiscovery[] = []
const managers: IOChainManager[] = []
const inputs: { destroy(): any }[] = []
function workspace() {
    const timer = { now: 1, BPM: 120 } as any
    const manager = new IOChainManager({ timer, outputMixer: {} as any })
    const chain = new IOChain(timer)
    manager.addChain(chain)
    managers.push(manager)
    return { manager, chain }
}
async function start(manager: IOChainManager) { const stop = await startKnownMidiInputs(manager); stops.push(stop); return stop }
async function refresh() {
    await vi.advanceTimersByTimeAsync(2000)
    // Runtime JSON loading also completes filesystem/network work outside the
    // fake timer queue. Await the discovery owner before simulating another plug.
    await Promise.all(midi.addListener.mock.calls.filter(call => call[0] === EVENT_CONNECTED)
        .map(([, listener]) => listener({ type: EVENT_CONNECTED })))
    await Promise.all(stops.map(stop => stop.refresh()))
}

beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    midi.inputs = []
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: vi.fn() })
})
afterEach(async () => {
    for (const stop of stops.splice(0)) await stop()
    for (const input of inputs.splice(0)) await input.destroy()
    for (const manager of managers.splice(0)) manager.destroy()
    document.body.replaceChildren()
    delete (navigator as any).requestMIDIAccess
    delete (window as any).electronAPI
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe('known MIDI instrument profiles', () => {
    it('matches constant IDs before exact name aliases without claiming unrelated ports', () => {
        expect(matchMidiDeviceProfile({ id: 'arcana-strum', name: 'CMPSR' })).toBe('arcana-strum')
        expect(matchMidiDeviceProfile({ id: 'digit-cmpsr' })).toBe('digit-cmpsr')
        expect(matchMidiDeviceProfile({ id: 'opaque', name: 'Cmpsr' })).toBe('digit-cmpsr')
        expect(matchMidiDeviceProfile({ id: 'unknown', name: 'CMPSR virtual copy' })).toBeUndefined()
        expect(MIDI_DEVICE_PROFILES['arcana-strum'].controls).toEqual([])
        expect(MIDI_DEVICE_PROFILES['digit-cmpsr'].controls.map(control => control.cc)).toEqual([102, 111, 112, 113, 114, 115, 116, 117, 118])
    })
    it('adds one Input per port, uses profiles when recognised and keeps All devices listeners receiving every port', async () => {
        const arcana = port('arcana-strum'), cmpsr = port('digit-cmpsr'), other = port('keyboard')
        midi.inputs = [arcana, cmpsr, other]
        const { manager, chain } = workspace()
        const generic = new InputWebMIDIDevice()
        inputs.push(generic)
        const genericDispatch = vi.spyOn(generic, 'dispatch')
        await generic.connect()
        await start(manager)
        expect(chain.inputs.map(input => input.name)).toEqual(['Arcana Strum', 'DIGIT CMPSR', 'keyboard'])
        const strum = chain.inputs[0] as InputProfiledMidiDevice
        const joystick = chain.inputs[1] as InputProfiledMidiDevice
        const strumDispatch = vi.spyOn(strum, 'dispatch'), joystickDispatch = vi.spyOn(joystick, 'dispatch')
        arcana.send([0x90, 60, 100]); cmpsr.send([0xb1, 112, 83]); other.send([0x90, 70, 99])
        expect(strumDispatch).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: NOTE_ON, number: 60, from: 'arcana-strum' }), expect.any(Object))
        expect(joystickDispatch).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: CONTROL_CHANGE, number: 112, value: 83, channel: 2, from: 'digit-cmpsr' }), expect.any(Object))
        expect(genericDispatch).toHaveBeenCalledTimes(3)
        expect(genericDispatch).toHaveBeenLastCalledWith(expect.objectContaining({ number: 70 }), expect.any(Object))
        await refresh()
        expect(chain.inputs).toHaveLength(3)
    })
    it('removes unplugged nodes and restores their saved identities and settings on reconnect', async () => {
        const arcana = port('arcana-strum')
        midi.inputs = [arcana]
        const { manager, chain } = workspace()
        await start(manager)
        const input = chain.inputs[0] as InputProfiledMidiDevice
        const id = deviceId(input), dispatch = vi.spyOn(input, 'dispatch')
        arcana.send([0x90, 64, 100])
        midi.inputs = []
        await refresh()
        expect(input.isConnected).toBe(false)
        expect(chain.inputs).toHaveLength(0)
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: NOTE_OFF, number: 64 }), expect.any(Object))
        expect(isMidiProfilePortClaimed('webmidi', arcana.id)).toBe(false)
        midi.inputs = [port('arcana-strum')]
        await refresh()
        expect(chain.inputs).toHaveLength(1)
        expect(chain.inputs[0]).not.toBe(input)
        expect(deviceId(chain.inputs[0])).toBe(id)
        expect(chain.inputs[0].isConnected).toBe(true)
        const definition = deviceDefinition(chain.inputs[0])
        expect(definition).toMatchObject({ factory: 'input', type: 'arcana-strum', options: { profileId: 'arcana-strum', deviceId: 'arcana-strum' } })
        const restored = await restoreDevice({ id, direction: 'input', definition }, { outputMixer: {} as any, now: () => 0 }, new Map())
        inputs.push(restored)
        expect(restored).toBeInstanceOf(InputProfiledMidiDevice)
        expect(deviceId(restored)).toBe(id)
        expect(restored.options.deviceId).toBe('arcana-strum')
    })
    it('honours manual disconnect and removal until a physical reconnect', async () => {
        midi.inputs = [port('digit-cmpsr')]
        const { manager, chain } = workspace()
        await start(manager)
        const input = chain.inputs[0] as InputProfiledMidiDevice
        await input.disconnect()
        await refresh()
        expect(input.isConnected).toBe(false)
        chain.removeInput(input)
        await refresh()
        expect(chain.inputs).toHaveLength(0)
        midi.inputs = []; await refresh()
        midi.inputs = [port('digit-cmpsr')]; await refresh()
        expect(chain.inputs).toHaveLength(1)
        expect(chain.inputs[0]).not.toBe(input)
    })
    it('updates documented CC controls without echo and sends slider performance into the chain', async () => {
        const device = port('digit-cmpsr')
        midi.inputs = [device]
        const input = await createInputById('digit-cmpsr', { now: () => 4 }) as InputProfiledMidiDevice
        inputs.push(input)
        await input.connect()
        const gui = await input.createGui()
        document.body.append(gui)
        const slider = gui.querySelector<HTMLInputElement>('[data-midi-control="up-right"]')!
        const events: any[] = []
        input.addEventListener(INPUT_EVENT, event => events.push((event as any).command))
        device.send([0xb2, 112, 89])
        expect(slider.value).toBe('89')
        expect(events).toHaveLength(1)
        expect(domMidiTargets(document).some(target => target.label.includes('Up-right'))).toBe(false)
        const selects = gui.querySelectorAll('select')
        selects[0].value = '3'; selects[0].dispatchEvent(new Event(EVENT_CHANGE))
        await input.connect()
        slider.value = '123'; slider.dispatchEvent(new Event(EVENT_INPUT))
        expect(events.at(-1)).toMatchObject({ type: CONTROL_CHANGE, number: 112, value: 123, channel: 3, from: 'digit-cmpsr' })
        selects[1].value = 'green'; selects[1].dispatchEvent(new Event(EVENT_CHANGE))
        expect(slider.closest('label')!.hidden).toBe(true)
        expect(gui.querySelector<HTMLInputElement>('[data-midi-control="up"]')!.closest('label')!.hidden).toBe(false)
    })
    it('shows Arcana controls as physical guidance without inventing CC commands', async () => {
        const input = await createInputById('arcana-strum', {}) as InputProfiledMidiDevice
        inputs.push(input)
        const gui = await input.createGui()
        expect(gui.querySelector('img')?.alt.toLowerCase()).toContain('strum')
        expect(gui.querySelector('img')?.getAttribute('src')).toContain('/midi-devices/arcana-strum/panel.svg')
        expect(gui.querySelectorAll('input[type="range"]')).toHaveLength(0)
        expect(gui.textContent).toContain('do not specify CC or SysEx')
        expect(gui.textContent).toContain('Septachords')
        await input.connect()
        expect(input.isConnected).toBe(false)
    })
    it('uses hotplug listeners and cleans up subscriptions', async () => {
        const { manager } = workspace()
        const stop = await start(manager)
        expect(midi.addListener.mock.calls.map(call => call[0])).toContain(EVENT_CONNECTED)
        expect(midi.addListener.mock.calls.map(call => call[0])).toContain(EVENT_DISCONNECTED)
        await stop()
        expect(midi.removeListener.mock.calls.map(call => call[0])).toContain(EVENT_CONNECTED)
    })
    it('supports two identical devices independently without binding the second to the first', async () => {
        const a = port('cmpsr-a', 'CMPSR'), b = port('cmpsr-b', 'CMPSR')
        midi.inputs = [a, b]
        const { manager, chain } = workspace()
        await start(manager)
        expect(chain.inputs).toHaveLength(2)
        const first = vi.spyOn(chain.inputs[0], 'dispatch'), second = vi.spyOn(chain.inputs[1], 'dispatch')
        b.send([0xb0, 118, 76])
        expect(first).not.toHaveBeenCalled()
        expect(second).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ number: 118, value: 76, from: 'cmpsr-b' }), expect.any(Object))
    })
    it('uses native fallback, suppresses native duplicates and reconnects a stable ID with a changed index', async () => {
        delete (navigator as any).requestMIDIAccess
        let devices = [{ index: 3, id: 'digit-cmpsr', name: 'CMPSR' }]
        const callbacks = new Set<(index: number, words: number[]) => void>()
        const bridge = {
            getUmpInputs: vi.fn(async () => devices),
            getCapabilities: vi.fn(async () => ({ perNoteCC: false })),
            onUmpInput: vi.fn((callback: (index: number, words: number[]) => void) => { callbacks.add(callback); return () => callbacks.delete(callback) }),
            openUmpInput: vi.fn(async () => {}), closeUmpInput: vi.fn(async () => {})
        }
        Object.defineProperty(window, 'electronAPI', { configurable: true, value: { midi2: bridge } })
        const { manager, chain } = workspace()
        const generic = new InputMIDI2Native()
        inputs.push(generic)
        await generic.connect()
        await start(manager)
        const input = chain.inputs[0] as InputProfiledMidiDevice
        expect(input.options).toMatchObject({ transport: 'midi2-native', deviceId: 'digit-cmpsr' })
        const dispatch = vi.spyOn(input, 'dispatch'), genericDispatch = vi.spyOn(generic, 'dispatch')
        callbacks.forEach(callback => callback(3, [0x20b06f40]))
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: CONTROL_CHANGE, number: 111, value: 64, from: 'digit-cmpsr' }), expect.any(Object))
        expect(genericDispatch).not.toHaveBeenCalled()
        devices = [{ index: 8, id: 'digit-cmpsr', name: 'CMPSR' }]
        await refresh()
        expect(chain.inputs).toEqual([input])
        expect(bridge.closeUmpInput).toHaveBeenCalledWith(3)
        expect(bridge.openUmpInput).toHaveBeenCalledWith(8)
        expect(isMidiProfilePortClaimed('midi2-native', '3')).toBe(false)
        expect(isMidiProfilePortClaimed('midi2-native', '8')).toBe(true)
        dispatch.mockClear()
        callbacks.forEach(callback => callback(8, [0x20b06f60]))
        expect(dispatch).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ from: 'digit-cmpsr', value: 96 }), expect.any(Object))
    })
})
