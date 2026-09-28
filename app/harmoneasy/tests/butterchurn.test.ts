// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import OutputButterchurn from '../../../packages/audiobus/io/outputs/output-butterchurn'

const require = createRequire(resolve(import.meta.dirname, '../../../packages/audiobus/package.json'))

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
})

it.each([1, 2, 3])('initializes and resizes Butterchurn at %sx display density', async pixelRatio => {
    vi.useFakeTimers()
    vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(pixelRatio)
    let resize: ResizeObserverCallback = () => {}
    const observe = vi.fn()
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
        constructor(callback: ResizeObserverCallback) { resize = callback }
        observe = observe
        disconnect = disconnect
    })
    // Keep the real package exports; only replace the WebGL factory.
    const butterchurn = require('butterchurn').default
    const visualizer = { connectAudio: vi.fn(), loadPreset: vi.fn(), render: vi.fn(), setRendererSize: vi.fn() }
    const createVisualizer = vi.spyOn(butterchurn, 'createVisualizer').mockReturnValue(visualizer)
    const analyser = { fftSize: 0 }
    const audioContext = { createAnalyser: () => analyser } as unknown as AudioContext
    const gainNode = { connect: vi.fn() } as unknown as GainNode
    const output = new OutputButterchurn(gainNode, audioContext)

    try {
        const canvas = await output.createGui()
        expect(createVisualizer).toHaveBeenCalledExactlyOnceWith(audioContext, canvas, {
            width: 404, height: 256, pixelRatio: 1,
        })
        expect(visualizer.connectAudio).toHaveBeenCalledWith(analyser)
        expect(visualizer.loadPreset).toHaveBeenCalledWith(expect.any(Object), 0.5)
        expect(visualizer.render).toHaveBeenCalledOnce()
        expect(observe).toHaveBeenCalledWith(canvas)
        for (const [width, height] of [[1600, 1200], [404, 256]]) {
            vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ width, height } as DOMRect)
            resize([], {} as ResizeObserver)
            expect(canvas.width).toBe(Math.round(width * window.devicePixelRatio))
            expect(canvas.height).toBe(Math.round(height * window.devicePixelRatio))
            expect(visualizer.setRendererSize).toHaveBeenLastCalledWith(canvas.width, canvas.height, {
                pixelRatio: 1,
            })
        }
    } finally {
        await output.destroyGui()
        expect(disconnect).toHaveBeenCalledOnce()
    }
})
