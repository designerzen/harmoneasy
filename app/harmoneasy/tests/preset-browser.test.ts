// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { PresetBrowser } from '../source/components/graph/PresetBrowser'
import { createChainPresetPicker, updateChainPresetOptions } from '../source/components/graph/chain-preset-picker'
import { elementIcon } from '../source/components/graph/element-icons'
import { IOChainManagerUI } from '../source/components/graph/IOChainManagerUI'
import type IOChainManager from 'audiobus/io/IO-chain-manager'
import { DEFAULT_PRESET_LIBRARY } from '../../../packages/audiobus/io/transformer-presets'
import { writeLibrary } from '../source/components/graph/saved-presets'

let root: ReturnType<typeof createRoot>
afterEach(() => {
    if (root) act(() => root.unmount())
    document.body.replaceChildren()
    vi.unstubAllGlobals()
})

it('lets users inspect grouped presets before applying and keeps saved presets available', () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) })
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const onApply = vi.fn()
    const saved = { id: 'mine', name: 'My lead', category: 'Saved presets', description: 'A lead', useCase: 'Play a lead', steps: [] }
    writeLibrary({ ...structuredClone(DEFAULT_PRESET_LIBRARY), presets: [...DEFAULT_PRESET_LIBRARY.presets, saved] })
    act(() => root.render(React.createElement(PresetBrowser, { onApply })))
    const dialog = host.querySelector('dialog')!
    dialog.showModal = vi.fn(() => dialog.setAttribute('open', ''))
    dialog.close = vi.fn(() => dialog.removeAttribute('open'))
    const click = (label: string) => act(() => {
        const button = [...host.querySelectorAll('button')].find(item => item.textContent === label)!
        expect(button).toBeTruthy()
        button.click()
    })
    click('Apply a preset…')
    expect(dialog.hasAttribute('open')).toBe(true)
    expect(host.querySelectorAll('nav section')).toHaveLength(6)
    click('Triplet Cascade')
    expect(onApply).not.toHaveBeenCalled()
    expect(host.querySelector('.preset-details')?.textContent).toContain('Why use it')
    expect(host.querySelector('.preset-details')?.textContent).toContain('triplet spacing')
    click('Apply Triplet Cascade')
    expect(onApply.mock.calls[0][0].name).toBe('Triplet Cascade')
    expect(dialog.hasAttribute('open')).toBe(false)
    click('Apply a preset…')
    click('My lead')
    click('Apply My lead')
    expect(onApply).toHaveBeenLastCalledWith(saved)
})

it('uses the same sections for new-chain options', () => {
    const picker = createChainPresetPicker('test-picker')
    updateChainPresetOptions(picker, DEFAULT_PRESET_LIBRARY.presets)
    expect(picker.querySelectorAll('optgroup')).toHaveLength(5)
    expect(picker.querySelectorAll('option')).toHaveLength(23)
    const preset = DEFAULT_PRESET_LIBRARY.presets[0]
    picker.value = preset.id
    updateChainPresetOptions(picker, DEFAULT_PRESET_LIBRARY.presets)
    expect(picker.value).toBe(preset.id)
    updateChainPresetOptions(picker, [])
    expect(picker.value).toBe('')
    expect(picker.querySelectorAll('button > selectedcontent')).toHaveLength(1)
})

it('describes every new-chain option before selection and adds only when confirmed', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('localStorage', { getItem: () => null })
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const chain = { options: {}, isActive: true, clearNoteCommands: vi.fn(), importConfiguration: vi.fn(), setGraphOptions: vi.fn(), setName: vi.fn() }
    const manager = { createDefaultChain: vi.fn().mockResolvedValue('new-chain'), getChain: vi.fn(() => chain), setActiveChain: vi.fn() }
    act(() => root.render(React.createElement(IOChainManagerUI, { manager: manager as unknown as IOChainManager })))
    const picker = host.querySelector('select')!
    expect(picker.value).toBe('')
    expect(picker.labels?.[0].textContent).toBe('New chain')
    expect(picker.querySelector('button > selectedcontent')).not.toBeNull()
    expect(picker.querySelectorAll('optgroup')).toHaveLength(5)
    for (const preset of DEFAULT_PRESET_LIBRARY.presets) {
        const option = [...picker.options].find(option => option.value === preset.id)!
        expect(option.selected).toBe(false)
        expect(option.querySelector('.chain-preset-description')?.textContent).toBe(preset.description)
        expect(option.querySelector('.chain-preset-use-case')?.textContent).toBe(preset.useCase)
        const icons = option.querySelectorAll<HTMLElement>('.chain-preset-step .element-icon')
        expect(icons).toHaveLength(preset.steps.length)
        preset.steps.forEach((step, index) => {
            expect(icons[index].style.maskImage).toContain(elementIcon('transformer', step.type))
            expect(icons[index].parentElement?.textContent).toBe(step.summary || step.type)
        })
    }
    const preset = DEFAULT_PRESET_LIBRARY.presets.find(item => item.name === 'Ratchet Fill')!
    act(() => {
        picker.value = preset.id
        picker.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(picker.value).toBe(preset.id)
    expect(manager.createDefaultChain).not.toHaveBeenCalled()
    expect(host.querySelector('.preset-details')).toBeNull()
    await act(async () => host.querySelector<HTMLButtonElement>('.chain-create-control > button')!.click())
    expect(manager.createDefaultChain).toHaveBeenCalledOnce()
    expect(chain.setName).toHaveBeenCalledWith(preset.name)
    expect(manager.setActiveChain).toHaveBeenCalledWith('new-chain')
})

it('persists new presets and deletions, supports undo, and downloads the selected preset', () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) })
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    writeLibrary({ ...structuredClone(DEFAULT_PRESET_LIBRARY), presets: [] })
    act(() => root.render(React.createElement(PresetBrowser, { onApply: vi.fn() })))
    const click = (label: string) => act(() => {
        const button = [...host.querySelectorAll('button')].find(item => item.textContent === label)!
        expect(button).toBeTruthy()
        button.click()
    })
    click('New preset')
    act(() => host.querySelector<HTMLFormElement>('.preset-editor')!.requestSubmit())
    expect(host.querySelector('.preset-details h3')?.textContent).toBe('New preset')
    expect(host.querySelector('nav')?.textContent).toContain('My presets')
    click('Delete preset')
    expect(host.querySelector('.preset-details')).toBeNull()
    click('Undo delete')
    expect(host.querySelector('.preset-details h3')?.textContent).toBe('New preset')
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    click('Save selected to file')
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(anchorClick).toHaveBeenCalledOnce()
    createObjectURL.mockRestore(); anchorClick.mockRestore()
})
