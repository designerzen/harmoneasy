// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChainSidebar } from '../source/components/graph/ChainSidebar'
import { TransformerPicker } from '../source/components/graph/Transformers'

const mocks = vi.hoisted(() => ({
    input: vi.fn(), output: vi.fn(), instrument: vi.fn(), addDevice: vi.fn(), appendTransformer: vi.fn(),
    inputs: vi.fn(), outputs: vi.fn(), instruments: vi.fn()
}))
vi.mock('../source/components/graph/ChainContext', () => {
    const context = {
    chainId: 'lead',
    chain: { inputManager: { getAvailableFactories: mocks.inputs }, outputManager: { getAvailableFactories: mocks.outputs }, appendTransformer: mocks.appendTransformer },
    manager: { devices: [], deviceOptions: { clock: 'test' }, outputMixer: { context: 'audio' }, addDevice: mocks.addDevice }
    }
    return { useChain: () => context }
})
vi.mock('audiobus/io/input-factory', () => ({ createInputById: mocks.input }))
vi.mock('audiobus/io/output-factory', () => ({ createOutputById: mocks.output }))
vi.mock('audiobus/instruments/instrument-factory-ui.ts', () => ({
    getAvailableInstrumentFactories: mocks.instruments,
    createInstrumentById: mocks.instrument
}))
vi.mock('audiobus/io/transformer-factory', async importOriginal => ({
    ...await importOriginal<typeof import('audiobus/io/transformer-factory')>(),
    TRANSFORMERS: ['Transposer', 'Harmoniser'], tranformerFactory: (type: string) => ({ type })
}))

let root: Root
const tab = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button => button.textContent === label)!
const panel = () => document.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!
const choose = async (label: string) => { await act(async () => { tab(label).click() }) }
const add = async (name: string) => {
    const button = [...panel().querySelectorAll('li > button')].find(button => button.textContent === name) as HTMLButtonElement
    await act(async () => { button.click() })
}
beforeEach(async () => {
    vi.clearAllMocks()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    mocks.inputs.mockResolvedValue([
        { id: 'keyboard', name: 'Keyboard', description: 'Computer keys' },
        { id: 'gamepad', name: 'Gamepad', description: 'Controller' }
    ])
    mocks.outputs.mockResolvedValue([{ id: 'webmidi', name: 'MIDI output', description: 'External device' }])
    mocks.instruments.mockReset().mockReturnValue([{ id: 'piano', name: 'Piano', description: 'Acoustic instrument' }])
    mocks.input.mockResolvedValue({ name: 'Created input' })
    mocks.output.mockResolvedValue({ name: 'Created output' })
    mocks.instrument.mockResolvedValue({ name: 'Created instrument' })
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => { root.render(<ChainSidebar />) })
})
afterEach(async () => {
    await act(async () => root.unmount())
    document.body.replaceChildren()
    vi.unstubAllGlobals()
})

it('switches panels with keyboard navigation and returns focus when closed', async () => {
    await choose('Inputs')
    await act(async () => { tab('Inputs').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
    expect(tab('Transformers').getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tab('Transformers'))
    expect(panel().getAttribute('aria-labelledby')).toBe(tab('Transformers').id)
    await act(async () => { panel().querySelector<HTMLButtonElement>('[aria-label="Close sidebar"]')!.click() })
    expect(document.querySelector('[role="tabpanel"]:not([hidden])')).toBeNull()
    expect(document.activeElement).toBe(tab('Transformers'))
})

it('filters inputs and adds a device to the current chain using its device options', async () => {
    await choose('Inputs')
    const search = panel().querySelector('input')!
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'computer')
        search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(panel().querySelectorAll('li > button')).toHaveLength(1)
    await add('Keyboard')
    expect(mocks.input).toHaveBeenCalledWith('keyboard', { clock: 'test' })
    expect(mocks.addDevice).toHaveBeenCalledWith(expect.anything(), { name: 'Created input' }, 'input')
})

it('adds transformers, outputs and instruments through their respective factories', async () => {
    await choose('Transformers')
    await add('Harmoniser')
    expect(mocks.appendTransformer).toHaveBeenCalledWith({ type: 'Harmoniser' })
    await choose('Outputs')
    await add('MIDI output')
    expect(mocks.output).toHaveBeenCalledWith('webmidi', { mixer: { context: 'audio' }, audioContext: 'audio' })
    await add('Piano')
    expect(mocks.instrument).toHaveBeenCalledWith('audio', 'piano', expect.objectContaining({ mixer: { context: 'audio' } }))
    expect(mocks.addDevice).toHaveBeenLastCalledWith(expect.anything(), { name: 'Created instrument' }, 'output')
})

it('keeps outputs usable when the instrument catalog fails', async () => {
    mocks.instruments.mockImplementation(() => { throw new Error('Instrument catalog unavailable') })
    await choose('Outputs')
    expect(panel().querySelector('[role="alert"]')?.textContent).toBe('Instruments could not be loaded.')
    expect(panel().textContent).not.toContain('No outputs available')
    await add('MIDI output')
    expect(mocks.output).toHaveBeenCalledWith('webmidi', expect.anything())
})

it('keeps instruments usable when the output catalog fails', async () => {
    mocks.outputs.mockRejectedValueOnce(new TypeError('error loading dynamically imported module'))
    await choose('Outputs')
    expect(panel().querySelector('[role="alert"]')?.textContent).toBe('Outputs could not be loaded.')
    await add('Piano')
    expect(mocks.instrument).toHaveBeenCalledWith('audio', 'piano', expect.anything())
})

it('reports catalog failures without claiming no outputs are available', async () => {
    mocks.outputs.mockRejectedValueOnce(new Error('Output catalog unavailable'))
    mocks.instruments.mockImplementation(() => { throw new Error('Instrument catalog unavailable') })
    await choose('Outputs')
    expect(panel().querySelector('[role="alert"]')?.textContent).toBe('Outputs could not be loaded. Instruments could not be loaded.')
    expect(panel().textContent).not.toContain('No outputs available')
})

it('shows an icon for every sidebar choice, including instruments', async () => {
    for (const name of ['Inputs', 'Transformers', 'Outputs']) {
        await choose(name)
        const buttons = panel().querySelectorAll('li > button')
        expect(buttons.length).toBeGreaterThan(0)
        for (const button of buttons) {
            const icon = button.querySelector<HTMLElement>('.element-icon')!
            expect(icon).not.toBeNull()
            expect(icon.style.maskImage).toMatch(/url\(.+\/icons\/.+\.svg/)
            expect(icon.getAttribute('aria-hidden')).toBe('true')
        }
    }
})

it('shows the same transformer icons in the selection overlay and sidebar', async () => {
    await choose('Transformers')
    const sources = [...panel().querySelectorAll<HTMLElement>('li > button .element-icon')].map(icon => icon.style.maskImage)
    await act(async () => { root.render(<TransformerPicker dialog />) })
    expect([...document.querySelectorAll<HTMLElement>('.grid-item .element-icon')].map(icon => icon.style.maskImage)).toEqual(sources)
})
