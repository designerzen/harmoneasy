// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import KeyboardDisplayManager from '../../../packages/audiobus/ui/keyboard-display-manager'
import { addKeyboardDownEvents } from '../../../packages/audiobus/hardware/keyboard/keyboard'
import { NOTE_ON, NOTE_OFF, TEMPO_TAP, PLAYBACK_TOGGLE } from '../../../packages/audiobus/commands'
import {
    EVENT_KEY_DOWN, EVENT_KEY_UP, EVENT_POINTER_DOWN, EVENT_POINTER_UP,
    EVENT_POINTER_CANCEL, EVENT_BLUR, EVENT_VISIBILITY_CHANGE, EVENT_LOST_POINTER_CAPTURE,
} from '../../../packages/audiobus/event-constants'

const cleanup: (() => void)[] = []
function setup() {
    const command = vi.fn()
    cleanup.push(addKeyboardDownEvents(command))
    const manager = new KeyboardDisplayManager()
    cleanup.push(() => manager.destroy())
    document.body.append(manager.getElement())
    const key = (value: string) => Array.from(document.querySelectorAll('.qwerty-key'))
        .find(element => element.getAttribute('data-key-code') === value)!
    return { command, manager, key }
}
function pointer(target: EventTarget, type: string, pointerId = 1, pointerType = 'touch') {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId, pointerType, button: 0 }))
}
afterEach(() => {
    cleanup.splice(0).reverse().forEach(dispose => dispose())
    vi.restoreAllMocks()
    document.body.replaceChildren()
})

describe('interactive QWERTY display', () => {
    it.each([
        ['q', 'Q', 'KeyQ'],
        ['2', '@', 'Digit2'],
    ])('releases %s by physical key when modifiers change its character', (down, up, code) => {
        const { command, key } = setup()
        window.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: down, code }))
        window.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: up, code, repeat: true, shiftKey: true }))
        window.dispatchEvent(new KeyboardEvent(EVENT_KEY_UP, { key: up, code, shiftKey: true }))
        expect(command.mock.calls.map(call => call.slice(0, 3))).toEqual([
            [NOTE_ON, down, down === 'q' ? 41 : 42],
            [NOTE_OFF, down, down === 'q' ? 41 : 42],
        ])
        expect(key(down).classList.contains('active')).toBe(false)
    })

    it.each([EVENT_BLUR, EVENT_VISIBILITY_CHANGE, 'dispose'])('releases all physical notes on %s without duplicate note-offs', type => {
        const command = vi.fn()
        const dispose = addKeyboardDownEvents(command)
        cleanup.push(dispose)
        for (const key of ['q', 'w']) window.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key }))
        if (type === 'dispose') dispose()
        else if (type === EVENT_BLUR) window.dispatchEvent(new Event(type))
        else {
            vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
            document.dispatchEvent(new Event(type))
        }
        for (const key of ['q', 'w']) window.dispatchEvent(new KeyboardEvent(EVENT_KEY_UP, { key }))
        expect(command.mock.calls.map(call => call.slice(0, 3))).toEqual([
            [NOTE_ON, 'q', 41], [NOTE_ON, 'w', 43],
            [NOTE_OFF, 'q', 41], [NOTE_OFF, 'w', 43],
        ])
    })

    it('releases notes even when a focused control stops keyup propagation', () => {
        const { command } = setup()
        window.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: 'q', code: 'KeyQ' }))
        const input = document.body.appendChild(document.createElement('input'))
        input.focus()
        input.addEventListener(EVENT_KEY_UP, event => event.stopPropagation())
        input.dispatchEvent(new KeyboardEvent(EVENT_KEY_UP, { key: 'q', code: 'KeyQ', bubbles: true }))
        expect(command.mock.lastCall!.slice(0, 3)).toEqual([NOTE_OFF, 'q', 41])
    })

    it('does not emit a note-off for a note that was never started', () => {
        const { command } = setup()
        const input = document.body.appendChild(document.createElement('input'))
        input.focus()
        window.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: 'q', code: 'KeyQ' }))
        window.dispatchEvent(new KeyboardEvent(EVENT_KEY_UP, { key: 'q', code: 'KeyQ' }))
        expect(command).not.toHaveBeenCalled()
    })

    it.each(['mouse', 'touch', 'pen'])('plays and releases notes using %s, including releases outside the visual', pointerType => {
        const { key, command } = setup()
        const input = document.body.appendChild(document.createElement('input'))
        input.focus()
        pointer(key('q'), EVENT_POINTER_DOWN, 1, pointerType)
        expect(command.mock.calls[0].slice(0, 3)).toEqual([NOTE_ON, 'q', 41])
        expect(key('q').classList.contains('active')).toBe(true)
        pointer(document, EVENT_POINTER_UP, 1, pointerType)
        expect(command.mock.lastCall!.slice(0, 3)).toEqual([NOTE_OFF, 'q', 41])
        expect(key('q').classList.contains('active')).toBe(false)
    })

    it.each([[' ', TEMPO_TAP], ['Enter', PLAYBACK_TOGGLE]])('runs the %j shortcut again after release', (value, type) => {
        const { key, command } = setup()
        for (let i = 0; i < 2; i++) {
            pointer(key(value), EVENT_POINTER_DOWN)
            pointer(document, EVENT_POINTER_UP)
        }
        expect(command.mock.calls.map(call => call.slice(0, 2))).toEqual([[type, value], [type, value]])
    })

    it('sends the standard Space code to global shortcut listeners', () => {
        const { key } = setup()
        const listener = vi.fn()
        window.addEventListener(EVENT_KEY_DOWN, listener, { capture: true, once: true })
        pointer(key(' '), EVENT_POINTER_DOWN)
        expect(listener.mock.calls[0][0]).toMatchObject({ key: ' ', code: 'Space' })
    })

    it('holds separate notes and releases a shared key only after the last touch', () => {
        const { key, command } = setup()
        pointer(key('q'), EVENT_POINTER_DOWN, 1)
        pointer(key('q'), EVENT_POINTER_DOWN, 2)
        pointer(key('w'), EVENT_POINTER_DOWN, 3)
        pointer(document, EVENT_POINTER_UP, 1)
        expect(command.mock.calls.map(call => call[0])).toEqual([NOTE_ON, NOTE_ON])
        pointer(document, EVENT_POINTER_UP, 2)
        pointer(document, EVENT_POINTER_UP, 3)
        expect(command.mock.calls.map(call => call[0])).toEqual([NOTE_ON, NOTE_ON, NOTE_OFF, NOTE_OFF])
    })

    it.each([EVENT_POINTER_CANCEL, EVENT_BLUR, EVENT_VISIBILITY_CHANGE, EVENT_LOST_POINTER_CAPTURE, 'destroy'])('releases held notes on %s', type => {
        const { key, command, manager } = setup()
        pointer(key('q'), EVENT_POINTER_DOWN)
        if (type === EVENT_BLUR) window.dispatchEvent(new Event(type))
        else if (type === EVENT_VISIBILITY_CHANGE) {
            vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
            document.dispatchEvent(new Event(type))
        } else if (type === 'destroy') manager.destroy()
        else pointer(key('q'), type)
        pointer(document, EVENT_POINTER_UP)
        expect(command.mock.calls.map(call => call[0])).toEqual([NOTE_ON, NOTE_OFF])
    })

    it('highlights both modifier keys and special keys for physical keyboard input', () => {
        const { key } = setup()
        for (const value of ['Shift', 'Enter', 'Backspace', 'Tab']) {
            window.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: value }))
            const keys = Array.from(document.querySelectorAll('.qwerty-key')).filter(element => element.getAttribute('data-key-code') === value)
            expect(keys.every(element => element.classList.contains('active'))).toBe(true)
            window.dispatchEvent(new KeyboardEvent(EVENT_KEY_UP, { key: value }))
            expect(key(value).classList.contains('active')).toBe(false)
        }
    })

    it('removes pointer handlers when destroyed', () => {
        const { key, command, manager } = setup()
        manager.destroy()
        pointer(key('q'), EVENT_POINTER_DOWN)
        expect(command).not.toHaveBeenCalled()
    })
})
