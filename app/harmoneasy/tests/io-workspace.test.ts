import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
const { compressToBase64, decompressFromBase64 } = createRequire(new URL('../../../packages/audiobus/package.json', import.meta.url))('lz-string')
import IOChain from '../../../packages/audiobus/io/IO-chain'
import IOChainFactory from '../../../packages/audiobus/io/IO-chain-factory'
import IOChainManager from '../../../packages/audiobus/io/IO-chain-manager'
import OutputManager from '../../../packages/audiobus/io/output-manager'
import AbstractInput from '../../../packages/audiobus/io/inputs/abstract-input'
import { deviceId, defineDevice } from '../../../packages/audiobus/io/device-definition'
import { NOTE_ON, NOTE_OFF, PLAYBACK_TOGGLE } from '../../../packages/audiobus/commands'
import { getStructure } from '../source/components/graph/layout'

class Input extends AbstractInput { destroy = vi.fn() }
const output = () => ({ uuid: 'test', name: 'test', description: '', isHidden: false, isConnected: true,
    noteOn: vi.fn(), noteOff: vi.fn(), allNotesOff: vi.fn(), disconnect: vi.fn() })
function setup() {
    const timer = { now: 0, BPM: 120, position: 0, isRunning: true, toggle: vi.fn(), start: vi.fn(), stop: vi.fn(), resetTimer: vi.fn() } as any
    const input = new Input()
    const sink = output()
    const manager = new IOChainManager({ timer, outputMixer: {} as GainNode, externalDevices: { input, sink } })
    const chain = new IOChain(timer)
    chain.setTransformers([])
    chain.addInput(input)
    chain.addOutput(sink)
    const id = manager.addChain(chain)
    return { timer, input, sink, chain, id, manager }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 15))

describe('IO workspace', () => {
    it('records chain identity without changing commands sent to shared outputs', () => {
        const { manager, chain, id } = setup()
        const cloneId = manager.cloneChain(id)
        const clone = manager.getChain(cloneId)!
        chain.setName('Lead')
        clone.setName('Harmony')
        const command = { type: NOTE_ON, number: 60, velocity: 100, startAt: 0, from: 'Keyboard', channel: 1 } as any
        for (const item of [chain, clone]) {
            vi.spyOn(item, 'updateTimeForCommandQueue').mockReturnValue([command])
            vi.spyOn(item, 'triggerAudioCommandsOnDevice').mockResolvedValue(undefined)
        }
        const events = manager.updateTime(1, 1)
        expect(events.map(event => [event.chainId, event.chainName])).toEqual([[id, 'Lead'], [cloneId, 'Harmony']])
        expect(command.chainId).toBeUndefined()
        expect(chain.triggerAudioCommandsOnDevice).toHaveBeenCalledWith([command])
        manager.destroy()
    })
    it('deactivates one chain without interrupting a shared output used by another', async () => {
        const { manager, chain, id, input, sink } = setup()
        const clone = manager.getChain(manager.cloneChain(id))!
        await chain.outputManager.noteOn(60, 100)
        await clone.outputManager.noteOn(60, 100)
        chain.setActive(false)
        await OutputManager.settled(sink)
        expect(sink.noteOff).not.toHaveBeenCalled()
        input.dispatch({ type: NOTE_ON, number: 62, startAt: 0 } as any)
        await tick()
        expect(chain.updateTimeForCommandQueue(1, 1, {})).toEqual([])
        expect(clone.executeQueueAndClearComplete(1)).toHaveLength(1)
        expect(chain.exportConfiguration().options.active).toBe(false)
        chain.setActive(true)
        expect(chain.executeQueueAndClearComplete(1)).toEqual([])
        input.dispatch({ type: NOTE_ON, number: 64, startAt: 0 } as any)
        await tick()
        expect(chain.executeQueueAndClearComplete(1)).toHaveLength(1)
        chain.setActive(false)
        manager.destroy()
        expect(chain.isDestroyed).toBe(true)
    })

    it('persists renamed chains and independently names clones', async () => {
        const { manager, chain, id, timer, input, sink } = setup()
        chain.setName('  Lead keyboard  ')
        chain.setName('   ')
        expect(chain.options.name).toBe('Lead keyboard')
        const clone = manager.getChain(manager.cloneChain(id))!
        expect(clone.options.name).toBe('Lead keyboard copy')
        clone.setName('Bass')
        const restored = new IOChainManager({ timer, outputMixer: {} as GainNode, externalDevices: { input, sink } })
        await restored.restoreWorkspace(manager.exportWorkspace())
        expect(restored.chains.map(chain => chain.options.name)).toEqual(['Lead keyboard', 'Bass'])
        manager.destroy()
        restored.destroy()
    })

    it('stops all chains and resets without changing configuration', async () => {
        const { manager, chain, id, sink, timer } = setup()
        const clone = manager.getChain(manager.cloneChain(id))!
        await chain.outputManager.noteOn(60, 100)
        await clone.outputManager.noteOn(60, 100)
        chain.addCommand({ type: NOTE_ON, number: 62, startAt: 0 } as any)
        const saved = manager.exportWorkspace()
        await manager.transport('reset')
        expect(timer.stop).toHaveBeenCalledTimes(1)
        expect(timer.resetTimer).toHaveBeenCalledTimes(1)
        expect(manager.transportRunning).toBe(false)
        expect(manager.updateTime(1, 1)).toEqual([])
        expect(sink.noteOff).toHaveBeenCalledExactlyOnceWith(60)
        expect(chain.executeQueueAndClearComplete(1)).toEqual([])
        expect(manager.exportWorkspace()).toBe(saved)
        chain.addCommand({ type: NOTE_ON, number: 64, startAt: 0 } as any)
        await Promise.all([manager.transport('start'), manager.transport('start')])
        expect(timer.start).toHaveBeenCalledTimes(1)
        expect(manager.transportRunning).toBe(true)
        expect(chain.executeQueueAndClearComplete(1)).toEqual([])
        manager.destroy()
    })

    it('serializes rapid toggles and recovers after a timer failure', async () => {
        const { manager, timer } = setup()
        await Promise.all([manager.handleTransportCommand(PLAYBACK_TOGGLE), manager.handleTransportCommand(PLAYBACK_TOGGLE)])
        expect(timer.stop).toHaveBeenCalledTimes(1)
        expect(timer.start).toHaveBeenCalledTimes(1)
        timer.stop.mockRejectedValueOnce(new Error('timer unavailable'))
        await expect(manager.transport('stop')).rejects.toThrow('timer unavailable')
        await manager.transport('stop')
        expect(manager.transportRunning).toBe(false)
        manager.destroy()
    })

    it('clones configuration with independent transformers, no queued events and no transport changes', () => {
        const { manager, chain, id, timer, input, sink } = setup()
        chain.importTransformers(JSON.stringify([{ type: 'Harmoniser', enabled: false }]))
        chain.addCommand({ type: NOTE_ON, number: 60, startAt: 0 } as any)
        const clone = manager.getChain(manager.cloneChain(id))!
        expect(clone.inputs).toEqual([input])
        expect(clone.outputs).toEqual([sink])
        expect(clone.transformers[0]).not.toBe(chain.transformers[0])
        expect(clone.transformers[0].uuid).not.toBe(chain.transformers[0].uuid)
        clone.transformers[0].setConfig('enabled', true)
        expect(chain.transformers[0].options.enabled).toBe(false)
        expect(clone.executeQueueAndClearComplete(1)).toEqual([])
        expect(chain.executeQueueAndClearComplete(1)).toHaveLength(1)
        expect(timer.start).not.toHaveBeenCalled()
        expect(timer.stop).not.toHaveBeenCalled()
        manager.destroy()
    })

    it('isolates shared input commands and handles shared transport once', async () => {
        const { manager, input, chain, id, timer } = setup()
        const clone = manager.getChain(manager.cloneChain(id))!
        chain.setTransformers([{ uuid: 'mutator', type: 'test', transform: commands => {
            commands[0].number = 72
            return commands
        } }] as any)
        input.dispatch({ type: NOTE_ON, number: 60, startAt: 0 } as any)
        await tick()
        expect(chain.executeQueueAndClearComplete(1)[0].number).toBe(72)
        expect(clone.executeQueueAndClearComplete(1)[0].number).toBe(60)
        input.dispatch({ type: PLAYBACK_TOGGLE, startAt: 0 } as any)
        await tick()
        expect(timer.stop).toHaveBeenCalledTimes(1)
        manager.destroy()
    })

    it('holds overlapping shared-output notes until the last chain releases them', async () => {
        const { manager, sink, chain, id } = setup()
        const clone = manager.getChain(manager.cloneChain(id))!
        await chain.outputManager.noteOn(60, 100)
        await clone.outputManager.noteOn(60, 90)
        manager.removeChain(id)
        await OutputManager.settled(sink)
        expect(sink.noteOn).toHaveBeenCalledTimes(1)
        expect(sink.noteOff).not.toHaveBeenCalled()
        expect(sink.allNotesOff).not.toHaveBeenCalled()
        clone.outputManager.noteOff(60)
        await OutputManager.settled(sink)
        expect(sink.noteOff).toHaveBeenCalledExactlyOnceWith(60)
        manager.destroy()
    })

    it('orders note release after an asynchronous note-on when a chain is deleted', async () => {
        const { manager, sink, chain, id } = setup()
        let resolve!: () => void
        sink.noteOn.mockImplementation(() => new Promise<void>(done => { resolve = done }))
        const pending = chain.outputManager.noteOn(60, 100)
        await Promise.resolve()
        manager.removeChain(id)
        expect(sink.noteOff).not.toHaveBeenCalled()
        resolve()
        await pending
        await OutputManager.settled(sink)
        expect(sink.noteOff).toHaveBeenCalledExactlyOnceWith(60)
    })

    it('drops deferred transformations and unsubscribes when deleting the last chain', async () => {
        const { manager, chain, id, input } = setup()
        const active = vi.fn()
        manager.addEventListener('chainActiveChanged', active)
        input.dispatch({ type: NOTE_ON, number: 60, startAt: 0 } as any)
        manager.removeChain(id)
        await tick()
        input.dispatch({ type: NOTE_ON, number: 62, startAt: 0 } as any)
        await tick()
        expect(chain.executeQueueAndClearComplete(1)).toEqual([])
        expect(manager.activeChain).toBeNull()
        expect(active.mock.calls[0][0].detail.chainId).toBeNull()
        expect(manager.chainCount).toBe(0)
        expect(chain.inputs).toEqual([])
    })

    it('round-trips sharing, selection and graph configuration without restoring runtime state', async () => {
        const { manager, chain, id, timer } = setup()
        chain.setGraphOptions({ graphLayout: 'vertical', positions: { 'node-start': { x: 12, y: 34 } } })
        const second = manager.cloneChain(id)
        manager.setActiveChain(second)
        const saved = manager.exportWorkspace()
        await manager.restoreWorkspace(saved)
        expect(manager.entries.map(([id]) => id)).toEqual([id, second])
        expect(manager.activeChainId).toBe(second)
        expect(manager.chains[0].inputs[0]).toBe(manager.chains[1].inputs[0])
        expect(manager.chains[0].outputs[0]).toBe(manager.chains[1].outputs[0])
        expect(manager.chains[0].options.graphLayout).toBe('vertical')
        expect(manager.chains[0].options.positions!['node-start']).toEqual({ x: 12, y: 34 })
        expect(timer.start).not.toHaveBeenCalled()
        expect(manager.createEmptyChain()).not.toBe(second)
        manager.destroy()
    })

    it('rejects corrupt references without replacing the current workspace', async () => {
        const { manager, chain } = setup()
        const data = JSON.parse(decompressFromBase64(manager.exportWorkspace().slice(10)))
        data.chains[0].outputs = ['missing']
        await expect(manager.restoreWorkspace('workspace:' + compressToBase64(JSON.stringify(data)))).rejects.toThrow('reference')
        expect(manager.chains).toEqual([chain])
        manager.destroy()
    })

    it('persists an empty workspace and permits adding a chain afterward', async () => {
        const { manager, id } = setup()
        manager.removeChain(id)
        await manager.restoreWorkspace(manager.exportWorkspace())
        expect(manager.chainCount).toBe(0)
        const newId = manager.createEmptyChain()
        expect(manager.activeChainId).toBe(newId)
        manager.destroy()
    })

    it('attaches devices without duplicate subscriptions and releases only unused owned devices', async () => {
        const { manager, input, id } = setup()
        const owned = new Input()
        manager.getChain(id)!.addInput(owned)
        const second = manager.cloneChain(id)
        manager.attachDevice(second, deviceId(input))
        expect(manager.getChain(second)!.inputs).toHaveLength(2)
        manager.removeChain(id)
        await tick()
        expect(owned.destroy).not.toHaveBeenCalled()
        manager.removeChain(second)
        await tick()
        expect(owned.destroy).toHaveBeenCalledTimes(1)
        expect(input.destroy).not.toHaveBeenCalled()
    })

    it('renders complete pass-through routes with stable, graph-specific endpoint IDs', () => {
        const { manager, chain, id } = setup()
        const first = getStructure(chain, true, true, 'horizontal', id)
        expect(first.edges).toHaveLength(3)
        const another = getStructure(chain, true, true, 'horizontal', 'other')
        expect(first.nodes.some(node => another.nodes.some(other => node.id === other.id))).toBe(false)
        const originalId = first.nodes.find(node => node.type === 'input')!.id
        chain.addInput(new Input())
        expect(getStructure(chain, true, true, 'horizontal', id).nodes.find(node => node.type === 'input')!.id).toBe(originalId)
        manager.destroy()
    })

    it('migrates legacy saves with fresh endpoints without changing transport or copying queued notes', async () => {
        const { manager, chain, timer, input, sink } = setup()
        chain.addCommand({ type: NOTE_ON, number: 60, startAt: 0 } as any)
        const saved = chain.exportString()
        const factory = vi.spyOn(IOChainFactory, 'createDefault').mockImplementation(async () => {
            const replacement = new IOChain(timer)
            replacement.addInput(input)
            replacement.addOutput(sink)
            return replacement
        })
        try {
            await manager.restoreWorkspace(saved + '|' + saved)
            expect(manager.chainCount).toBe(2)
            expect(manager.chains.every(chain => chain.transformerQuantity === 0)).toBe(true)
            expect(manager.chains.every(chain => chain.executeQueueAndClearComplete(1).length === 0)).toBe(true)
            expect(timer.start).not.toHaveBeenCalled()
            expect(timer.stop).not.toHaveBeenCalled()
        } finally { factory.mockRestore(); manager.destroy() }
    })

    it('cleans up a device created asynchronously after its chain was deleted', async () => {
        const { manager, chain, id } = setup()
        manager.removeChain(id)
        const input = new Input()
        expect(() => manager.addDevice(chain, input, 'input')).toThrow('deleted')
        await tick()
        expect(input.destroy).toHaveBeenCalledTimes(1)
        expect(manager.devices).toHaveLength(0)
    })

    it('keeps unavailable devices in saved routes so configuration is not lost', async () => {
        const { manager, timer } = setup()
        const saved = manager.exportWorkspace()
        const replacement = new IOChainManager({ timer, outputMixer: {} as GainNode })
        await replacement.restoreWorkspace(saved)
        expect(replacement.restoreWarnings).toHaveLength(2)
        expect(replacement.chains[0].inputs).toHaveLength(1)
        expect(replacement.chains[0].outputs).toHaveLength(1)
        const data = JSON.parse(decompressFromBase64(replacement.exportWorkspace().slice(10)))
        expect(data.devices.map(device => device.definition.type).sort()).toEqual(['input', 'sink'])
        manager.destroy()
        replacement.destroy()
    })

    it('does not share the default transformer between new chains', () => {
        const { manager, timer } = setup()
        const one = new IOChain(timer)
        const two = new IOChain(timer)
        expect(one.transformers[0]).not.toBe(two.transformers[0])
        const clone = new IOChain(timer)
        clone.importConfiguration(one.exportConfiguration())
        expect(clone.exportTransformers()).toBe(one.exportTransformers())
        one.destroy(); two.destroy(); clone.destroy(); manager.destroy()
    })

    it('restores a shared device once and disposes its replaced runtime instance', async () => {
        const { manager, timer } = setup()
        manager.destroy()
        const replacement = new IOChainManager({ timer, outputMixer: {} as GainNode })
        const input = defineDevice(new Input(), { factory: 'input', type: 'test' })
        const chain = new IOChain(timer)
        chain.addInput(input)
        const id = replacement.addChain(chain)
        replacement.cloneChain(id)
        const saved = replacement.exportWorkspace()
        const fresh = new Input()
        const factories = await import('../../../packages/audiobus/io/input-factory')
        const factory = vi.spyOn(factories, 'createInputById').mockResolvedValue(fresh)
        try {
            await replacement.restoreWorkspace(saved)
            await tick()
            expect(factory).toHaveBeenCalledTimes(1)
            expect(replacement.chains.every(chain => chain.inputs[0] === fresh)).toBe(true)
            expect(deviceId(fresh)).toBe(deviceId(input))
            expect(input.destroy).toHaveBeenCalledTimes(1)
            expect(fresh.destroy).not.toHaveBeenCalled()
        } finally { factory.mockRestore(); replacement.destroy() }
    })
})
