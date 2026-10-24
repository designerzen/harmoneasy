// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createCommandPalette } from '../source/services/command-palette'
import {
    EVENT_BLUR, EVENT_CHANGE, EVENT_CLICK, EVENT_CLOSE,
    EVENT_INPUT, EVENT_KEY_DOWN, EVENT_KEY_UP, EVENT_SUBMIT,
} from '../../../packages/audiobus/event-constants'

const markup = readFileSync(resolve('index.html'), 'utf8')
let lifetime: AbortController
const palette = () => document.querySelector<HTMLDialogElement>('#command-palette')!
const search = () => document.querySelector<HTMLInputElement>('#command-search')!
const value = () => document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('#command-value')!
const status = () => document.getElementById('command-status')!.textContent
const rows = () => [...document.querySelectorAll<HTMLElement>('#command-results [role="option"]')]
const key = (key: string, target: EventTarget = search(), modifiers = {}) => {
    const event = new KeyboardEvent(EVENT_KEY_DOWN, { key, bubbles: true, cancelable: true, ...modifiers })
    target.dispatchEvent(event)
    return event
}
const find = (query: string) => {
    search().value = query
    search().dispatchEvent(new Event(EVENT_INPUT, { bubbles: true }))
}
const apply = () => document.querySelector('#command-editor')!.dispatchEvent(new Event(EVENT_SUBMIT, { bubbles: true, cancelable: true }))

beforeEach(() => {
    lifetime = new AbortController()
    const page = new DOMParser().parseFromString(markup, 'text/html')
    document.body.replaceChildren(page.querySelector('#command-palette')!.cloneNode(true))
    document.body.insertAdjacentHTML('beforeend', `<button id="btn-command-palette">Commands</button>
        <label for="tempo">Tempo</label><input id="tempo" type="range" min="10" max="303" value="120">
        <label>Scale <select id="scale"><option value="major">Major</option><option value="minor">Minor</option><option disabled value="none">Disabled</option></select></label>
        <label><input id="enabled" type="checkbox">Enable metronome</label>
        <button id="play" title="Start playback">Play</button>`)
})
afterEach(() => { lifetime.abort(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('command palette', () => {
    it('opens with Ctrl+K, Cmd+K and the button, filters and navigates results, and restores focus', () => {
        const trigger = document.getElementById('btn-command-palette')!
        trigger.focus()
        createCommandPalette(document, lifetime.signal)
        expect(key('k', trigger, { ctrlKey: true }).defaultPrevented).toBe(true)
        expect(palette().open).toBe(true)
        expect(document.activeElement).toBe(search())
        expect(rows()).toHaveLength(4)
        key('ArrowDown')
        expect(search().getAttribute('aria-activedescendant')).toBe(rows()[1].id)
        key('ArrowUp')
        key('ArrowUp')
        expect(rows().at(-1)!.getAttribute('aria-selected')).toBe('true')
        find('minor')
        expect(rows()).toHaveLength(1)
        expect(rows()[0].textContent).toContain('Scale')
        find('no such command')
        expect(rows()).toHaveLength(0)
        expect(search().hasAttribute('aria-activedescendant')).toBe(false)
        expect(status()).toContain('No matching commands')
        key('Enter')
        key('Escape')
        expect(palette().open).toBe(false)
        palette().dispatchEvent(new Event(EVENT_CLOSE))
        expect(document.activeElement).toBe(trigger)
        key('K', trigger, { metaKey: true })
        expect(palette().open).toBe(true)
        key('k', search(), { metaKey: true, repeat: true })
        expect(palette().open).toBe(true)
        key('k', search(), { metaKey: true })
        expect(palette().open).toBe(false)
        trigger.click()
        expect(palette().open).toBe(true)
    })

    it('edits numeric values in their original units and preserves validation and native handlers', () => {
        const input = document.querySelector<HTMLInputElement>('#tempo')!
        const onInput = vi.fn(), onChange = vi.fn()
        input.addEventListener(EVENT_INPUT, onInput)
        input.addEventListener(EVENT_CHANGE, onChange)
        createCommandPalette(document, lifetime.signal)()
        find('tempo')
        key('Enter')
        const editor = value() as HTMLInputElement
        expect(editor.type).toBe('number')
        expect(editor.value).toBe('120')
        editor.value = '999'
        apply()
        expect(input.value).toBe('120')
        editor.value = '138'
        apply()
        expect(input.value).toBe('138')
        expect(onInput).toHaveBeenCalledTimes(1)
        expect(onChange).toHaveBeenCalledTimes(1)
        expect(status()).toContain('Tempo updated to 138')
        expect(palette().open).toBe(true)
    })

    it('changes selects and toggles through existing events and closes before running an action', () => {
        const change = vi.fn()
        document.getElementById('scale')!.addEventListener(EVENT_CHANGE, change)
        const play = vi.fn(() => expect(palette().open).toBe(false))
        document.getElementById('play')!.addEventListener(EVENT_CLICK, play)
        const open = createCommandPalette(document, lifetime.signal)
        open()
        find('scale')
        rows()[0].click()
        value().value = 'minor'
        apply()
        expect((document.getElementById('scale') as HTMLSelectElement).value).toBe('minor')
        expect(change).toHaveBeenCalledTimes(1)
        find('metronome')
        key('Enter')
        expect((document.getElementById('enabled') as HTMLInputElement).checked).toBe(true)
        open()
        find('playback')
        key('Enter')
        expect(play).toHaveBeenCalledTimes(1)
    })

    it('discovers new device controls with nested labels and context and skips unavailable controls', () => {
        const open = createCommandPalette(document, lifetime.signal)
        open()
        document.body.insertAdjacentHTML('beforeend', `<section data-midi-label="Synth">
            <label><span>Cutoff</span><input type="number" value="440"><small>Help text</small></label></section>
            <fieldset disabled><input aria-label="Disabled"></fieldset>
            <input type="hidden" aria-label="Hidden"><input type="file" aria-label="File"><input type="password" aria-label="Secret">
            <input readonly aria-label="Read only"><button style="display:none">Invisible</button>
            <div hidden><button>Hidden ancestor</button></div><dialog><button>Closed dialog</button></dialog>`)
        find('synth cutoff')
        expect(rows()).toHaveLength(1)
        expect(rows()[0].textContent).not.toContain('Help text')
        find('')
        expect(rows().map(row => row.querySelector('strong')!.textContent)).toEqual(['Tempo', 'Scale', 'Enable metronome', 'Start playback', 'Cutoff'])
        find('cutoff')
        key('Enter')
        document.querySelector('[data-midi-label]')!.remove()
        value().value = '800'
        apply()
        expect(status()).toContain('no longer available')
    })

    it('restricts commands to the originating dialog and supports text fields that commit on blur', () => {
        document.body.insertAdjacentHTML('beforeend', '<dialog open><label>Name <input id="name" value="Original"></label></dialog>')
        const input = document.getElementById('name') as HTMLInputElement
        const blur = vi.fn()
        input.addEventListener(EVENT_BLUR, blur)
        input.focus()
        createCommandPalette(document, lifetime.signal)()
        expect(rows()).toHaveLength(1)
        key('Enter')
        value().value = '<script>just text</script>'
        apply()
        expect(input.value).toBe('<script>just text</script>')
        expect(blur).toHaveBeenCalled()
        expect(document.querySelector('script')).toBeNull()
    })

    it('keeps palette typing out of the musical keyboard and ignores composition and unrelated shortcuts', () => {
        createCommandPalette(document, lifetime.signal)
        key('k', window, { altKey: true, ctrlKey: true })
        key('k', window, { ctrlKey: true, isComposing: true })
        expect(palette().open).toBe(false)
        key('k', window, { ctrlKey: true })
        const down = vi.fn(), up = vi.fn()
        window.addEventListener(EVENT_KEY_DOWN, down, { signal: lifetime.signal })
        window.addEventListener(EVENT_KEY_UP, up, { signal: lifetime.signal })
        key('a')
        search().dispatchEvent(new KeyboardEvent(EVENT_KEY_UP, { key: 'a', bubbles: true }))
        expect(down).not.toHaveBeenCalled()
        expect(up).not.toHaveBeenCalled()
        find('tempo')
        key('Enter', search(), { isComposing: true })
        expect(value()).toBeNull()
    })

    it('updates React controlled selects, text fields and blur handlers', async () => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
        const host = document.createElement('div')
        document.body.append(host)
        const reactRoot = createRoot(host)
        const change = vi.fn(), blur = vi.fn(), textChange = vi.fn()
        await act(async () => reactRoot.render(React.createElement('div', {},
            React.createElement('select', { 'aria-label': 'Preset', value: 'a', onChange: change },
                React.createElement('option', { value: 'a' }, 'A'), React.createElement('option', { value: 'b' }, 'B')),
            React.createElement('input', { 'aria-label': 'Chain name', value: 'Old', onChange: textChange, onBlur: blur }))))
        createCommandPalette(document, lifetime.signal)()
        find('preset')
        key('Enter')
        value().value = 'b'
        await act(async () => apply())
        expect(change).toHaveBeenCalledTimes(1)
        find('chain name')
        key('Enter')
        value().value = 'New'
        await act(async () => apply())
        expect(textChange).toHaveBeenCalledTimes(1)
        expect(blur).toHaveBeenCalledTimes(1)
        await act(async () => reactRoot.unmount())
    })

    it('rejects stale select choices and releases hotkeys when its lifetime ends', () => {
        createCommandPalette(document, lifetime.signal)()
        find('scale')
        key('Enter')
        value().value = 'minor'
        document.querySelector<HTMLOptionElement>('#scale option[value="minor"]')!.disabled = true
        apply()
        expect(status()).toContain('no longer available')
        expect((document.getElementById('scale') as HTMLSelectElement).value).toBe('major')
        palette().close()
        lifetime.abort()
        key('k', window, { ctrlKey: true })
        expect(palette().open).toBe(false)
    })

    it('distinguishes identical actions by chain and device names', () => {
        document.body.insertAdjacentHTML('beforeend', `<section id="iochain-one" aria-label="Lead">
            <div data-midi-scope="lead:synth"><header><h6>Synth</h6></header><button>Remove output</button></div>
            <div data-midi-scope="lead:drums"><header><h6>Drums</h6></header><button>Remove output</button></div></section>`)
        createCommandPalette(document, lifetime.signal)()
        find('lead synth remove')
        expect(rows()).toHaveLength(1)
        expect(rows()[0].textContent).toContain('Lead / Synth')
    })
})
