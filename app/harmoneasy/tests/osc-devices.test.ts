// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeOSC, decodeOSC, oscToCommand, commandToOSC } from '../../../packages/audiobus/io/osc'
import { OscConnection } from '../../../packages/audiobus/io/osc-connection'
import InputOSC from '../../../packages/audiobus/io/inputs/input-osc'
import OutputOSC from '../../../packages/audiobus/io/outputs/output-osc'
import { INPUT_EVENT } from '../../../packages/audiobus/event-constants'
import { NOTE_OFF, NOTE_ON, CONTROL_CHANGE, PITCH_BEND } from '../../../packages/audiobus/commands'
import { musicalCommand } from '../../../packages/audiobus/io/event-clip'

class FakeSocket extends EventTarget {
    static OPEN = 1
    static instances: FakeSocket[] = []
    readyState = 0
    bufferedAmount = 0
    binaryType = ''
    send = vi.fn()
    constructor(readonly url: string) { super(); FakeSocket.instances.push(this) }
    open() { this.readyState = 1; this.dispatchEvent(new Event('open')) }
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')) }
    receive(bytes: Uint8Array) { this.dispatchEvent(new MessageEvent('message', { data: bytes.buffer })) }
}
const devices: Array<{ destroy(): void }> = []
afterEach(() => { devices.splice(0).forEach(device => device.destroy()); FakeSocket.instances = []; vi.unstubAllGlobals(); vi.useRealTimers() })

describe('OSC encoding and musical mappings', () => {
    it('matches the wire format and roundtrips integers, floats and UTF-8 strings', () => {
        expect([...encodeOSC({ address: '/foo', args: [42] })]).toEqual([47, 102, 111, 111, 0, 0, 0, 0, 44, 105, 0, 0, 0, 0, 0, 42])
        const message = { address: '/test', args: [4, -2, 0.5, 'café'] }
        expect(decodeOSC(encodeOSC(message))).toEqual([message])
    })
    it('decodes ordered bundles and rejects malformed packets and excessive nesting', () => {
        const first = encodeOSC({ address: '/a', args: [1] }), second = encodeOSC({ address: '/b', args: [2] })
        const packet = new Uint8Array(16 + 4 + first.length + 4 + second.length)
        packet.set(new TextEncoder().encode('#bundle')); packet[15] = 1
        const view = new DataView(packet.buffer); view.setInt32(16, first.length); packet.set(first, 20)
        view.setInt32(20 + first.length, second.length); packet.set(second, 24 + first.length)
        expect(decodeOSC(packet).map(message => message.address)).toEqual(['/a', '/b'])
        view.setInt32(16, 9999); expect(() => decodeOSC(packet)).toThrow()
        expect(() => decodeOSC(new Uint8Array([47, 97, 0]))).toThrow()
        expect(() => decodeOSC(first, 9)).toThrow()
        expect(() => decodeOSC(new Uint8Array([47, 97, 0, 0, 44, 98, 0, 0]))).toThrow()
    })
    it.each([
        musicalCommand({ type: NOTE_ON, number: 60, velocity: 100, channel: 3 }),
        musicalCommand({ type: NOTE_OFF, number: 60, velocity: 0, channel: 3 }),
        musicalCommand({ type: CONTROL_CHANGE, number: 64, value: 127, channel: 3 }),
        musicalCommand({ type: PITCH_BEND, number: 0, value: 8192, channel: 3 }),
    ])('preserves MIDI mappings for $type', command => {
        const message = commandToOSC(command, '/music')!
        expect(oscToCommand(message, '/music', 10, 'test')).toMatchObject({ type: command.type, number: command.number, channel: 3, startAt: 10, from: 'test' })
        expect(oscToCommand(message, '/other', 0, 'test')).toBeUndefined()
    })
    it('rejects out-of-range values before they can become musical commands', () => {
        expect(() => oscToCommand({ address: '/m/note/on', args: [128, 100, 1] }, '/m', 0, '')).toThrow()
        expect(() => oscToCommand({ address: '/m/cc', args: [64, 128, 1] }, '/m', 0, '')).toThrow()
        expect(() => encodeOSC({ address: '/x', args: [NaN] })).toThrow()
    })
})

describe('OSC device lifecycle', () => {
    it('releases received notes and sustain after bridge loss', async () => {
        vi.stubGlobal('WebSocket', FakeSocket)
        const input = new InputOSC({ now: () => 5 }), receive = vi.fn(); devices.push(input)
        input.addEventListener(INPUT_EVENT, event => receive((event as any).command))
        const pending = input.connect(), socket = FakeSocket.instances.at(-1)!
        socket.open(); await pending
        socket.receive(encodeOSC({ address: '/harmoneasy/note/on', args: [60, 100, 2] }))
        socket.receive(encodeOSC({ address: '/harmoneasy/cc', args: [64, 127, 2] }))
        expect(receive).toHaveBeenCalledTimes(2)
        socket.close()
        expect(input.isConnected).toBe(false)
        expect(receive.mock.calls.slice(-2).map(([command]) => [command.type, command.number, command.value])).toEqual([[NOTE_OFF, 60, 0], [CONTROL_CHANGE, 64, 0]])
    })
    it('sends binary musical messages and cleanup before closing its bridge', async () => {
        vi.stubGlobal('WebSocket', FakeSocket)
        const output = new OutputOSC(); devices.push(output)
        const pending = output.connect(), socket = FakeSocket.instances.at(-1)!
        socket.open(); await pending
        output.sendCommand(musicalCommand({ type: NOTE_ON, number: 64, velocity: 80, channel: 4 }))
        await output.disconnect()
        expect(socket.send.mock.calls.map(([bytes]) => decodeOSC(bytes)[0])).toEqual([
            { address: '/harmoneasy/note/on', args: [64, 80, 4] }, { address: '/harmoneasy/note/off', args: [64, 4] },
        ])
        expect(output.isConnected).toBe(false)
    })
    it('rejects failed or cancelled handshakes and clears their timeout', async () => {
        vi.useFakeTimers(); vi.stubGlobal('WebSocket', FakeSocket)
        const closed = vi.fn(), connection = new OscConnection(vi.fn(), closed, vi.fn())
        const pending = connection.connect('ws://localhost:8080')
        const rejection = expect(pending).rejects.toThrow('disconnected')
        connection.disconnect(); await rejection
        expect(closed).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0)
        expect(() => connection.connect('https://localhost')).toThrow()
    })
})
