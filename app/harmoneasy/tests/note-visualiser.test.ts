import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllGlobals())

async function setup(vertical = false) {
    vi.resetModules()
    let frame: FrameRequestCallback
    const context = { clearRect: vi.fn(), drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: '' }
    const mirrorContext = { clearRect: vi.fn(), drawImage: vi.fn() }
    vi.stubGlobal('OffscreenCanvas', class {
        constructor(public width: number, public height: number) {}
        getContext() { return mirrorContext }
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback })
    vi.stubGlobal('onmessage', null)
    await import('../../../packages/audiobus/ui/note-visualiser-worker')
    const send = (data: object) => globalThis.onmessage!({ data } as MessageEvent)
    const canvas = { width: 1280, height: 512, getContext: () => context }
    send({ canvas, vertical, notes: Array.from({ length: 128 }, (_, number) => ({ number })) })
    return { context, canvas, send, render: (time: number) => frame!(time) }
}

it('retains short notes as transparent scrolling trails without a piano-roll grid', async () => {
    const { context, send, render } = await setup()
    send({ type: 'noteOn', note: 60, colour: 'red', velocity: 1 })
    expect(context.fillRect).toHaveBeenCalledWith(0, 240, 10, 4)
    send({ type: 'noteOff', note: 60 })
    context.fillRect.mockClear()
    render(20)
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 1280, 512)
    expect(context.drawImage).toHaveBeenCalledWith(expect.anything(), 9, 0)
    expect(context.fillRect).not.toHaveBeenCalled()
})

it('keeps vertical direction through note events and resizes both dimensions', async () => {
    const { context, canvas, send, render } = await setup(true)
    send({ type: 'resize', displayWidth: 640, displayHeight: 256 })
    expect([canvas.width, canvas.height]).toEqual([640, 256])
    send({ type: 'noteOn', note: 60, colour: 'red', velocity: 1 })
    expect(context.fillRect).toHaveBeenCalledWith(300, 246, 5, 10)
    render(20)
    expect(context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, -9)
    send({ type: 'allNotesOff' })
    context.fillRect.mockClear()
    render(40)
    expect(context.fillRect).not.toHaveBeenCalled()
})

it('holds overlapping notes until their releases and treats zero velocity as note-off', async () => {
    const { context, send, render } = await setup()
    for (let i = 0; i < 2; i++) send({ type: 'noteOn', note: 60, colour: 'red', velocity: 1 })
    send({ type: 'noteOff', note: 60 })
    context.fillRect.mockClear()
    render(20)
    expect(context.fillRect).toHaveBeenCalledOnce()
    send({ type: 'noteOn', note: 60, velocity: 0 })
    context.fillRect.mockClear()
    render(40)
    expect(context.fillRect).not.toHaveBeenCalled()
})
