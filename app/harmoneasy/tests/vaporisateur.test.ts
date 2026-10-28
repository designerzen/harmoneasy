import { afterEach, describe, expect, it, vi } from 'vitest'

const { createEngine } = vi.hoisted(() => ({ createEngine: vi.fn() }))
vi.mock('../../../packages/audiobus/instruments/openDAW/vaporisateur-engine.ts', () => ({ createVaporisateurEngine: createEngine }))
import Vaporisateur from '../../../packages/audiobus/instruments/openDAW/opendaw-vaporisateur'
import { InstrumentFactory } from '../../../packages/audiobus/instruments/instrument-factory'

function setup() {
    const output = { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1, cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() } }
    const context = { currentTime: 2, createGain: () => output } as unknown as AudioContext
    const engine = { output: { connect: vi.fn() }, noteOn: vi.fn(), noteOff: vi.fn(), panic: vi.fn(), dispose: vi.fn() }
    createEngine.mockResolvedValue(engine)
    return { synth: new Vaporisateur(context), engine, output, context }
}

afterEach(() => { vi.clearAllMocks(); vi.useRealTimers() })

describe('Vaporisateur', () => {
    it('is the only OpenDAW instrument and initializes through the factory before returning', async () => {
        const { context, engine } = setup()
        expect(InstrumentFactory.getAvailableInstruments().filter(item => item.id.startsWith('opendaw-')).map(item => item.id)).toEqual(['opendaw-vaporisateur'])
        const synth = await InstrumentFactory.createInstrument('opendaw-vaporisateur', context)
        expect(synth.isConnected).toBe(true)
        expect(engine.output.connect).toHaveBeenCalledWith(synth.output)
        await synth.disconnect!()
    })

    it('shares concurrent initialization and preserves held notes when another note is released', async () => {
        const { synth, engine } = setup()
        await Promise.all([synth.connect(), synth.connect()])
        expect(createEngine).toHaveBeenCalledTimes(1)
        synth.noteOn(60, 100)
        synth.noteOn(64, 64)
        synth.noteOff(60)
        expect([...synth.activeNotes]).toEqual([64])
        expect(engine.noteOn.mock.calls).toEqual([[60, 100 / 127], [64, 64 / 127]])
        expect(engine.noteOff).toHaveBeenCalledWith(60)
        synth.allNotesOff()
        expect(engine.noteOff).toHaveBeenCalledWith(64)
        expect(engine.panic).toHaveBeenCalledOnce()
        expect(synth.isNoteDown).toBe(false)
    })

    it('treats zero velocity as note-off and ignores invalid pitches', async () => {
        const { synth, engine } = setup()
        await synth.connect()
        synth.noteOn(60, 0.5)
        synth.noteOn(60, 0)
        synth.noteOn(-1)
        synth.noteOn(128)
        synth.noteOn(60.5)
        expect(engine.noteOn).toHaveBeenCalledTimes(1)
        expect(engine.noteOff).toHaveBeenCalledWith(60)
        expect(synth.isNoteDown).toBe(false)
    })

    it('cancels delayed notes on note-off and disconnect', async () => {
        vi.useFakeTimers()
        const { synth, engine } = setup()
        await synth.connect()
        synth.noteOn(60, 1, null, 1)
        synth.noteOff(60)
        synth.noteOn(64, 1, null, 1)
        await synth.disconnect()
        vi.advanceTimersByTime(2000)
        expect(engine.noteOn).not.toHaveBeenCalled()
        expect(engine.dispose).toHaveBeenCalledOnce()
        expect(synth.isConnected).toBe(false)
    })

    it('disposes an initialization cancelled before completion', async () => {
        const { synth, engine } = setup()
        let resolve!: (engine: unknown) => void
        createEngine.mockReturnValueOnce(new Promise(done => { resolve = done }))
        const loading = synth.connect()
        const closing = synth.disconnect()
        resolve(engine)
        await Promise.all([loading, closing])
        expect(engine.dispose).toHaveBeenCalledOnce()
        expect(engine.output.connect).not.toHaveBeenCalled()
        expect(synth.isConnected).toBe(false)
        await synth.connect()
        expect(synth.isConnected).toBe(true)
    })

    it('allows retry after an engine failure and applies volume to the real output', async () => {
        const { synth, output } = setup()
        createEngine.mockRejectedValueOnce(new Error('worklet unavailable'))
        await expect(synth.connect()).rejects.toThrow('worklet unavailable')
        await synth.connect()
        synth.volume = 0.4
        expect(output.gain.setTargetAtTime).toHaveBeenCalledWith(0.4, 2, 0.02)
        await synth.dispose()
        expect(output.disconnect).toHaveBeenCalledOnce()
    })
})
