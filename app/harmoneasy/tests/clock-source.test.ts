// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import IOChain from '../../../packages/audiobus/io/IO-chain'
import IOChainManager from '../../../packages/audiobus/io/IO-chain-manager'
import AbstractInput from '../../../packages/audiobus/io/inputs/abstract-input'
import { midiToCommand } from '../../../packages/audiobus/midi/midi-command-conversion'
import { ClockSourceController, clockMidiPorts } from '../source/services/clock-source'
import { createClockSourceControls } from '../source/services/clock-source-controls'
import Timer from '../../../packages/netronome/src/timer'

class MidiInput extends AbstractInput {
    inputDevices = [{ id: 'clock', name: 'Controller' }, { id: 'other', name: 'Other controller' }]
    hasMidiInput() { return true }
    send(bytes: number[], now: number, from = 'clock', origin = {}) { this.dispatch(midiToCommand(bytes, now, from)!, origin) }
}
const dispose: (() => void)[] = []
afterEach(() => { dispose.splice(0).forEach(cleanup => cleanup()); document.body.replaceChildren() })
function setup(connected = true) {
    const timer = {
        now: 0, BPM: 120, isRunning: false, lastRecordedExternalTime: 0, ticks: 0, bypassed: false,
        start: vi.fn(async () => { timer.isRunning = true }), stop: vi.fn(async () => { timer.isRunning = false }),
        resetTimer: vi.fn(() => { timer.ticks = 0 }), bypass: vi.fn((external: boolean) => { timer.bypassed = external }),
        externalTrigger: vi.fn(() => { if (timer.isRunning && timer.bypassed) timer.ticks++ })
    }
    const input = new MidiInput()
    if (connected) input.setAsConnected()
    const manager = new IOChainManager({ timer: timer as any, outputMixer: {} as GainNode, externalDevices: { input } })
    const chain = new IOChain(timer as any)
    chain.setTransformers([])
    chain.addInput(input)
    const id = manager.addChain(chain)
    const link = { setSource: vi.fn(async () => {}) }
    const changed = vi.fn(), error = vi.fn()
    const clock = new ClockSourceController(timer, manager, link, changed, error)
    dispose.push(() => { clock.destroy(); manager.destroy() })
    const send = (bytes: number[], time = timer.now, from = 'clock', origin = {}) => {
        timer.now = time
        input.send(bytes, time, from, origin)
    }
    return { timer, manager, chain, id, input, clock, link, changed, error, send }
}

describe('Main clock source', () => {
    it('drives the real timer at 24 PPQN with the first pulse on beat zero and no internal backend', async () => {
        class ExternalTimer extends Timer {
            clockTime = 0
            get now() { return this.clockTime ?? 0 }
            get clockUnitsToSecondsScale() { return 1 }
        }
        const timer = new ExternalTimer({ type: 'audio-worklet', divisions: 24 }, true)
        await timer.loaded
        const divisions: number[] = []
        timer.setCallback(event => divisions.push(event.divisionsElapsed))
        const input = new MidiInput()
        input.setAsConnected()
        const manager = new IOChainManager({ timer, outputMixer: {} as GainNode, externalDevices: { input } })
        const chain = new IOChain(timer)
        chain.setTransformers([])
        chain.addInput(input)
        manager.addChain(chain)
        const clock = new ClockSourceController(timer, manager, { setSource: async () => {} }, () => {}, () => {})
        dispose.push(() => { clock.destroy(); manager.destroy() })
        await clock.setSource('midi')
        input.send([0xfa], 0)
        for (let i = 0; i < 25; i++) {
            timer.clockTime = i / 48
            input.send([0xf8], timer.now)
            await clock.settled()
        }
        expect(divisions).toEqual([...Array.from({ length: 24 }, (_, i) => i), 0])
        expect(timer.BPM).toBeCloseTo(120)
        expect(timer.isRunning).toBe(true)
        input.send([0xfc], timer.now)
        await clock.settled()
        expect(timer.isRunning).toBe(false)
    })
    it('uses the internal timer and ignores unselected external MIDI clocks and transport', async () => {
        const { clock, timer, send } = setup()
        await clock.setSource('internal')
        expect(timer.bypassed).toBe(false)
        timer.stop.mockClear()
        send([0xfc]); send([0xf8]); send([0xfa])
        await clock.settled()
        expect(timer.externalTrigger).not.toHaveBeenCalled()
        expect(timer.stop).not.toHaveBeenCalled()
        expect(timer.isRunning).toBe(true)
        expect(clock.handle(midiToCommand([0x90, 94, 127], 0, 'clock')!)).toBe(false)
    })
    it('starts from MIDI Start, emits every incoming pulse, estimates tempo, pauses and continues without rewinding', async () => {
        const { clock, timer, send } = setup()
        await clock.setSource('midi')
        expect(timer.bypassed).toBe(true)
        expect(timer.isRunning).toBe(false)
        send([0xfa])
        for (let i = 1; i <= 24; i++) send([0xf8], i / 48)
        await clock.settled()
        expect(timer.ticks).toBe(24)
        expect(timer.BPM).toBeCloseTo(120)
        expect(timer.resetTimer).toHaveBeenCalledTimes(1)
        send([0xfc]); send([0xf8], .7)
        await clock.settled()
        expect(timer.ticks).toBe(24)
        send([0xfb]); send([0xf8], .8)
        await clock.settled()
        expect(timer.ticks).toBe(25)
        expect(timer.resetTimer).toHaveBeenCalledTimes(1)
        send([0xfa]); send([0xf8], .9)
        await clock.settled()
        expect(timer.ticks).toBe(1)
    })
    it('does not combine different devices and consumes a shared input only once across inactive chains', async () => {
        const { clock, timer, send, manager, chain, id } = setup()
        const clone = manager.getChain(manager.cloneChain(id))!
        await clock.setSource('midi')
        chain.setActive(false); clone.setActive(false)
        send([0xfa])
        send([0xf8], .1, 'other')
        send([0xf8], .2)
        await clock.settled()
        expect(timer.ticks).toBe(1)
        expect(timer.resetTimer).toHaveBeenCalledTimes(1)
        await clock.setMidiDevice('other')
        expect(timer.isRunning).toBe(false)
        send([0xfa], .3, 'other'); send([0xf8], .4, 'clock'); send([0xf8], .5, 'other')
        await clock.settled()
        expect(timer.ticks).toBe(1)
    })
    it('handles Mackie play, stop and rewind on channel 1 without treating button releases as notes', async () => {
        const { clock, timer, send } = setup()
        await clock.setSource('midi')
        send([0x90, 94, 127]); send([0x80, 94, 0]); send([0xf8], .1)
        await clock.settled()
        expect(timer.isRunning).toBe(true)
        expect(timer.ticks).toBe(1)
        expect(timer.resetTimer).not.toHaveBeenCalled()
        send([0x90, 93, 127]); send([0x90, 93, 0])
        await clock.settled()
        expect(timer.isRunning).toBe(false)
        send([0x90, 91, 127])
        await clock.settled()
        expect(timer.resetTimer).toHaveBeenCalledTimes(1)
        expect(clock.handle(midiToCommand([0x91, 94, 127], 0, 'clock')!)).toBe(false)
        expect(clock.handle(midiToCommand([0x90, 60, 127], 0, 'clock')!)).toBe(false)
    })
    it('accepts MIDI Machine Control play and stop without confusing them with clock pulses', async () => {
        const { clock, timer, send } = setup()
        await clock.setSource('midi')
        send([0xf0, 0x7f, 0x7f, 6, 2, 0xf7])
        await clock.settled()
        expect(timer.isRunning).toBe(true)
        expect(timer.ticks).toBe(0)
        send([0xf0, 0x7f, 0x7f, 6, 1, 0xf7])
        await clock.settled()
        expect(timer.isRunning).toBe(false)
    })
    it('halts MIDI transport on disconnect and rejects MIDI mode when no connected port exists', async () => {
        const { clock, timer, input, send } = setup()
        await clock.setSource('midi')
        send([0xfa]); await clock.settled()
        input.setAsDisconnected()
        await clock.settled()
        expect(timer.isRunning).toBe(false)
        expect(clockMidiPorts(setup(false).manager)).toEqual([])
        await expect(setup(false).clock.setSource('midi')).rejects.toThrow('Connect a MIDI input')
    })
    it('keeps the selected clock port on hot unplug instead of following another connected device', async () => {
        const { clock, timer, input, send } = setup()
        await clock.setSource('midi')
        send([0xfa]); await clock.settled()
        input.inputDevices = [{ id: 'other', name: 'Other controller' }]
        input.dispatchEvent(new Event('deviceListChanged'))
        await clock.settled()
        expect(timer.isRunning).toBe(false)
        expect(clock.midiDevice).toBe('clock')
        send([0xfa], .1, 'other'); send([0xf8], .2, 'other')
        await clock.settled()
        expect(timer.isRunning).toBe(false)
        expect(timer.ticks).toBe(0)
    })
    it('keeps shared clock authority with the room and restores the internal worker when switching back', async () => {
        const { clock, timer, manager, send, link } = setup()
        await clock.setSource('shared')
        expect(timer.bypassed).toBe(true)
        expect(timer.isRunning).toBe(false)
        timer.isRunning = true // A room session has started the timer.
        expect(manager.transportRunning).toBe(true)
        send([0xfc]); send([0xf8], .1)
        await clock.settled()
        expect(timer.isRunning).toBe(true)
        expect(timer.ticks).toBe(0)
        expect(clock.handle({ type: 'tempoTap' } as any)).toBe(true)
        expect(clock.handle({ type: 'playbackToggle' } as any)).toBe(true)
        await clock.setSource('internal')
        expect(link.setSource).toHaveBeenLastCalledWith('internal')
        expect(timer.bypassed).toBe(false)
        expect(timer.isRunning).toBe(true)
    })
    it('allows one manual tick per press, and does not advance while paused', async () => {
        const { clock, timer, manager } = setup()
        await clock.setSource('manual')
        await clock.manualTick()
        expect(timer.ticks).toBe(1)
        await manager.transport('stop')
        await clock.manualTick()
        expect(timer.ticks).toBe(1)
        await clock.setSource('internal')
        await clock.manualTick()
        expect(timer.ticks).toBe(1)
    })
})

describe('Clock source controls', () => {
    it('adds the MIDI option on connection, hides QR controls for external clocks, and ticks via Space without typing interference', async () => {
        document.body.innerHTML = readFileSync('index.html', 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        const { timer, manager, input } = setup(false)
        const persist = vi.fn()
        const clock = createClockSourceControls(timer, manager, { setSource: vi.fn(async () => {}) }, persist, vi.fn())
        dispose.push(() => clock.destroy())
        const select = document.getElementById('clock-source') as HTMLSelectElement
        expect(select.querySelector('option[value="midi"]')).toBeNull()
        input.setAsConnected()
        expect(select.querySelector('option[value="midi"]')).not.toBeNull()
        await clock.setSource('manual')
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true }))
        await clock.settled()
        expect(timer.ticks).toBe(1)
        const text = document.createElement('textarea')
        document.body.append(text)
        text.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true }))
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', repeat: true }))
        await clock.settled()
        expect(timer.ticks).toBe(1)
        expect((document.getElementById('tempo') as HTMLInputElement).disabled).toBe(true)
        expect(document.getElementById('btn-clock-tick')!.hidden).toBe(false)
        expect(persist).toHaveBeenCalledWith('manual', 'clock')
        window.dispatchEvent(new Event('pagehide'))
    })
})
