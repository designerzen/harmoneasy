// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { EVENT_CHANGE, EVENT_CLICK, EVENT_INPUT } from '../../../packages/audiobus/event-constants'
import { createThemeControls, THEME_PRESETS, THEME_STORAGE_KEY } from '../source/services/theme'

let dispose: (() => void) | undefined
afterEach(() => {
    dispose?.()
    vi.restoreAllMocks()
    localStorage.clear()
    document.body.replaceChildren()
    document.documentElement.removeAttribute('style')
    delete document.documentElement.dataset.themeMode
})
function setup() {
    const html = readFileSync('index.html', 'utf8')
    document.body.innerHTML = html.slice(html.indexOf('<fieldset id="theme-settings">'), html.indexOf('</fieldset>', html.indexOf('<fieldset id="theme-settings">')) + 11)
    dispose = createThemeControls(document)
    return {
        preset: document.querySelector<HTMLSelectElement>('#theme-preset')!,
        mode: document.querySelector<HTMLSelectElement>('#theme-mode')!,
        hue: document.querySelector<HTMLInputElement>('#theme-hue')!
    }
}
describe('Browser-local appearance', () => {
    it('starts with system brightness and renders all hue presets without writing storage', () => {
        const { preset, mode } = setup()
        expect(mode.value).toBe('system')
        expect(preset.options.length).toBe(THEME_PRESETS.length + 1)
        expect(document.documentElement.style.getPropertyValue('--theme-hue')).toBe('290')
        expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
    })
    it('applies custom hue immediately, stores only hue and mode, and restores them on reload', () => {
        const originalUrl = location.href
        const { hue, mode } = setup()
        hue.value = '217'
        hue.dispatchEvent(new Event(EVENT_INPUT))
        mode.value = 'dark'
        mode.dispatchEvent(new Event(EVENT_CHANGE))
        expect(document.documentElement.dataset.themeMode).toBe('dark')
        expect(document.querySelector<HTMLOutputElement>('#theme-hue-value')!.value).toBe('217°')
        expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('{"hue":217,"mode":"dark"}')
        expect(location.href).toBe(originalUrl)
        dispose?.()
        const restored = setup()
        expect(restored.hue.value).toBe('217')
        expect(restored.mode.value).toBe('dark')
        expect(restored.preset.value).toBe('custom')
    })
    it('supports preset changes, system mode, and reset without touching other settings', () => {
        localStorage.setItem('unrelated-setting', 'keep')
        const { preset, mode } = setup()
        preset.value = '145'
        preset.dispatchEvent(new Event(EVENT_CHANGE))
        expect(document.documentElement.style.getPropertyValue('--theme-hue')).toBe('145')
        mode.value = 'light'
        mode.dispatchEvent(new Event(EVENT_CHANGE))
        mode.value = 'system'
        mode.dispatchEvent(new Event(EVENT_CHANGE))
        expect(document.documentElement.dataset.themeMode).toBe('system')
        document.getElementById('theme-reset')!.dispatchEvent(new Event(EVENT_CLICK))
        expect(preset.value).toBe('290')
        expect(localStorage.getItem('unrelated-setting')).toBe('keep')
        expect(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY)!)).toEqual({ hue: 290, mode: 'system' })
    })
    it.each(['{broken', 'null', '{"hue":-1,"mode":"invalid"}', '{"hue":"42","mode":null}', '{"hue":1e999,"mode":"invalid"}'])(
        'recovers safely from invalid preferences: %s', value => {
            localStorage.setItem(THEME_STORAGE_KEY, value)
            const { hue, mode } = setup()
            expect(hue.value).toBe('290')
            expect(mode.value).toBe('system')
        })
    it('continues applying themes when local storage is blocked', () => {
        vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('blocked') })
        const { preset } = setup()
        preset.value = '75'
        expect(() => preset.dispatchEvent(new Event(EVENT_CHANGE))).not.toThrow()
        expect(document.documentElement.style.getPropertyValue('--theme-hue')).toBe('75')
        expect(document.getElementById('theme-status')!.textContent).toContain('unavailable')
    })
})
