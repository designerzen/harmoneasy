import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import InputWebMIDIDevice from '../../../packages/audiobus/io/inputs/input-webmidi-device'
import OutputWebMIDIDevice from '../../../packages/audiobus/io/outputs/output-webmidi-device'
import OutputManager from '../../../packages/audiobus/io/output-manager'
import IOChain from '../../../packages/audiobus/io/IO-chain'
import { midiToCommand, commandToMidi } from '../../../packages/audiobus/midi/midi-command-conversion'
import { BleMidiDecoder } from '../../../packages/audiobus/midi/midi-ble/ble-midi-decoder'
import { NOTE_ON, NOTE_OFF } from '../../../packages/audiobus/commands'

const midi = vi.hoisted(() => ({ inputs: [] as any[], outputs: [] as any[], enable: vi.fn(async () => {}), addListener: vi.fn(), removeListener: vi.fn() }))
vi.mock('../../../packages/audiobus/node_modules/webmidi/dist/esm/webmidi.esm.js', () => ({ WebMidi: midi }))
class Element {
    style = {}; children: Element[] = []; value = ''; textContent = ''; onchange?: () => void
    append(...items: Element[]) { this.children.push(...items) }
    replaceChildren(...items: Element[]) { this.children = items }
    remove() {}
}
beforeEach(() => {
    vi.clearAllMocks()
    midi.inputs = []
    midi.outputs = ['synth-a', 'synth-b'].map(id => ({ id, name: id, type: 'output', send: vi.fn() }))
    vi.stubGlobal('document', { createElement: () => new Element() })
})
afterEach(() => vi.unstubAllGlobals())
const command = (bytes: number[]) => midiToCommand(bytes, 0, 'keyboard')!
const pause = () => new Promise(resolve => setTimeout(resolve, 20))

describe('MIDI device routing', () => {
    it('routes an input device on channel 2 through a transformed chain to a different device on channel 5', async () => {
        const listeners = new Set<(event: any) => void>()
        const device = { id: 'keyboard', name: 'Keyboard', type: 'input',
            addListener: (_: string, listener: any) => listeners.add(listener),
            removeListener: (_: string, listener: any) => listeners.delete(listener) }
        midi.inputs = [device]
        const input = new InputWebMIDIDevice({ selectedDevice: 'keyboard', selectedChannel: 2, now: () => 0 })
        const output = new OutputWebMIDIDevice({ selectedDevice: 'synth-b', selectedChannel: 5 })
        const chain = new IOChain({ now: 0, BPM: 120, isRunning: true, start() {}, stop() {} } as any)
        chain.setTransformers([])
        vi.spyOn(chain.transformerManager, 'transform').mockImplementation(async commands => commands.map(c => ({ ...c, number: c.number + 12 })))
        chain.addInput(input)
        chain.addOutput(output)
        await input.connect(); await output.connect()
        const send = async (bytes: number[]) => {
            for (const listener of listeners) listener({ message: { data: bytes } })
            await pause()
            await chain.triggerAudioCommandsOnDevice(chain.executeQueueAndClearComplete(1))
            await OutputManager.settled(output)
        }
        await send([0x90, 60, 110]) // wrong input channel
        expect(midi.outputs[1].send).not.toHaveBeenCalled()
        await send([0x91, 60, 110])
        expect(midi.outputs[1].send).toHaveBeenLastCalledWith([0x94, 72, 110])
        await send([0xb1, 64, 127]) // controller is not transposed
        expect(midi.outputs[1].send).toHaveBeenLastCalledWith([0xb4, 64, 127])
        await send([0x81, 60, 45])
        expect(midi.outputs[1].send).toHaveBeenLastCalledWith([0x84, 72, 45])
        expect(midi.outputs[0].send).not.toHaveBeenCalled()
        chain.destroy(); await input.destroy(); await output.destroy()
    })

    it('forwards every MIDI 1 message family with channel remapping and unchanged system data', async () => {
        const output = new OutputWebMIDIDevice({ selectedDevice: 'synth-b', selectedChannel: 16 })
        const manager = new OutputManager(); manager.add(output); await output.connect()
        const messages = [[0x91, 60, 1], [0xa1, 60, 77], [0xb1, 1, 99], [0xc1, 12], [0xd1, 88],
            [0xe1, 1, 127], [0x81, 60, 42], [0xf1, 1], [0xf2, 3, 4], [0xf3, 5], [0xf6],
            [0xf8], [0xfa], [0xfb], [0xfc], [0xfe], [0xff], [0xf0, 0x7d, 1, 2, 0xf7]]
        for (const bytes of messages) await manager.triggerAudioCommandOnDevice(command(bytes), output)
        expect(midi.outputs[1].send.mock.calls.map(([bytes]) => bytes)).toEqual(messages.map(bytes => bytes[0] < 0xf0 ? [(bytes[0] & 0xf0) | 15, ...bytes.slice(1)] : bytes))
        expect(midi.outputs[0].send).not.toHaveBeenCalled()
        manager.destroy(); await output.destroy()
    })

    it('keeps same-pitch notes on incoming channels independent and supports All output devices/channels', async () => {
        const output = new OutputWebMIDIDevice({ selectedDevice: 'synth-a', selectedChannel: -1 })
        const manager = new OutputManager(); manager.add(output); await output.connect()
        for (const bytes of [[0x90, 60, 100], [0x91, 60, 100], [0x80, 60, 0], [0x81, 60, 0]]) {
            await manager.triggerAudioCommandOnDevice(command(bytes), output)
        }
        expect(midi.outputs[0].send.mock.calls.map(([bytes]) => bytes[0])).toEqual([0x90, 0x91, 0x80, 0x81])
        output.setOutput(''); output.setChannel(0)
        midi.outputs.forEach(device => device.send.mockClear())
        await manager.triggerAudioCommandOnDevice(command([0xb0, 7, 80]), output)
        expect(midi.outputs[0].send).toHaveBeenCalledTimes(16)
        expect(midi.outputs[1].send).toHaveBeenCalledTimes(16)
        await manager.triggerAudioCommandOnDevice(command([0xf8]), output)
        expect(midi.outputs[0].send).toHaveBeenCalledTimes(17)
        manager.destroy(); await output.destroy()
    })

    it('releases notes and sustain at the old destination when the GUI changes, and persists selections', async () => {
        const output = new OutputWebMIDIDevice({ selectedDevice: 'synth-a', selectedChannel: 2 })
        const manager = new OutputManager(); manager.add(output); await output.connect()
        await manager.triggerAudioCommandOnDevice(command([0x90, 60, 100]), output)
        await manager.triggerAudioCommandOnDevice(command([0xb0, 64, 127]), output)
        const gui = await output.createGui() as unknown as Element
        const device = gui.children[0].children[0], channel = gui.children[1].children[0]
        device.value = 'synth-b'; device.onchange!()
        channel.value = '5'; channel.onchange!()
        await manager.triggerAudioCommandOnDevice(command([0x90, 60, 90]), output)
        expect(midi.outputs[0].send).toHaveBeenCalledWith([0x81, 60, 0])
        expect(midi.outputs[0].send).toHaveBeenCalledWith([0xb1, 64, 0])
        expect(midi.outputs[1].send).toHaveBeenLastCalledWith([0x94, 60, 90])
        const restored = new OutputWebMIDIDevice(JSON.parse(JSON.stringify(output.options)))
        expect(restored.options.selectedDevice).toBe('synth-b')
        expect(restored.options.selectedChannel).toBe(5)
        output.setOutput('synth-a'); output.setChannel(2)
        await manager.triggerAudioCommandOnDevice(command([0x90, 60, 70]), output)
        expect(midi.outputs[0].send).toHaveBeenLastCalledWith([0x91, 60, 70])
        manager.destroy(); await output.destroy()
    })

    it('does not substitute another output after unplugging the selected one', async () => {
        const output = new OutputWebMIDIDevice({ selectedDevice: 'synth-b', selectedChannel: 1 })
        await output.connect()
        const selected = midi.outputs.pop()
        await output.noteOn(60)
        expect(midi.outputs[0].send).not.toHaveBeenCalled()
        midi.outputs.push(selected)
        await output.noteOn(60)
        expect(selected.send).toHaveBeenCalledWith([0x90, 60, 127])
        await output.destroy()
    })

    it('decodes batched BLE messages, running status, offset views and continued SysEx', () => {
        const decoder = new BleMidiDecoder()
        const packet = new Uint8Array([0, 0x80, 0x81, 0x91, 60, 100, 61, 90, 0x82, 0xc1, 7, 0])
        expect(decoder.decode(new DataView(packet.buffer, 1, packet.length - 2))).toEqual([[0x91, 60, 100], [0x91, 61, 90], [0xc1, 7]])
        expect(decoder.decode(new DataView(Uint8Array.from([0x80, 0x81, 0xf0, 0x7d, 1]).buffer))).toEqual([])
        expect(decoder.decode(new DataView(Uint8Array.from([0x80, 2, 3, 0x82, 0xf7]).buffer))).toEqual([[0xf0, 0x7d, 1, 2, 3, 0xf7]])
        expect(decoder.decode(new DataView(Uint8Array.from([0x80, 0x81, 0xf0, 0x7d, 0xf9, 0xf7]).buffer))).toEqual([[0xf0, 0x7d, 0xf7]])
        expect(decoder.decode(new DataView(Uint8Array.from([0x80, 0x81, 0x90, 60, 0x82, 0xf8, 100]).buffer))).toEqual([[0xf8], [0x90, 60, 100]])
        expect(command([0x90, 60, 0]).type).toBe(NOTE_OFF)
        const transformed = { ...command([0x90, 60, 90]), number: 72, type: NOTE_ON }
        expect(commandToMidi(transformed)).toEqual([0x90, 72, 90])
    })
})
