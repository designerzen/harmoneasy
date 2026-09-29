// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import SVGKeyboard from '../../../packages/audiobus/ui/keyboard-svg'
import InputOnScreenKeyboard from '../../../packages/audiobus/io/inputs/input-onscreen-keyboard'
import NoteModel from '../../../packages/audiobus/note-model'

const keyboards: SVGKeyboard[] = []
function setup(numbers = [60, 61, 62]) {
    const on = vi.fn()
    const off = vi.fn()
    const keyboard = new SVGKeyboard(numbers.map(number => new NoteModel(number)), on, off)
    keyboards.push(keyboard)
    document.body.append(keyboard.element)
    return { keyboard, on, off, keys: numbers.map(number => keyboard.keyMap.get(number)!) }
}
function pointer(target: EventTarget, type: string, id: number, init: PointerEventInit = {}) {
    target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch',
        button: 0, buttons: 1, pressure: 0.5, ...init,
    }))
}
afterEach(() => {
    keyboards.splice(0).forEach(keyboard => keyboard.destroy())
    vi.restoreAllMocks()
    document.body.replaceChildren()
})

describe('onscreen keyboard interaction', () => {
    it('releases only the lifted finger, even outside the keyboard', () => {
        const { on, off, keys, keyboard } = setup()
        pointer(keys[0], 'pointerdown', 10)
        pointer(keys[1], 'pointerdown', 11)
        pointer(document, 'pointerup', 10)
        expect(on.mock.calls).toEqual([[60, 0.5, 10], [61, 0.5, 11]])
        expect(off.mock.calls).toEqual([[60, 1, 10]])
        expect(keyboard.activeNotes.get(11)?.noteNumber).toBe(61)
        pointer(document, 'pointercancel', 11)
        expect(off.mock.calls).toEqual([[60, 1, 10], [61, 1, 11]])
        expect(keyboard.isTouching).toBe(false)
    })

    it('keeps a shared note sounding until its last finger lifts', () => {
        const { on, off, keys } = setup()
        pointer(keys[0], 'pointerdown', 10)
        pointer(keys[0], 'pointerdown', 11)
        pointer(document, 'pointerup', 10)
        expect(on).toHaveBeenCalledTimes(1)
        expect(off).not.toHaveBeenCalled()
        expect(keys[0].classList.contains('pressed')).toBe(true)
        pointer(document, 'pointerup', 11)
        expect(off.mock.calls).toEqual([[60, 1, 10]])
        expect(keys[0].classList.contains('pressed')).toBe(false)
    })

    it.each(['touch', 'pen', 'mouse'])('slides %s across keys without retriggering the same key', pointerType => {
        const { on, off, keys } = setup()
        const hit = vi.spyOn(document, 'elementFromPoint').mockReturnValue(keys[1])
        pointer(keys[0], 'pointerdown', 7, { pointerType })
        pointer(document, 'pointermove', 7, { pointerType })
        pointer(document, 'pointermove', 7, { pointerType })
        expect(on.mock.calls).toEqual([[60, 0.5, 7], [61, 0.5, 7]])
        expect(off.mock.calls).toEqual([[60, 1, 7]])
        hit.mockReturnValue(null)
        pointer(document, 'pointermove', 7, { pointerType })
        expect(off).toHaveBeenLastCalledWith(61, 1, 7)
        hit.mockReturnValue(keys[2])
        pointer(document, 'pointermove', 7, { pointerType })
        pointer(document, 'pointerup', 7, { pointerType })
        expect(on).toHaveBeenLastCalledWith(62, 0.5, 7)
        expect(off).toHaveBeenLastCalledWith(62, 1, 7)
    })

    it('uses audible fallback pressure and ignores secondary buttons', () => {
        const { on, keys } = setup()
        pointer(keys[0], 'pointerdown', 1, { button: 2, pointerType: 'mouse' })
        pointer(keys[1], 'pointerdown', 2, { pressure: 0 })
        expect(on.mock.calls).toEqual([[61, 1, 2]])
    })

    it('captures each pointer and releases capture when playing stops', () => {
        const { keyboard, keys } = setup()
        const svg = keyboard.asElement.querySelector('svg')!
        svg.setPointerCapture = vi.fn()
        svg.hasPointerCapture = vi.fn(() => true)
        svg.releasePointerCapture = vi.fn()
        pointer(keys[0], 'pointerdown', 8)
        expect(svg.setPointerCapture).toHaveBeenCalledWith(8)
        pointer(document, 'pointerup', 8)
        expect(svg.releasePointerCapture).toHaveBeenCalledWith(8)
        pointer(keys[0], 'pointerdown', 9)
        keyboard.allNotesOff()
        expect(svg.releasePointerCapture).toHaveBeenCalledWith(9)
    })

    it.each(['blur', 'visibilitychange', 'lostpointercapture'])('releases notes on %s', type => {
        const { keyboard, off, keys } = setup()
        pointer(keys[0], 'pointerdown', 3)
        if (type === 'blur') window.dispatchEvent(new Event(type))
        else if (type === 'visibilitychange') {
            vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
            document.dispatchEvent(new Event(type))
        } else pointer(keys[0], type, 3)
        expect(off).toHaveBeenCalledExactlyOnceWith(60, 1, 3)
        expect(keyboard.isTouching).toBe(false)
        pointer(document, 'pointerup', 3)
        expect(off).toHaveBeenCalledTimes(1)
    })

    it('supports Enter and Space without repeated notes or page scrolling', () => {
        const { on, off, keys } = setup()
        for (const key of ['Enter', ' ']) {
            const down = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
            keys[0].dispatchEvent(down)
            keys[0].dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, repeat: true }))
            expect(down.defaultPrevented).toBe(true)
            document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }))
        }
        expect(on).toHaveBeenCalledTimes(2)
        expect(off).toHaveBeenCalledTimes(2)
    })

    it('supports sparse note ranges and includes the full key height', () => {
        const { on, keys, keyboard } = setup([60, 64, 67])
        pointer(keys[2], 'pointerdown', 3)
        expect(on).toHaveBeenCalledWith(67, 0.5, 3)
        expect(keyboard.asElement.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 69 160')
    })

    it('uses one shared release listener regardless of keyboard size', () => {
        const listener = vi.spyOn(document, 'addEventListener')
        const { keys } = setup(Array.from({ length: 128 }, (_, i) => i))
        pointer(keys[0], 'pointerdown', 1)
        pointer(keys[1], 'pointerdown', 2)
        expect(listener.mock.calls.filter(([type]) => type === 'pointerup')).toHaveLength(1)
    })

    it('stops notes and removes event handlers when destroyed', () => {
        const { keyboard, on, off, keys } = setup()
        pointer(keys[0], 'pointerdown', 2)
        keyboard.destroy()
        pointer(keys[1], 'pointerdown', 3)
        pointer(document, 'pointerup', 2)
        expect(on).toHaveBeenCalledTimes(1)
        expect(off).toHaveBeenCalledExactlyOnceWith(60, 1, 2)
        expect(keyboard.asElement.isConnected).toBe(false)
    })

    it('moves the visible range and releases held notes before repositioning', () => {
        const { keyboard, keys, off } = setup()
        const viewport = keyboard.asElement.querySelector('.piano-viewport')!
        Object.defineProperties(viewport, { scrollWidth: { value: 1000 }, clientWidth: { value: 400 } })
        const range = keyboard.asElement.querySelector('input')!
        pointer(keys[0], 'pointerdown', 2)
        range.value = '75'
        range.dispatchEvent(new Event('input'))
        expect(viewport.scrollLeft).toBe(450)
        expect(off).toHaveBeenCalledExactlyOnceWith(60, 1, 2)
    })

    it('can detach and remount the input GUI, then dispose it', async () => {
        const container = document.body.appendChild(document.createElement('div'))
        container.id = 'onscreen-keyboard'
        const input = new InputOnScreenKeyboard()
        const gui = await input.createGui()
        const element = input.keyboardElement!
        const card = document.body.appendChild(document.createElement('div'))
        card.append(gui)
        expect(element.parentElement).toBe(container)
        await input.destroyGui()
        expect(element.isConnected).toBe(false)
        expect(await input.createGui()).toBe(gui)
        expect(element.parentElement).toBe(container)
        input.destroy()
        expect(element.isConnected).toBe(false)
        expect(input.isConnected).toBe(false)
    })

    it('returns the piano itself when no fixed container is present', async () => {
        const input = new InputOnScreenKeyboard()
        expect(await input.createGui()).toBe(input.keyboard.asElement)
        input.destroy()
    })
})
