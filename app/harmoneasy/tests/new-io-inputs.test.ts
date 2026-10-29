// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import InputStepSequencer from '../../../packages/audiobus/io/inputs/input-step-sequencer'
import InputPads from '../../../packages/audiobus/io/inputs/input-pads'
import InputMicrophoneTrigger from '../../../packages/audiobus/io/inputs/input-microphone-trigger'
import InputCameraGestures from '../../../packages/audiobus/io/inputs/input-camera-gestures'
import InputEventLoop from '../../../packages/audiobus/io/inputs/input-event-loop'
import { INPUT_EVENT, EVENT_CHANGE } from '../../../packages/audiobus/event-constants'
import { NOTE_ON, NOTE_OFF, CONTROL_CHANGE } from '../../../packages/audiobus/commands'
import { musicalCommand, parseEventClip } from '../../../packages/audiobus/io/event-clip'
import { deviceDefinition, defineDevice } from '../../../packages/audiobus/io/device-definition'

const devices: Array<{ destroy(): void }> = []
function capture<T extends EventTarget & { destroy(): void }>(input: T) {
    const receive = vi.fn()
    input.addEventListener(INPUT_EVENT, event => receive((event as any).command))
    devices.push(input)
    return receive
}
afterEach(() => { devices.splice(0).forEach(device => device.destroy()); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('step sequencer input', () => {
    it('waits for transport, gates notes, follows tempo and releases on stop', () => {
        let bpm = 120, now = 10
        const input = new InputStepSequencer({ steps: [60, 62, null, 65], gate: 0.5, getBpm: () => bpm, now: () => now })
        const receive = capture(input)
        input.updateTime(now); expect(receive).not.toHaveBeenCalled()
        input.startClock(); input.updateTime(now)
        expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ type: NOTE_ON, number: 60, startAt: 10 }))
        now = 10.1; input.updateTime(now)
        expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ type: NOTE_OFF, number: 60 }))
        now = 10.125; input.updateTime(now)
        expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ type: NOTE_ON, number: 62 }))
        bpm = 60; now = 10.375; input.updateTime(now)
        expect(receive.mock.calls.filter(([command]) => command.type === NOTE_ON)).toHaveLength(2)
        input.stopClock(); const count = receive.mock.calls.length
        input.updateTime(50); expect(receive).toHaveBeenCalledTimes(count)
        input.startClock(); input.updateTime(50)
        expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ type: NOTE_ON, number: 60 }))
    })
    it('skips missed steps after a stall and serializes edits as plain data', async () => {
        const input = defineDevice(new InputStepSequencer(), { factory: 'input', type: 'step-sequencer' })
        const receive = capture(input)
        const panel = await input.createGui(), first = panel.querySelector('input')!
        first.value = '72'; first.dispatchEvent(new Event(EVENT_CHANGE))
        expect(JSON.parse(JSON.stringify(deviceDefinition(input))).options.steps[0]).toBe(72)
        input.startClock(); input.updateTime(0); input.updateTime(20)
        expect(receive.mock.calls.filter(([command]) => command.type === NOTE_ON)).toHaveLength(2)
        input.stopClock()
    })
})

describe('chord and drum pads', () => {
    it('preserves shared chord tones until both pads release and handles cancellation', () => {
        const input = new InputPads(), receive = capture(input)
        input.press('a', 0); input.press('b', 2); input.press('b', 2)
        expect(receive.mock.calls.filter(([command]) => command.type === NOTE_ON)).toHaveLength(4)
        input.release('a')
        expect(receive.mock.calls.filter(([command]) => command.type === NOTE_OFF).map(([command]) => command.number)).toEqual([60])
        input.allNotesOff()
        expect(receive.mock.calls.filter(([command]) => command.type === NOTE_OFF).map(([command]) => command.number).sort()).toEqual([60, 64, 67, 71])
        input.release('b'); expect(receive.mock.calls.filter(([command]) => command.type === NOTE_OFF)).toHaveLength(4)
    })
    it('supports keyboard activation, blur cleanup and recreating the UI', async () => {
        const input = new InputPads({ mode: 'drums', channel: 10 }), receive = capture(input)
        const panel = await input.createGui(), button = panel.querySelector('button')!
        button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
        expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ type: NOTE_ON, number: 36, channel: 10 }))
        window.dispatchEvent(new Event('blur'))
        expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ type: NOTE_OFF, number: 36 }))
        await input.destroyGui(); expect(await input.createGui()).not.toBe(panel)
    })
})

describe('microphone triggers', () => {
    it('requires a fresh threshold crossing, enforces retrigger spacing and ends pulses', () => {
        vi.useFakeTimers()
        const input = new InputMicrophoneTrigger({ threshold: 0.1, retriggerMs: 150 }), receive = capture(input)
        input.setAsConnected()
        input.processLevel(0.2, 0); input.processLevel(0.3, 200)
        expect(receive).toHaveBeenCalledTimes(1)
        vi.advanceTimersByTime(80)
        expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ type: NOTE_OFF, number: 36 }))
        input.processLevel(0.01, 220); input.processLevel(0.4, 230)
        expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ type: NOTE_ON, number: 36, channel: 10 }))
        input.destroy(); vi.runAllTimers()
        expect(receive.mock.calls.filter(([command]) => command.type === NOTE_OFF)).toHaveLength(2)
    })
    it('stops a stream whose permission request resolves after cancellation', async () => {
        let grant!: (stream: any) => void
        const track = { stop: vi.fn() }
        vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(() => new Promise(resolve => { grant = resolve })) } })
        const input = new InputMicrophoneTrigger({ audioContext: { resume: async () => {} } }); capture(input)
        const pending = input.connect(); expect(input.connect()).toBe(pending); await Promise.resolve()
        await input.disconnect(); grant({ getTracks: () => [track] }); await pending
        expect(track.stop).toHaveBeenCalledOnce(); expect(input.isConnected).toBe(false)
    })
})

describe('camera gesture mapping', () => {
    it('coalesces repeated connections and cancels model loading without leaving a worker or timeout', async () => {
        vi.useFakeTimers()
        const workers: any[] = []
        class WorkerStub extends EventTarget {
            postMessage = vi.fn()
            terminate = vi.fn()
            constructor() { super(); workers.push(this) }
        }
        vi.stubGlobal('Worker', WorkerStub)
        const input = new InputCameraGestures(); capture(input)
        const pending = input.connect(); expect(input.connect()).toBe(pending)
        const rejected = expect(pending).rejects.toThrow('disconnected')
        await input.disconnect(); await rejected
        expect(workers).toHaveLength(1); expect(workers[0].terminate).toHaveBeenCalledOnce()
        expect(input.isConnected).toBe(false); expect(vi.getTimerCount()).toBe(0)
    })
    it('plays only while pinched, changes pitch, and releases on tracking loss', () => {
        const input = new InputCameraGestures(), receive = capture(input)
        input.setAsConnected()
        const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }))
        points[0].y = 1; points[4].x = 0.52
        input.processLandmarks(points); input.processLandmarks(points)
        expect(receive).toHaveBeenCalledTimes(1)
        expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ type: NOTE_ON, number: 72 }))
        points[8].x = 0.25; points[4].x = 0.27; input.processLandmarks(points)
        expect(receive.mock.calls.slice(-2).map(([command]) => [command.type, command.number])).toEqual([[NOTE_OFF, 72], [NOTE_ON, 78]])
        input.processLandmarks([])
        expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ type: NOTE_OFF, number: 78 }))
    })
})

describe('event loop input', () => {
    const clip = { version: 1, duration: 1, commands: [
        musicalCommand({ type: NOTE_ON, number: 60, velocity: 100, channel: 3, startAt: 0 }),
        musicalCommand({ type: CONTROL_CHANGE, number: 64, value: 127, channel: 3, startAt: 0.1 }),
        musicalCommand({ type: NOTE_OFF, number: 60, velocity: 0, channel: 3, startAt: 0.5 }),
    ] }
    it('repeats notes and controllers, clears sustain on stop, and keeps the saved offsets', () => {
        let now = 10
        const input = new InputEventLoop({ ...clip, now: () => now }), receive = capture(input)
        input.startClock(); input.updateTime(now)
        now = 10.1; input.updateTime(now)
        now = 10.5; input.updateTime(now)
        now = 11; input.updateTime(now)
        expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ type: NOTE_ON, number: 60, channel: 3, startAt: 11 }))
        input.stopClock()
        expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ type: NOTE_OFF, number: 60 }))
        expect(input.options.commands[0].startAt).toBe(0)
        input.startClock(); input.updateTime(20); input.updateTime(20.2); input.stopClock()
        expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ type: CONTROL_CHANGE, number: 64, value: 0 }))
    })
    it('rejects corrupt clips without replacing a loaded take', () => {
        const input = new InputEventLoop(clip); capture(input)
        expect(() => input.load({ ...clip, duration: -1 })).toThrow()
        expect(() => parseEventClip({ ...clip, commands: [{ ...clip.commands[0], channel: 19 }] })).toThrow()
        expect(input.options.commands).toHaveLength(3)
    })
})
