import { afterEach, describe, expect, it, vi } from 'vitest'
import InputMusicMouse from '../../../packages/audiobus/io/inputs/input-music-mouse'
import { NOTE_OFF, NOTE_ON } from '../../../packages/audiobus/commands'

afterEach(() => vi.unstubAllGlobals())

async function setup(onlyWhileMouseDown = false) {
    const context = Object.fromEntries(['fillRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'arc', 'fill', 'fillText']
        .map(name => [name, vi.fn()]))
    let rect = { left: 100, top: 50, width: 400, height: 200 }
    class Element extends EventTarget {
        style = {}
        children: any[] = []
        width = 0
        height = 0
        checked = false
        append(...items: any[]) { this.children.push(...items) }
        appendChild(item: any) { this.append(item) }
        remove() {}
        getContext() { return context }
        getBoundingClientRect() { return rect }
    }
    const window = Object.assign(new EventTarget(), { devicePixelRatio: 2 })
    vi.stubGlobal('window', window)
    vi.stubGlobal('document', { createElement: () => new Element() })
    const input = new InputMusicMouse({ onlyWhileMouseDown, now: () => 0 })
    const dispatch = vi.spyOn(input, 'dispatch')
    const gui = await input.createGui() as unknown as Element
    const canvas = gui.children[1] as Element
    const toggle = gui.children[0].children[0] as Element
    const mouse = (type: string, buttons = 0, x = .25, y = .5) => {
        canvas.dispatchEvent(Object.assign(new Event(type), {
            clientX: rect.left + rect.width * x, clientY: rect.top + rect.height * y,
            buttons, button: 0
        }))
    }
    return { input, dispatch, context, window, canvas, toggle, mouse,
        resize: () => { rect = { left: 270, top: 190, width: 1200, height: 600 } } }
}

describe('Music Mouse', () => {
    it('maps scaled and repositioned canvas coordinates consistently and renders valid names', async () => {
        const { input, dispatch, context, mouse, resize } = await setup()
        mouse('mouseenter')
        mouse('mousemove')
        expect(dispatch.mock.calls[0][0]).toMatchObject({ type: NOTE_ON, number: 76, velocity: 50 })
        expect(context.arc).toHaveBeenLastCalledWith(200, 200, 8, 0, Math.PI * 2)
        resize()
        mouse('mousemove')
        expect(dispatch).toHaveBeenCalledTimes(1)
        expect(context.arc).toHaveBeenLastCalledWith(200, 200, 8, 0, Math.PI * 2)
        expect(context.fillText.mock.calls.some(([text]) => text === 'E5 (76) | Vel: 50')).toBe(true)
        expect(context.fillText.mock.calls.some(([text]) => text.includes('undefined'))).toBe(false)
        input.destroy()
    })

    it('gates notes on the primary button and stops on release, leave, blur, and destruction', async () => {
        const { input, dispatch, window, mouse } = await setup(true)
        mouse('mouseenter')
        mouse('mousemove')
        mouse('mousemove', 2)
        expect(dispatch).not.toHaveBeenCalled()
        for (const stop of [() => window.dispatchEvent(new Event('mouseup')),
            () => mouse('mouseleave'), () => window.dispatchEvent(new Event('blur')),
            () => input.destroy()]) {
            mouse('mousedown', 1)
            expect(dispatch.mock.lastCall![0].type).toBe(NOTE_ON)
            stop()
            expect(dispatch.mock.lastCall![0].type).toBe(NOTE_OFF)
        }
        const count = dispatch.mock.calls.length
        mouse('mousedown', 1)
        expect(dispatch).toHaveBeenCalledTimes(count)
    })

    it('stops the current note when enabling the toggle and allows hover when disabled', async () => {
        const { input, dispatch, toggle, mouse } = await setup()
        mouse('mouseenter')
        mouse('mousemove')
        toggle.checked = true
        toggle.dispatchEvent(new Event('change'))
        expect(input.options.onlyWhileMouseDown).toBe(true)
        expect(dispatch.mock.lastCall![0].type).toBe(NOTE_OFF)
        mouse('mousemove')
        expect(dispatch).toHaveBeenCalledTimes(2)
        toggle.checked = false
        toggle.dispatchEvent(new Event('change'))
        mouse('mousemove')
        expect(dispatch.mock.lastCall![0].type).toBe(NOTE_ON)
        input.destroy()
    })
})
