import { afterEach, describe, expect, it, vi } from 'vitest'
import IOChain from '../../../packages/audiobus/io/IO-chain'
import IOChainManager from '../../../packages/audiobus/io/IO-chain-manager'
import AbstractInput from '../../../packages/audiobus/io/inputs/abstract-input'
import InputAudioEvent from '../../../packages/audiobus/io/events/input-audio-event'
import { NOTE_ON, NOTE_OFF } from '../../../packages/audiobus/commands'
import { EVENT_CHAINS_UPDATED } from '../../../packages/audiobus/event-constants'
import { RoomWorkspace, packRoomCommand, unpackRoomCommand } from '../source/services/room-workspace'

class Input extends AbstractInput { destroy() {} }
const cleanup: Array<() => void> = []
afterEach(() => { for (const destroy of cleanup.splice(0)) destroy(); vi.useRealTimers() })

function machine(id: string, role: 'leader' | 'follower', missingOutput = false) {
    const sink = { uuid: id, name: 'synth', description: '', isConnected: true, isHidden: false,
        noteOn: vi.fn(), noteOff: vi.fn(), allNotesOff: vi.fn() }
    const input = new Input()
    const timer = { now: 0, BPM: 120, position: 0, isRunning: true, start: vi.fn(), stop: vi.fn() } as any
    const manager = new IOChainManager({ timer, outputMixer: {} as GainNode,
        externalDevices: missingOutput ? { input } : { input, sink } })
    if (!missingOutput) {
        const chain = new IOChain(timer)
        chain.setTransformers([])
        chain.addInput(input)
        chain.addOutput(sink)
        manager.addChain(chain, 'shared-chain')
    }
    const links = new Map<string, ReturnType<typeof machine>['connection']>()
    const connection = {
        id, role, clockLocked: true, leaderTimeMs: 0, playbackDelayMs: 0,
        onPeerOpen: undefined as any, onPeerClose: undefined as any, onData: undefined as any, onClockChange: undefined as any,
        sendData: vi.fn((peer: string, message: unknown) => {
            const data = structuredClone(message)
            queueMicrotask(() => links.get(peer)?.onData?.(id, data))
            return true
        }),
        broadcastData(message: unknown) { for (const peer of links.keys()) this.sendData(peer, message) }
    }
    const report = vi.fn()
    const workspace = new RoomWorkspace(connection as any, manager, () => timer.now, report)
    cleanup.push(() => { workspace.destroy(); manager.destroy() })
    return { manager, sink, input, connection, links, workspace, report }
}

function pair(host: ReturnType<typeof machine>, guest: ReturnType<typeof machine>) {
    host.links.set(guest.connection.id, guest.connection)
    guest.links.set(host.connection.id, host.connection)
    guest.connection.onPeerOpen(host.connection.id)
    host.connection.onPeerOpen(guest.connection.id)
}
const joined = async (host: ReturnType<typeof machine>, guest: ReturnType<typeof machine>) => {
    await vi.waitFor(() => expect(guest.report).toHaveBeenCalledWith('Room ready — tempo, notes and workspace are shared.'))
    await vi.waitFor(() => expect(host.report.mock.calls.at(-1)?.[0]).toContain('players sharing'))
}
const note = (type = NOTE_ON) => ({ type, number: 60, velocity: type === NOTE_ON ? 100 : 0, channel: 1,
    value: 0, pitchBend: 0, raw: new Uint8Array(), from: 'keyboard', startAt: 0, time: 0 } as any)

describe('P2P room workspace', () => {
    it('loads the host workspace including disabled endpoints and active-chain selection', async () => {
        const host = machine('host', 'leader'), guest = machine('guest', 'follower')
        host.manager.activeChain!.setInputEnabled(host.input, false)
        host.manager.activeChain!.outputManager.setEnabled(host.sink, false)
        host.manager.cloneChain('shared-chain')
        pair(host, guest)
        await joined(host, guest)
        expect(guest.manager.exportWorkspace()).toBe(host.manager.exportWorkspace())
        expect(guest.manager.getChain('shared-chain')!.inputManager.isEnabled(guest.input)).toBe(false)
        expect(guest.manager.getChain('shared-chain')!.outputManager.isEnabled(guest.sink)).toBe(false)
    })

    it('routes a guest input through the host once and plays the same final notes on all devices without echoes', async () => {
        const host = machine('host', 'leader'), alice = machine('alice', 'follower'), bob = machine('bob', 'follower')
        pair(host, alice)
        await joined(host, alice)
        pair(host, bob)
        await joined(host, bob)
        alice.manager.activeChain!.onInputEvent(new InputAudioEvent(note()))
        expect(alice.sink.noteOn).not.toHaveBeenCalled()
        await vi.waitFor(() => {
            host.manager.updateTime(1, 1)
            expect(host.sink.noteOn).toHaveBeenCalledExactlyOnceWith(60, 100)
        })
        await vi.waitFor(() => expect(bob.sink.noteOn).toHaveBeenCalledExactlyOnceWith(60, 100))
        expect(alice.sink.noteOn).toHaveBeenCalledExactlyOnceWith(60, 100)
        expect(alice.connection.sendData.mock.calls.filter(([, data]: any) => data.type === 'input')).toHaveLength(1)
        alice.manager.activeChain!.onInputEvent(new InputAudioEvent(note(NOTE_OFF)))
        await vi.waitFor(() => {
            host.manager.updateTime(2, 2)
            expect(host.sink.noteOff).toHaveBeenCalledExactlyOnceWith(60)
        })
        await vi.waitFor(() => expect(bob.sink.noteOff).toHaveBeenCalledExactlyOnceWith(60))
    })

    it('propagates host and guest edits and rejects stale edits without diverging', async () => {
        const host = machine('host', 'leader'), guest = machine('guest', 'follower')
        pair(host, guest)
        await joined(host, guest)
        const stale = guest.manager.exportWorkspace()
        host.manager.activeChain!.setName('Host lead')
        await vi.waitFor(() => expect(guest.manager.activeChain!.options.name).toBe('Host lead'))
        await joined(host, guest)
        guest.manager.activeChain!.setName('Guest lead')
        await vi.waitFor(() => expect(host.manager.activeChain!.options.name).toBe('Guest lead'))
        await vi.waitFor(() => expect(guest.manager.exportWorkspace()).toBe(host.manager.exportWorkspace()))
        guest.connection.sendData('host', { type: 'edit', revision: 1, encoded: stale })
        await new Promise(resolve => setTimeout(resolve, 30))
        expect(host.manager.activeChain!.options.name).toBe('Guest lead')
        expect(guest.manager.exportWorkspace()).toBe(host.manager.exportWorkspace())
    })

    it('waits for the shared clock to lock before allowing notes', async () => {
        const host = machine('host', 'leader'), guest = machine('guest', 'follower')
        guest.connection.clockLocked = false
        pair(host, guest)
        await vi.waitFor(() => expect(guest.report.mock.calls.at(-1)?.[0]).toContain('synchronizing'))
        guest.manager.activeChain!.onInputEvent(new InputAudioEvent(note()))
        expect(guest.connection.sendData.mock.calls.some(([, message]: any) => message.type === 'input')).toBe(false)
        guest.connection.clockLocked = true
        guest.connection.onClockChange()
        await joined(host, guest)
        guest.manager.dispatchEvent(new Event(EVENT_CHAINS_UPDATED)) // A device refresh without a configuration change.
        await new Promise(resolve => setTimeout(resolve, 120))
        guest.manager.activeChain!.onInputEvent(new InputAudioEvent(note()))
        expect(guest.connection.sendData.mock.calls.some(([, message]: any) => message.type === 'input')).toBe(true)
    })

    it('reports missing devices instead of claiming identical setup or playing partial notes', async () => {
        const host = machine('host', 'leader'), guest = machine('guest', 'follower', true)
        pair(host, guest)
        await vi.waitFor(() => expect(guest.report.mock.calls.at(-1)?.[0]).toContain('setup incomplete'))
        guest.manager.activeChain!.onInputEvent(new InputAudioEvent(note()))
        expect(guest.connection.sendData.mock.calls.some(([, data]: any) => data.type === 'input')).toBe(false)
        expect(host.report.mock.calls.at(-1)?.[0]).toContain('cannot load every device')
    })

    it('silences notes and releases interception when leaving, including scheduled notes', async () => {
        const host = machine('host', 'leader'), guest = machine('guest', 'follower')
        pair(host, guest)
        await joined(host, guest)
        host.connection.playbackDelayMs = 1000
        host.manager.activeChain!.triggerAudioCommandsOnDevice([note()])
        host.workspace.silence()
        host.workspace.destroy()
        guest.workspace.destroy()
        expect(host.manager.sessionOutputHandler).toBeUndefined()
        expect(guest.manager.sessionInputHandler).toBeUndefined()
        await new Promise(resolve => setTimeout(resolve, 20))
        expect(host.sink.noteOn).not.toHaveBeenCalled()
        expect(guest.sink.noteOn).not.toHaveBeenCalled()
    })

    it('serializes MIDI data without linked-list cycles and rejects invalid commands', () => {
        const command = note()
        command.previous = command
        command.raw = Uint8Array.of(0x90, 60, 100)
        const packed = JSON.parse(JSON.stringify(packRoomCommand(command)))
        const restored = unpackRoomCommand(packed, 42)!
        expect(restored.startAt).toBe(42)
        expect(restored.raw).toEqual(command.raw)
        expect(unpackRoomCommand({ ...packed, number: 128 }, 0)).toBeUndefined()
        expect(unpackRoomCommand({ ...packed, raw: [NaN] }, 0)).toBeUndefined()
        expect(unpackRoomCommand({ ...packed, type: 'execute' }, 0)).toBeUndefined()
    })
})
