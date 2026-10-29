import { afterEach, describe, expect, it, vi } from 'vitest'
import WAMInstrument from '../../../packages/audiobus/instruments/wam/wam-instrument'
import { createInstrumentById, getAvailableInstrumentFactories } from '../../../packages/audiobus/instruments/instrument-factory-ui'
import { InstrumentFactory } from '../../../packages/audiobus/instruments/instrument-factory'
import { INSTRUMENT_CATEGORY_WAM2 } from '../../../packages/audiobus/instruments/instrument-types'
import { deviceDefinition } from '../../../packages/audiobus/io/device-definition'
import { WAM2_INSTRUMENTS, wam2OutputId } from '../../../packages/audiobus/wam/registry'
import { midiToCommand } from '../../../packages/audiobus/midi/midi-command-conversion'

function setup() {
    vi.stubGlobal('window', { AudioContext: class {} })
    vi.stubGlobal('AudioWorkletNode', class {})
    const output = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }
    const context = { currentTime: 10, destination: {}, createGain: () => output } as any
    const plugin = {
        descriptor: { name: 'Synth' },
        audioNode: { connect: vi.fn(), disconnect: vi.fn(), destroy: vi.fn(), scheduleEvents: vi.fn() },
    }
    const load = vi.spyOn(WAMInstrument.prototype as any, 'createPlugin').mockResolvedValue(plugin)
    return { output, context, plugin, load }
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('WAM instruments', () => {
    it('loads every catalogue instrument into the mixer and restores its selected URL and level', async () => {
        const { context, output, load, plugin } = setup()
        const mixer = new (class Mixer {})() as AudioNode
        for (const descriptor of WAM2_INSTRUMENTS) {
            output.connect.mockClear()
            const id = wam2OutputId(descriptor)
            const instrument = await createInstrumentById(context, id, { mixer, gain: 0.4 }) as WAMInstrument
            expect(load).toHaveBeenLastCalledWith(expect.stringMatching(/^https:\/\//))
            expect(output.connect).toHaveBeenCalledExactlyOnceWith(mixer)
            expect(plugin.audioNode.connect).toHaveBeenLastCalledWith(output)
            const definition = deviceDefinition(instrument)
            expect(definition).toMatchObject({ factory: 'instrument', type: id, options: { gain: 0.4, pluginUrl: instrument.options.pluginUrl } })
            expect(definition.options).not.toHaveProperty('mixer')
            await instrument.destroy()
            const restored = await createInstrumentById(context, definition.type!, { ...definition.options, mixer }) as WAMInstrument
            expect(restored.options).toEqual(instrument.options)
            await restored.destroy()
        }
    })

    it('supports custom URLs without connecting directly to the speakers and retains full MIDI commands', async () => {
        const { context, output, plugin } = setup()
        const instrument = await InstrumentFactory.createInstrument('wam2', context, {}, { pluginUrl: 'https://example.com/synth/index.js' }) as WAMInstrument
        expect(output.connect).not.toHaveBeenCalled()
        instrument.sendCommand(midiToCommand([0x93, 60, 80], 0, 'keyboard')!)
        expect(plugin.audioNode.scheduleEvents).toHaveBeenLastCalledWith({ type: 'wam-midi', time: 10, data: { bytes: [0x93, 60, 80] } })
        expect(instrument.getActiveNoteCount()).toBe(1)
        instrument.volume = 0.25
        expect(instrument.options.gain).toBe(0.25)
        await instrument.dispose()
        expect(instrument.getActiveNoteCount()).toBe(0)
        expect(plugin.audioNode.destroy).toHaveBeenCalledOnce()
        expect(output.disconnect).toHaveBeenCalledOnce()
    })

    it('releases the output bus if a plugin fails to load', async () => {
        const { context, load, output } = setup()
        load.mockRejectedValue(new Error('Plugin unavailable'))
        await expect(InstrumentFactory.createInstrument('wam2', context, {}, { pluginUrl: 'https://example.com/missing.js' })).rejects.toThrow('Plugin unavailable')
        expect(output.disconnect).toHaveBeenCalledOnce()
    })

    it('offers catalogue instruments with previews only when AudioWorklet is supported', () => {
        setup()
        const factories = getAvailableInstrumentFactories().filter(factory => factory.category === INSTRUMENT_CATEGORY_WAM2)
        expect(factories).toHaveLength(WAM2_INSTRUMENTS.length + 1)
        expect(factories.every(factory => factory.preview)).toBe(true)
        vi.stubGlobal('AudioWorkletNode', undefined)
        expect(getAvailableInstrumentFactories().some(factory => factory.category === INSTRUMENT_CATEGORY_WAM2)).toBe(false)
    })
})
