// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import InputWebMIDIDevice from '../../../packages/audiobus/io/inputs/input-webmidi-device'
import OutputWebMIDIDevice from '../../../packages/audiobus/io/outputs/output-webmidi-device'
import InputMIDITransportClock from '../../../packages/audiobus/io/inputs/input-midi-transport-clock'
import IOChain from '../../../packages/audiobus/io/IO-chain'
import IOChainManager from '../../../packages/audiobus/io/IO-chain-manager'
import { deviceId } from '../../../packages/audiobus/io/device-definition'
import { sharedWebMidi } from '../../../packages/audiobus/midi/shared-webmidi'
import { createInputById } from '../../../packages/audiobus/io/input-factory'
import { createOutputById } from '../../../packages/audiobus/io/output-factory'
import { startKnownMidiInputs, type MidiInputDiscovery } from '../../../packages/audiobus/midi/hardware/known-midi-inputs'
import { UNAVAILABLE_MIDI_DEVICE } from '../../../packages/audiobus/io/inputs/midi-input-controls'
import { EVENT_CONNECTED, EVENT_DISCONNECTED, EVENT_CHANGE, INPUT_EVENT } from '../../../packages/audiobus/event-constants'
import { NOTE_OFF } from '../../../packages/audiobus/commands'
import { showMidiDeviceDisconnected } from '../source/services/midi-device-errors'

const midi = vi.hoisted(() => ({ inputs: [] as any[], outputs: [] as any[], enable: vi.fn(async () => {}),
    addListener: vi.fn(), removeListener: vi.fn(), callbacks: new Map<string, Set<(event: any) => void>>() }))
vi.mock('../../../packages/audiobus/node_modules/webmidi/dist/esm/webmidi.esm.js', () => ({ WebMidi: midi }))
function port(id: string, name = id) {
    const callbacks = new Set<(event: any) => void>()
    return { id, name, type: 'input', state: 'connected', manufacturer: 'Test', close: vi.fn(), destroy: vi.fn(),
        addListener: vi.fn((_type: string, callback: (event: any) => void) => callbacks.add(callback)),
        removeListener: vi.fn((_type: string, callback: (event: any) => void) => callbacks.delete(callback)),
        send(data: number[]) { const message = { message: { data } }; for (const callback of callbacks) callback(message) }
    }
}
const emit = (type: string, device: any) => { for (const listener of [...midi.callbacks.get(type) ?? []]) listener({ type, port: device }) }
const resources: { destroy(): any }[] = []
const managers: IOChainManager[] = []
const discoveries: MidiInputDiscovery[] = []
function workspace() {
    const timer = { now: 1, BPM: 120 } as any
    const manager = new IOChainManager({ timer, outputMixer: {} as any })
    const chain = new IOChain(timer); chain.setTransformers([])
    const chainId = manager.addChain(chain)
    managers.push(manager)
    return { manager, chain, chainId }
}
beforeEach(() => {
    vi.clearAllMocks(); midi.callbacks.clear(); midi.inputs = []; midi.outputs = []
    midi.addListener.mockImplementation((type, callback) => { const set = midi.callbacks.get(type) ?? new Set(); set.add(callback); midi.callbacks.set(type, set) })
    midi.removeListener.mockImplementation((type, callback) => midi.callbacks.get(type)?.delete(callback))
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: vi.fn() })
})
afterEach(async () => {
    for (const stop of discoveries.splice(0)) await stop()
    const all = new Set([...resources.splice(0), ...managers.flatMap(manager => manager.devices.map(entry => entry.device))])
    for (const resource of all) await resource.destroy?.()
    for (const manager of managers.splice(0)) manager.destroy()
    delete (navigator as any).requestMIDIAccess
    document.body.replaceChildren()
})

describe('shared WebMIDI access', () => {
    it('previews the selected WebMIDI Input and Output using raw port names without sending MIDI', async () => {
        const inputPort = port('input-opaque-id', 'MiniLab 3'); inputPort.manufacturer = 'Arturia'
        const outputPort = { id: 'output-opaque-id', name: 'reface CS', manufacturer: 'Yamaha', type: 'output', send: vi.fn() }
        midi.inputs = [inputPort]; midi.outputs = [outputPort]
        const input = new InputWebMIDIDevice(), output = new OutputWebMIDIDevice({ selectedDevice: outputPort.id })
        resources.push(input, output)
        const receive = vi.spyOn(input, 'dispatch')
        await Promise.all([input.connect(), output.connect()])
        const inputGui = await input.createGui(), outputGui = await output.createGui()
        const select = inputGui.querySelector('select')!
        select.value = inputPort.id; select.dispatchEvent(new Event(EVENT_CHANGE))
        expect(inputGui.querySelector<HTMLElement>('[data-midi-profile]')!.dataset.midiProfile).toBe('arturia-minilab-3')
        expect(outputGui.querySelector<HTMLElement>('[data-midi-profile]')!.dataset.midiProfile).toBe('yamaha-reface-cs')
        expect(outputPort.send).not.toHaveBeenCalled()
        expect(receive).not.toHaveBeenCalled()
        output.setOutput('')
        expect(outputGui.querySelector('figure')).toBeNull()
    })
    it('automatically readies Output selectors and routing before and after global permission without a separate connect action', async () => {
        const before = await createOutputById('webmidi', { selectedDevice: 'synth', selectedChannel: 5 }) as OutputWebMIDIDevice
        const removed = await createOutputById('webmidi') as OutputWebMIDIDevice
        resources.push(before, removed)
        expect(before.requiresConnectionControl).toBe(false)
        expect(midi.enable).not.toHaveBeenCalled()
        const gui = await before.createGui()
        await removed.destroy()
        const synth = { id: 'synth', name: 'Synth', type: 'output', send: vi.fn() }
        midi.outputs = [synth]
        const release = await sharedWebMidi.acquire()
        try {
            await vi.waitFor(() => expect(before.isConnected).toBe(true))
            expect(removed.isConnected).toBe(false)
            expect([...gui.querySelector('select')!.options].map(option => option.value)).toContain('synth')
            const after = await createOutputById('webmidi', { selectedDevice: 'synth' }) as OutputWebMIDIDevice
            resources.push(after)
            await vi.waitFor(() => expect(after.isConnected).toBe(true))
            await before.noteOn(60, 100, 2)
            expect(synth.send).toHaveBeenCalledWith([0x94, 60, 100])
            await before.destroy()
            expect(synth.send).toHaveBeenCalledWith([0x84, 60, 0])
            await after.noteOn(64, 90, 3)
            expect(synth.send).toHaveBeenCalledWith([0x92, 64, 90])
            midi.outputs = []; emit(EVENT_DISCONNECTED, synth)
            expect(after.outputDevices).toEqual([])
            midi.outputs = [synth]; emit(EVENT_CONNECTED, synth)
            await after.noteOff(64, 3)
            expect(synth.send).toHaveBeenLastCalledWith([0x82, 64, 0])
            expect(midi.enable).toHaveBeenCalledTimes(1)
        } finally { release() }
    })
    it('automatically routes generic Inputs created before and after global permission without requesting permission during creation', async () => {
        const before = await createInputById('webmidi') as InputWebMIDIDevice
        resources.push(before)
        expect(midi.enable).not.toHaveBeenCalled()
        expect(before.isEnabled).toBe(false)
        expect(before.requiresConnectionControl).toBe(false)

        // Readiness must also be announced when permission is granted with no ports.
        const release = await sharedWebMidi.acquire()
        try {
            await vi.waitFor(() => expect(before.isEnabled).toBe(true))
            const after = await createInputById('webmidi') as InputWebMIDIDevice
            resources.push(after)
            await vi.waitFor(() => expect(after.isEnabled).toBe(true))
            const device = port('plugged-in-later')
            midi.inputs = [device]; emit(EVENT_CONNECTED, device)
            const first = vi.fn(), second = vi.fn()
            before.addEventListener(INPUT_EVENT, first); after.addEventListener(INPUT_EVENT, second)
            device.send([0x90, 60, 100])
            expect(first).toHaveBeenCalledTimes(1)
            expect(second).toHaveBeenCalledTimes(1)
            expect(midi.enable).toHaveBeenCalledTimes(1)
            await after.destroy()
            second.mockClear()
            device.send([0x80, 60, 0])
            expect(first).toHaveBeenCalledTimes(2)
            expect(second).not.toHaveBeenCalled()
        } finally { release() }
    })
    it('enables once with one listener per port for concurrent inputs, clock inputs and outputs', async () => {
        const device = port('keyboard'); midi.inputs = [device]
        midi.outputs = [{ id: 'synth', name: 'Synth', type: 'output', send: vi.fn() }]
        const a = new InputWebMIDIDevice(), b = new InputWebMIDIDevice(), clock = new InputMIDITransportClock(), output = new OutputWebMIDIDevice()
        resources.push(a, b, clock, output)
        const receive = vi.spyOn(b, 'dispatch')
        await Promise.all([a.connect(), b.connect(), clock.connect(), output.connect()])
        expect(midi.enable).toHaveBeenCalledTimes(1)
        expect(midi.callbacks.get(EVENT_CONNECTED)?.size).toBe(1)
        expect(midi.callbacks.get(EVENT_DISCONNECTED)?.size).toBe(1)
        expect(device.addListener).toHaveBeenCalledTimes(1)
        await a.destroy()
        device.send([0x90, 60, 100])
        expect(receive).toHaveBeenCalledTimes(1)
        expect(device.removeListener).not.toHaveBeenCalled()
        expect(device.close).not.toHaveBeenCalled()
        await b.destroy(); await clock.destroy(); await output.destroy()
        expect(device.removeListener).toHaveBeenCalledTimes(1)
        expect(midi.callbacks.get(EVENT_CONNECTED)?.size).toBe(0)
    })
    it('offers one device/channel or All, updates activity and removes disconnected choices in every Input', async () => {
        const a = port('a'), b = port('b'); midi.inputs = [a, b]
        const first = new InputWebMIDIDevice({ devices: ['a', 'b'] }), all = new InputWebMIDIDevice()
        resources.push(first, all)
        await Promise.all([first.connect(), all.connect()])
        const gui = await first.createGui(), allGui = await all.createGui()
        const [devices, channels] = gui.querySelectorAll('select')
        expect(devices.multiple).toBe(false)
        expect(channels.multiple).toBe(false)
        expect(first.inputDevices.map(device => device.id)).toEqual(['a'])
        expect([...channels.options].map(option => option.value)).toEqual(Array.from({ length: 17 }, (_, index) => String(index)))
        a.send([0x94, 60, 100])
        expect(sharedWebMidi.observedChannels('a')).toEqual([5])
        expect(channels.options[5].textContent).toContain('activity detected')
        midi.inputs = [b]; emit(EVENT_DISCONNECTED, a)
        expect([...devices.options].some(option => option.value === 'a')).toBe(false)
        expect(devices.value).toBe(UNAVAILABLE_MIDI_DEVICE)
        expect([...allGui.querySelector('select')!.options].some(option => option.value === 'a')).toBe(false)
        expect(all.isConnected).toBe(true)
        const c = port('c'); midi.inputs.push(c); emit(EVENT_CONNECTED, c)
        expect([...devices.options].some(option => option.value === 'c')).toBe(true)
        devices.value = ''; devices.dispatchEvent(new Event(EVENT_CHANGE))
        channels.value = '0'; channels.dispatchEvent(new Event(EVENT_CHANGE))
        expect(first.inputDevices.map(device => device.id)).toEqual(['b', 'c'])
        expect(first.isConnected).toBe(true)
    })
    it('delivers an overlapping All-devices and single-device message once per chain and independently across chains', async () => {
        const device = port('overlap'); midi.inputs = [device]
        const all = new InputWebMIDIDevice(), selected = new InputWebMIDIDevice({ selectedDevice: 'overlap' })
        resources.push(all, selected)
        await Promise.all([all.connect(), selected.connect()])
        const { manager, chain, chainId } = workspace()
        chain.addInput(all); chain.addInput(selected)
        const other = manager.getChain(manager.cloneChain(chainId))!
        const firstQueue = vi.spyOn(chain, 'addCommandToQueue'), secondQueue = vi.spyOn(other, 'addCommandToQueue')
        device.send([0x90, 60, 100])
        expect(firstQueue).toHaveBeenCalledTimes(1)
        expect(secondQueue).toHaveBeenCalledTimes(1)
        device.send([0x90, 64, 100])
        firstQueue.mockClear(); secondQueue.mockClear()
        midi.inputs = []; emit(EVENT_DISCONNECTED, device)
        expect(firstQueue).toHaveBeenCalledTimes(2)
        expect(secondQueue).toHaveBeenCalledTimes(2)
        expect(firstQueue.mock.calls.map(call => call[0].number)).toEqual([60, 64])
    })
    it('removes active device Inputs from all chains, reports one safe dialog, and restores shared routes/channel settings', async () => {
        const device = port('live-controller', 'Controller <b>'); midi.inputs = [device]
        const { manager, chain, chainId } = workspace()
        chain.setName('Live <mix>')
        const ui = { showError: vi.fn() }
        const controller = await startKnownMidiInputs(manager, { onDeviceDisconnected: loss => showMidiDeviceDisconnected(ui, loss) })
        discoveries.push(controller)
        const input = chain.inputs[0] as InputWebMIDIDevice
        input.options.selectedChannel = 3
        const inputId = deviceId(input)
        const other = manager.getChain(manager.cloneChain(chainId))!
        other.setName('Second chain')
        const dispatched = vi.spyOn(input, 'dispatch')
        device.send([0x92, 60, 100]); device.send([0xb2, 64, 127])
        midi.inputs = []; emit(EVENT_DISCONNECTED, device)
        await controller.refresh()
        expect(ui.showError).toHaveBeenCalledTimes(1)
        expect(ui.showError.mock.calls[0][1]).toContain('Controller &lt;b&gt;')
        expect(ui.showError.mock.calls[0][1]).toContain('Live &lt;mix&gt;, Second chain')
        expect(chain.inputs).toHaveLength(0); expect(other.inputs).toHaveLength(0)
        expect(dispatched).toHaveBeenCalledWith(expect.objectContaining({ type: NOTE_OFF, number: 60, channel: 3, from: 'live-controller' }), expect.any(Object))
        emit(EVENT_DISCONNECTED, device)
        expect(ui.showError).toHaveBeenCalledTimes(1)
        midi.inputs = [port('live-controller')]; emit(EVENT_CONNECTED, midi.inputs[0])
        await controller.refresh()
        const restored = chain.inputs[0] as InputWebMIDIDevice
        expect(restored).toBe(other.inputs[0])
        expect(restored).not.toBe(input)
        expect(deviceId(restored)).toBe(inputId)
        expect(restored.options.selectedChannel).toBe(3)
        expect(restored.isConnected).toBe(true)
        await restored.disconnect()
        midi.inputs = []; emit(EVENT_DISCONNECTED, midi.inputs[0] ?? { ...device, id: 'live-controller' })
        await controller.refresh()
        expect(ui.showError).toHaveBeenCalledTimes(1)
        midi.inputs = [port('live-controller')]; emit(EVENT_CONNECTED, midi.inputs[0]); await controller.refresh()
        expect(chain.inputs[0].isConnected).toBe(false)
        await controller.refresh()
        expect(chain.inputs[0].isConnected).toBe(false)
    })
    it('keeps All-device Inputs routed when one device disappears and warns only while listening', async () => {
        const a = port('first'), b = port('second'); midi.inputs = [a, b]
        const all = new InputWebMIDIDevice()
        resources.push(all)
        const { manager, chain } = workspace()
        chain.addInput(all)
        await all.connect()
        const lost = vi.fn()
        const controller = await startKnownMidiInputs(manager, { onDeviceDisconnected: lost })
        discoveries.push(controller)
        midi.inputs = [b]; emit(EVENT_DISCONNECTED, a); await controller.refresh()
        expect(chain.inputs).toContain(all)
        expect(all.isConnected).toBe(true)
        const notes = vi.fn(); all.addEventListener(INPUT_EVENT, notes)
        b.send([0x90, 63, 100])
        expect(notes).toHaveBeenCalledTimes(1)
        expect(lost).toHaveBeenCalledTimes(1)
    })
})
