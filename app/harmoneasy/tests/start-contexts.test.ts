// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import startPage from '../index.html?raw'
import { DEFAULT_PRESET_LIBRARY } from '../../../packages/audiobus/io/transformer-presets'
import { parsePresetLibrary } from '../../../packages/audiobus/io/preset-library'
import { createContextSetup, createEmptySetup, createStartContexts, START_CONTEXTS, START_SUGGESTIONS } from '../source/services/start-contexts'

afterEach(() => document.body.replaceChildren())

it('finds acid house in the presets panel and filters the existing cards by genre', () => {
    document.body.innerHTML = startPage.match(/<dialog id="start-dialog"[\s\S]*?<\/dialog>/)![0]
    const root = document.querySelector<HTMLElement>('#start-dialog')!
    const picker = createStartContexts(root)
    const search = root.querySelector<HTMLInputElement>('#start-context-filter')!
    search.value = 'acid'
    search.dispatchEvent(new Event('input'))
    const visible = () => [...root.querySelectorAll<HTMLLabelElement>('#start-context-list label:not([hidden])')]
    expect(visible()).toHaveLength(1)
    expect(visible()[0].textContent).toContain('Write acid house')
    visible()[0].querySelector('input')!.click()
    expect(picker.getSetup()?.chains[0].steps).toEqual(DEFAULT_PRESET_LIBRARY.presets.find(preset => preset.id === 'acid-house')!.steps)
    expect(root.querySelector<HTMLButtonElement>('.btn-start-preset')!.disabled).toBe(false)
    const genres = [...root.querySelectorAll<HTMLButtonElement>('#start-context-suggestions button')].find(button => button.textContent === 'Genres')!
    genres.click()
    expect(genres.getAttribute('aria-pressed')).toBe('true')
    expect(visible()).toHaveLength(5)
    expect(visible().every(card => card.dataset.category === 'Genres')).toBe(true)
})

it('keeps the preset chooser collapsed and contains its controls inside the start dialog', () => {
    document.body.innerHTML = startPage
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    const dialog = document.querySelector<HTMLDialogElement>('#start-dialog')!
    const details = dialog.querySelector<HTMLDetailsElement>('#start-contexts')!
    expect(details.open).toBe(false)
    expect(details.querySelector('.start-presets-label')!.textContent).toBe('Presets')
    expect(details.querySelector('summary')!.textContent).toContain('Browse ready-made setups')
    expect(dialog.querySelectorAll('[autofocus]')).toHaveLength(1)
    expect(dialog.querySelector('[autofocus]')).toBe(dialog.querySelector('.btn-start-empty'))
    const empty = dialog.querySelector<HTMLButtonElement>('.btn-start-empty')!
    expect(empty.querySelector('.start-action-label')!.textContent).toBe('Start Empty')
    expect(empty.value).toBe('empty')
    expect(empty.form?.id).toBe('start-form')
    expect(details.contains(empty)).toBe(false)
    const continueSession = dialog.querySelector<HTMLButtonElement>('.btn-continue-session')!
    expect(continueSession.querySelector('.start-action-label')!.textContent).toBe('Continue Session')
    expect(continueSession.value).toBe('session')
    expect(continueSession.form).toBe(empty.form)
    expect(continueSession.parentElement).toBe(empty.parentElement)
    expect(details.contains(continueSession)).toBe(false)
    for (const id of ['start-context-list', 'start-context-suggestions', 'start-context-filter', 'start-context-category']) {
        expect(details.contains(document.getElementById(id))).toBe(true)
    }
    const actions = dialog.querySelector('.start-preset-actions')!
    expect(details.contains(actions)).toBe(false)
    expect(actions.querySelector<HTMLButtonElement>('.btn-start-preset')!.value).toBe('preset')
    expect(actions.contains(document.getElementById('start-context-selection'))).toBe(true)
    createStartContexts(dialog)
    expect(dialog.querySelectorAll('button[value="session"]')).toHaveLength(1)
    expect(details.querySelector('input[value=""]')).toBeNull()
    expect(details.textContent).not.toContain('Continue your session')
    expect(details.querySelectorAll('#start-context-list input')).toHaveLength(START_CONTEXTS.length)
    dialog.querySelector<HTMLInputElement>('input[value="live"]')!.click()
    expect(actions.querySelector('.btn-start-preset')!.textContent).toBe('Start Preset')
    expect(createEmptySetup().chains[0].steps).toEqual([])
    expect(createEmptySetup().chains[0].options.name).toBe('Chain 1')
})

it('provides restorable contexts with valid routing and independent transformer settings', () => {
    expect(START_CONTEXTS.length).toBeGreaterThanOrEqual(40)
    expect(new Set(START_CONTEXTS.map(context => context.id)).size).toBe(START_CONTEXTS.length)
    for (const context of START_CONTEXTS) {
        const setup = createContextSetup(context)
        expect(() => parsePresetLibrary(JSON.stringify({ ...DEFAULT_PRESET_LIBRARY, setups: [setup] }))).not.toThrow()
        expect(setup.chains[0].inputs).toEqual(['computer-keyboard', 'keyboard'])
        expect(setup.chains[0].outputs).toContain('synth')
    }
    const live = START_CONTEXTS.find(context => context.id === 'live')!
    const first = createContextSetup(live)
    first.chains[0].steps[0].config.root = 9
    expect(createContextSetup(live).chains[0].steps[0].config.root).toBe(0)
    expect(createContextSetup(START_CONTEXTS.find(context => context.id === 'convert')!).chains[0].steps).toEqual([])
})

it('filters only presets, starts without a selection and retains selection when hidden', () => {
    document.body.innerHTML = startPage.match(/<dialog id="start-dialog"[\s\S]*?<\/dialog>/)![0]
    const root = document.querySelector<HTMLElement>('#start-dialog')!
    const picker = createStartContexts(root)
    expect(picker.getSetup()).toBeUndefined()
    const search = root.querySelector<HTMLInputElement>('#start-context-filter')!
    search.value = 'classroom'
    search.dispatchEvent(new Event('input'))
    expect(root.querySelectorAll('#start-context-list label:not([hidden])').length).toBeGreaterThanOrEqual(1)
    root.querySelector<HTMLInputElement>('input[value="classroom"]')!.click()
    expect(picker.getSetup()?.name).toBe('Synchronise a classroom')
    expect(root.querySelector('#start-context-selection')!.textContent).toContain('Synchronise a classroom')
    expect(root.querySelector<HTMLInputElement>('input[value="classroom"]')!.closest('label')!.querySelector('.start-context-next')!.textContent).toContain('use Sync')
    const category = root.querySelector<HTMLSelectElement>('#start-context-category')!
    category.value = 'Files'
    category.dispatchEvent(new Event('change'))
    expect(root.querySelector('#start-context-count')!.textContent).toContain('No matching contexts')
    expect(picker.getSetup()?.id).toBe('classroom')
    expect(root.querySelector('input[value=""]')).toBeNull()
})

it('suggests concrete starting points by goal and lets people return to searching everything', () => {
    document.body.innerHTML = startPage.match(/<dialog id="start-dialog"[\s\S]*?<\/dialog>/)![0]
    const root = document.querySelector<HTMLElement>('#start-dialog')!
    const picker = createStartContexts(root)
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('#start-context-suggestions button')]
    expect(buttons).toHaveLength(START_SUGGESTIONS.length + 1)
    for (const [index, suggestion] of START_SUGGESTIONS.entries()) {
        expect(suggestion.contexts.every(id => START_CONTEXTS.some(context => context.id === id))).toBe(true)
        buttons[index + 1].click()
        expect(buttons[index + 1].getAttribute('aria-pressed')).toBe('true')
        const visible = [...root.querySelectorAll<HTMLInputElement>('#start-context-list label:not([hidden]) input')].map(input => input.value).filter(Boolean)
        expect(visible.sort()).toEqual([...suggestion.contexts].sort())
        expect(picker.getSetup()).toBeUndefined()
    }
    root.querySelector<HTMLInputElement>('input[value="offbeat"]')!.click()
    buttons[0].click()
    expect(root.querySelectorAll('#start-context-list label:not([hidden])')).toHaveLength(START_CONTEXTS.length)
    expect(picker.getSetup()?.id).toBe('offbeat')
    buttons[1].click()
    const search = root.querySelector<HTMLInputElement>('#start-context-filter')!
    search.value = 'tracker'
    search.dispatchEvent(new Event('input'))
    expect(buttons[1].getAttribute('aria-pressed')).toBe('false')
    expect(root.querySelector<HTMLInputElement>('input[value="tracker-to-midi"]')!.closest('label')!.hidden).toBe(false)
})
