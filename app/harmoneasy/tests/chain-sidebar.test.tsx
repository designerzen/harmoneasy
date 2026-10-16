// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChainSidebar } from '../source/components/graph/ChainSidebar'

const mocks = vi.hoisted(() => ({
    input: vi.fn(), output: vi.fn(), instrument: vi.fn(), addDevice: vi.fn(), appendTransformer: vi.fn(),
    inputs: vi.fn(), outputs: vi.fn()
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
vi.mock('audiobus/instruments', () => ({
    getAvailableInstrumentFactories: () => [{ id: 'piano', name: 'Piano', description: 'Acoustic instrument' }],
    createInstrumentById: mocks.instrument
}))
vi.mock('audiobus/io/transformer-factory', () => ({
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
