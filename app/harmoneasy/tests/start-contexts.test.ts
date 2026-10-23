// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { act } from 'react'
import { completePresets, presetSetup, ACTIVITY_PRESETS } from '../source/components/graph/preset-catalogue'
import startPage from '../index.html?raw'
import { DEFAULT_PRESET_LIBRARY } from '../../../packages/audiobus/io/transformer-presets'
import { parsePresetLibrary } from '../../../packages/audiobus/io/preset-library'
import { DRUM_GENRES } from '../../../packages/audiobus/io/outputs/drum-accompaniment-settings'
import { DRUM_GROOVES } from '../../../packages/audiobus/timing/drum-patterns'
import { createContextSetup, createEmptySetup, createStartContexts, START_CONTEXTS, START_SUGGESTIONS } from '../source/services/start-contexts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => document.body.replaceChildren())

it('shares every activity and factory preset with the browser, including older saved libraries', () => {
    const presets = completePresets([])
    expect(presets).toHaveLength(DEFAULT_PRESET_LIBRARY.presets.length + START_CONTEXTS.length)
    for (const context of START_CONTEXTS) {
        const preset = presets.find(item => item.id === `activity:${context.id}`)!
        expect(preset.description).toBe(context.description)
        expect(preset.useCase).toBe(context.next)
        expect(presetSetup(preset)).toEqual(createContextSetup(context))
    }
    expect(ACTIVITY_PRESETS.find(item => item.id === 'activity:drum-and-bass')!.useCase).toContain('170 BPM')
})

it('uses the same preset browser on the splash and retains the selected sound setup', async () => {
    document.body.innerHTML = startPage.match(/<dialog id="start-dialog"[\s\S]*?<\/dialog>/)![0]
    const root = document.querySelector<HTMLElement>('#start-dialog')!
    let picker: ReturnType<typeof createStartContexts>
    await act(async () => { picker = createStartContexts(root) })
    const browser = document.querySelector<HTMLDialogElement>('.preset-browser')!
    expect(browser).toBeTruthy()
    const card = [...browser.querySelectorAll<HTMLButtonElement>('nav button')].find(button => button.textContent?.includes('Write drum and bass'))!
    await act(async () => { card.click() })
    expect(browser.querySelector('.preset-preview')!.textContent).toContain('170 BPM')
    expect(browser.querySelector('.preset-preview')!.textContent).toContain('Moog + Drum Accompaniment')
    await act(async () => { browser.querySelector<HTMLButtonElement>('.preset-apply-button')!.click() })
    expect(picker!.getSetup()?.id).toBe('drum-and-bass')
    expect(root.querySelector<HTMLButtonElement>('.btn-start-preset')!.disabled).toBe(false)
})

it('covers the percussion genres with valid grooves and connected sound outputs', () => {
    const covered = new Set<string>()
    for (const context of START_CONTEXTS.filter(context => context.category === 'Genres' && context.id !== 'ambient')) {
        const setup = createContextSetup(context)
        const drums = setup.devices.find(device => device.definition.type === 'drum-accompaniment')!
        expect(drums, context.name).toBeDefined()
        const { genre, groove } = drums.definition.options!
        expect(DRUM_GENRES[genre as keyof typeof DRUM_GENRES].grooves as readonly string[]).toContain(groove)
        expect(DRUM_GROOVES[groove]).toBeDefined()
        expect(setup.chains[0].outputs).toContain(drums.id)
        if (genre !== 'percussion') {
            expect(setup.devices.some(device => device.id === 'synth' && device.id !== drums.id)).toBe(true)
        }
        covered.add(genre)
    }
    expect([...covered].sort()).toEqual(Object.keys(DRUM_GENRES).filter(genre => genre !== 'transitions').sort())
})

it('starts each genre with its sound output and independent settings', () => {
    for (const [id, type] of [['acid-house', 'tb303'], ['techno', 'moog'], ['dub', 'webclap:com.plinken.organ'], ['disco', 'webclap:com.plinken.piano']]) {
        const setup = createContextSetup(START_CONTEXTS.find(context => context.id === id)!)
        expect(setup.devices.find(device => device.id === 'synth')!.definition).toEqual({ factory: 'output', type })
        expect(setup.chains[0].outputs).toContain('synth')
        const drums = setup.devices.find(device => device.definition.type === 'drum-accompaniment')!
        expect(drums.definition).toEqual({ factory: 'output', type: 'drum-accompaniment',
            options: id === 'dub' ? { genre: 'reggae', groove: 'reggae' } : { genre: 'electronic', groove: 'disco' } })
        expect(setup.chains[0].outputs).toContain(drums.id)
    }
    const ambient = START_CONTEXTS.find(context => context.id === 'ambient')!
    const pad = createContextSetup(ambient).devices.find(device => device.id === 'synth')!.definition
    expect(pad.factory).toBe('polyphonic')
    expect(createContextSetup(ambient).devices.some(device => device.definition.type === 'drum-accompaniment')).toBe(false)
    expect(pad.options).toMatchObject({ shape: 'triangle', attack: 0.8, release: 3, filterCutOff: 1200 })
    pad.options!.release = 0
    expect(createContextSetup(ambient).devices.find(device => device.id === 'synth')!.definition.options!.release).toBe(3)
    expect(createEmptySetup().devices.find(device => device.id === 'synth')!.definition).toEqual({ factory: 'polyphonic' })
})

it('keeps startup actions outside the collapsed shared browser launcher', async () => {
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
    expect(details.querySelector('.start-presets-content')).toBeTruthy()
    const actions = dialog.querySelector('.start-preset-actions')!
    expect(details.contains(actions)).toBe(false)
    expect(actions.querySelector<HTMLButtonElement>('.btn-start-preset')!.value).toBe('preset')
    expect(actions.contains(document.getElementById('start-context-selection'))).toBe(true)
    await act(async () => { createStartContexts(dialog) })
    expect(dialog.querySelectorAll('button[value="session"]')).toHaveLength(1)
    expect(details.querySelector('input[value=""]')).toBeNull()
    expect(details.textContent).not.toContain('Continue your session')
    expect(details.querySelector('button')!.textContent).toBe('Browse all presets…')
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

it('keeps every goal suggestion mapped to available activity presets', () => {
    for (const suggestion of START_SUGGESTIONS) {
        expect(suggestion.contexts.every(id => ACTIVITY_PRESETS.some(preset => preset.id === `activity:${id}`))).toBe(true)
    }
})

it('searches the shared browser by activity descriptions and next actions', async () => {
    document.body.innerHTML = startPage.match(/<dialog id="start-dialog"[\s\S]*?<\/dialog>/)![0]
    const root = document.querySelector<HTMLElement>('#start-dialog')!
    let picker: ReturnType<typeof createStartContexts>
    await act(async () => { picker = createStartContexts(root) })
    expect(picker!.getSetup()).toBeUndefined()
    const search = document.querySelector<HTMLInputElement>('.preset-search input')!
    await act(async () => { search.value = 'classroom'; search.dispatchEvent(new Event('input', { bubbles: true })) })
    const cards = [...document.querySelectorAll<HTMLButtonElement>('.preset-browser nav button')]
    expect(cards.length).toBeGreaterThan(0)
    expect(cards.every(card => card.textContent!.toLowerCase().includes('classroom'))).toBe(true)
    const classroom = cards.find(card => card.textContent!.includes('Synchronise a classroom'))!
    await act(async () => { classroom.click() })
    expect(document.querySelector('.preset-preview')!.textContent).toContain('use Sync')
    await act(async () => { document.querySelector<HTMLButtonElement>('.preset-apply-button')!.click() })
    expect(picker!.getSetup()?.id).toBe('classroom')
})

it('starts factory genre presets with the same sound outputs as their activity presets', () => {
    for (const preset of DEFAULT_PRESET_LIBRARY.presets.filter(item => item.category === 'Genres')) {
        const context = START_CONTEXTS.find(item => item.category === 'Genres' && item.presets.includes(preset.id))!
        expect(context, preset.name).toBeDefined()
        const setup = presetSetup(preset)
        const expected = createContextSetup(context)
        expect(setup.devices).toEqual(expected.devices)
        expect(setup.chains[0].outputs).toEqual(expected.chains[0].outputs)
        expect(setup.chains[0].steps).toEqual(preset.steps)
        expect(setup.chains[0].options.name).toBe(preset.name)
    }
})
