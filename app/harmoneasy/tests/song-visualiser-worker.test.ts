import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllGlobals())

it('draws loaded recording bars and stays idle until another change', async () => {
    let frame!: FrameRequestCallback
    const request = vi.fn(callback => { frame = callback; return 1 })
    vi.stubGlobal('requestAnimationFrame', request)
    vi.stubGlobal('self', globalThis)
    vi.stubGlobal('onmessage', null)
    vi.stubGlobal('Path2D', class { rect() {} })
    const context = Object.fromEntries(['fillRect', 'fillText', 'beginPath', 'moveTo', 'lineTo', 'stroke',
        'save', 'translate', 'rotate', 'restore', 'strokeRect'].map(name => [name, vi.fn()]))
    await import('../../../packages/audiobus/ui/song-visualiser-worker')
    const send = (type: string, data: object) => globalThis.onmessage!({ data: { type, data } } as MessageEvent)
    send('init', { canvas: { width: 1080, height: 320, getContext: () => context } })
    send('loadCommands', { commands: [{ startTime: 0, endTime: 1, noteNumber: 0, velocity: 1, source: 'recorded' }] })
    expect(request).toHaveBeenCalledOnce()
    frame(16)
    expect(context.fillRect).toHaveBeenCalledWith(80, 0, 990, 1)
    expect(request).toHaveBeenCalledOnce()
})
