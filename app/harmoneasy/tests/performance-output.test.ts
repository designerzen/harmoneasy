// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OutputPerformance from '../../../packages/audiobus/io/outputs/output-performance'
import IOChain from '../../../packages/audiobus/io/IO-chain'
import IOChainManager from '../../../packages/audiobus/io/IO-chain-manager'
import { NOTE_ON, CONTROL_CHANGE } from '../../../packages/audiobus/commands'
import { EVENT_VISIBILITY_CHANGE } from '../../../packages/audiobus/event-constants'
import { PERFORMANCE_HISTORY_LIMIT } from '../../../packages/audiobus/io/outputs/performance-metrics'
import { createOutputById, getAvailableOutputFactories } from '../../../packages/audiobus/io/output-factory'
import { deviceDefinition } from '../../../packages/audiobus/io/device-definition'

let now = 0
let frame: FrameRequestCallback
let hidden = false
const outputs: OutputPerformance[] = []
const managers: IOChainManager[] = []
const cancelFrame = vi.fn()
function monitor() {
    const output = new OutputPerformance()
    outputs.push(output)
    return output
}
function advance(duration: number, step = 1000 / 60) {
    const end = now + duration
    while (now + step < end - 0.001) { now += step; frame(now) }
    now = end
    frame(now)
}
beforeEach(() => {
    now = 0
    hidden = false
    cancelFrame.mockClear()
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1 })
    vi.stubGlobal('cancelAnimationFrame', cancelFrame)
    vi.stubGlobal('PerformanceObserver', undefined)
})
afterEach(() => {
    managers.splice(0).forEach(manager => manager.destroy())
    outputs.splice(0).forEach(output => output.destroy())
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('Performance output', () => {
    it('is available in the output picker and preserves its factory identity for saving', async () => {
        expect(getAvailableOutputFactories().find(factory => factory.id === 'performance')?.name).toBe('Performance')
        const output = await createOutputById('performance') as OutputPerformance
        outputs.push(output)
        expect(deviceDefinition(output)).toMatchObject({ factory: 'output', type: 'performance' })
        expect(output.hasAudioOutput()).toBe(false)
    })

    it('records event throughput, peak chain load and second-to-millisecond clock metrics', async () => {
        const output = monitor()
        output.recordChainPerformance({ phase: 'transform', durationMs: 20, events: 2, queueDepth: 4 })
        output.recordChainPerformance({ phase: 'output', durationMs: 2, events: 5, queueDepth: 1 })
        output.recordTimerPerformance({ drift: -0.003, lag: 0.002, timePassed: 1.002, expected: 1 })
        output.recordTimerPerformance({ drift: 0.004, lag: 0.015, timePassed: 1.025, expected: 1 })
        advance(1001)
        const sample = output.samples[0]
        expect(sample.fps).toBeGreaterThan(59)
        expect(sample.fps).toBeLessThan(61)
        expect(sample.eventsPerSecond).toBeCloseTo(5, 1)
        expect(sample).toMatchObject({ transformMs: 20, outputMs: 2, queueDepth: 4, timerDriftMs: 4, timerLagMs: 15, blockedPercent: null })
        expect(sample.timerJitterMs).toBeCloseTo(23)
        expect(sample.warnings).toContain('Netronome lag > 10 ms')
        const gui = await output.createGui()
        expect(gui.querySelectorAll('svg')).toHaveLength(5)
        expect(gui.querySelector('title')?.textContent).toContain('Netronome lag')
        expect(gui.textContent).toContain('Blocked N/A')
        expect(output.samples[0].warnings).not.toBe(sample.warnings)
    })

    it('detects stalls, bounds history and ignores background throttling', () => {
        const output = monitor()
        advance(1001, 1001)
        expect(output.samples[0].warnings).toContain('Frame stall > 50 ms')
        hidden = true
        document.dispatchEvent(new Event(EVENT_VISIBILITY_CHANGE))
        advance(10000, 10000)
        expect(output.samples).toHaveLength(1)
        hidden = false
        document.dispatchEvent(new Event(EVENT_VISIBILITY_CHANGE))
        advance(1001)
        expect(output.samples.at(-1)?.warnings).toEqual([])
        for (let i = 0; i < PERFORMANCE_HISTORY_LIMIT; i++) advance(1001)
        expect(output.samples).toHaveLength(PERFORMANCE_HISTORY_LIMIT)
        expect(output.samples.at(-1)?.timerLagMs).toBeNull()
        output.clear()
        expect(output.samples).toEqual([])
    })

    it('measures supported long tasks and releases monitoring independently of the GUI', async () => {
        let receive: (list: { getEntries(): Array<{ startTime: number; duration: number }> }) => void
        const disconnect = vi.fn()
        vi.stubGlobal('PerformanceObserver', class {
            static supportedEntryTypes = ['longtask']
            constructor(callback: typeof receive) { receive = callback }
            observe() {}
            disconnect = disconnect
        })
        const output = monitor()
        receive!({ getEntries: () => [{ startTime: 100, duration: 300 }] })
        await output.createGui()
        await output.destroyGui()
        advance(1001)
        expect(output.samples[0].blockedPercent).toBeCloseTo(30, 0)
        expect(output.samples[0].warnings).toContain('Main thread blocked > 20%')
        expect((await output.createGui()).textContent).toContain('30.0%')
        output.destroy()
        expect(disconnect).toHaveBeenCalled()
        expect(cancelFrame).toHaveBeenCalledWith(1)
        expect(output.isConnected).toBe(false)
    })

    it('measures the full chain, including non-note events, and excludes disabled monitors', async () => {
        const timer = { now: 0, isRunning: true, BPM: 120 }
        const chain = new IOChain(timer as never)
        const output = monitor()
        const manager = new IOChainManager({ timer: timer as never, outputMixer: {} as GainNode, externalDevices: { output } })
        managers.push(manager)
        chain.setTransformers([])
        chain.addOutput(output)
        const id = manager.addChain(chain)
        const measurements = vi.spyOn(output, 'recordChainPerformance')
        const clock = vi.spyOn(output, 'recordTimerPerformance')
        await chain.addCommandToQueue({ type: NOTE_ON, number: 60, velocity: 100, startAt: 0 } as never)
        expect(measurements).toHaveBeenCalledWith(expect.objectContaining({ phase: 'transform' }))
        expect(measurements).toHaveBeenCalledWith(expect.objectContaining({ phase: 'queue', queueDepth: 1 }))
        await chain.triggerAudioCommandsOnDevice([{ type: CONTROL_CHANGE, number: 1, velocity: 3 } as never])
        expect(measurements).toHaveBeenCalledWith(expect.objectContaining({ phase: 'output', events: 1 }))
        manager.cloneChain(id)
        manager.recordTimerPerformance({ drift: 0, lag: 0, timePassed: 1, expected: 1 })
        expect(clock).toHaveBeenCalledTimes(1)
        for (const entry of manager.chains) entry.outputManager.setEnabled(output, false)
        measurements.mockClear()
        await chain.triggerAudioCommandsOnDevice([{ type: NOTE_ON, number: 61, velocity: 100 } as never])
        manager.recordTimerPerformance({ drift: 0, lag: 0, timePassed: 2, expected: 2 })
        expect(measurements).not.toHaveBeenCalled()
        expect(clock).toHaveBeenCalledTimes(1)
    })
})
