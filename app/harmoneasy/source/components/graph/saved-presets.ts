import { compressToBase64 } from 'lz-string'
import type IOChain from 'audiobus/io/IO-chain'
import type IOChainManager from 'audiobus/io/IO-chain-manager'
import { EVENT_PRESET_LIBRARY_UPDATED } from 'audiobus/event-constants'
import { DEFAULT_PRESET_LIBRARY } from 'audiobus/io/transformer-presets'
import { configurationSteps, parsePresetLibrary, stepsConfiguration, type PresetLibrary, type PresetSetup, type TransformerPreset } from 'audiobus/io/preset-library'

const KEY = 'harmoneasy.preset-library.v1'
const LEGACY_KEY = 'harmoneasy.chain-presets.v1'
export function readLibrary(): PresetLibrary {
    const stored = localStorage.getItem(KEY)
    if (stored !== null) return parsePresetLibrary(stored)
    const library = structuredClone(DEFAULT_PRESET_LIBRARY)
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? '[]')
    if (!Array.isArray(legacy)) throw new Error('Saved presets could not be read')
    for (const preset of legacy) {
        library.presets.push({ id: preset.id, name: preset.name, category: 'Saved presets',
            description: 'Your saved chain settings and layout.', useCase: 'Recall a previously saved performance chain.',
            steps: configurationSteps(preset.configuration.transformers), options: preset.configuration.options })
    }
    return parsePresetLibrary(JSON.stringify(library))
}
export function writeLibrary(library: PresetLibrary) {
    const validated = parsePresetLibrary(JSON.stringify(library))
    localStorage.setItem(KEY, JSON.stringify(validated))
    window.dispatchEvent(new Event(EVENT_PRESET_LIBRARY_UPDATED))
}
export function readPresets() { return readLibrary().presets }
export function updatePreset(preset: TransformerPreset) {
    const library = readLibrary()
    const index = library.presets.findIndex(item => item.id === preset.id)
    if (library.presets.some(item => item.id !== preset.id && item.name.toLowerCase() === preset.name.trim().toLowerCase())) throw new Error('A preset with that name already exists')
    if (index < 0) library.presets.push(preset)
    else library.presets[index] = preset
    writeLibrary(library)
}
export function deleteLibraryItem(kind: 'presets' | 'setups', id: string) {
    const library = readLibrary()
    if (kind === 'presets') library.presets = library.presets.filter(item => item.id !== id)
    else library.setups = library.setups.filter(item => item.id !== id)
    writeLibrary(library)
}
export function savePreset(chain: IOChain, name: string): TransformerPreset {
    const trimmed = name.trim().slice(0, 80)
    if (!trimmed) throw new Error('Enter a preset name')
    const { options, transformers } = chain.exportConfiguration()
    delete options.name
    delete options.active
    const preset: TransformerPreset = { id: crypto.randomUUID(), name: trimmed, category: 'Saved presets',
        description: 'Your saved chain settings and layout.', useCase: 'Recall a previously saved performance chain.',
        steps: configurationSteps(transformers), options }
    updatePreset(preset)
    return preset
}
export function applyPreset(chain: IOChain, preset: TransformerPreset) {
    chain.clearNoteCommands()
    chain.importConfiguration({ options: { ...structuredClone(chain.options), ...structuredClone(preset.options ?? {}),
        name: chain.options.name, active: chain.isActive }, transformers: stepsConfiguration(preset.steps) })
    chain.setGraphOptions({})
}
export function saveSetup(manager: IOChainManager, name: string): PresetSetup {
    if (!name.trim()) throw new Error('Enter a setup name')
    const workspace = manager.exportWorkspaceData()
    const setup: PresetSetup = { id: crypto.randomUUID(), name: name.trim().slice(0, 80), description: '',
        activeChainId: workspace.activeChainId, devices: workspace.devices,
        chains: workspace.chains.map(({ transformers, ...chain }) => ({ ...chain, steps: configurationSteps(transformers) })) }
    const library = readLibrary()
    if (library.setups.some(item => item.name.toLowerCase() === setup.name.toLowerCase())) throw new Error('A setup with that name already exists')
    library.setups.push(setup)
    writeLibrary(library)
    return setup
}
export async function applySetup(manager: IOChainManager, setup: PresetSetup) {
    const library = { ...structuredClone(DEFAULT_PRESET_LIBRARY), presets: [], setups: [setup] }
    const checked = parsePresetLibrary(JSON.stringify(library)).setups[0]
    const workspace = { version: 2, activeChainId: checked.activeChainId, devices: checked.devices,
        chains: checked.chains.map(({ steps, ...chain }) => ({ ...chain, transformers: stepsConfiguration(steps) })) }
    await manager.restoreWorkspace('workspace:' + compressToBase64(JSON.stringify(workspace)))
}
export function importLibrary(json: string) {
    const imported = parsePresetLibrary(json)
    const library = readLibrary()
    // Import is additive: conflicting IDs are forked, never silently overwritten.
    for (const kind of ['presets', 'setups'] as const) {
        const target = library[kind] as (TransformerPreset | PresetSetup)[]
        for (const item of imported[kind]) {
            const existing = target.find(entry => entry.id === item.id)
            if (existing && JSON.stringify(existing) === JSON.stringify(item)) continue
            const copy = structuredClone(item)
            if (existing) copy.id = crypto.randomUUID()
            const originalName = copy.name
            let suffix = 2
            while (target.some(entry => entry.name.toLowerCase() === copy.name.toLowerCase())) copy.name = `${originalName} (${suffix++})`
            target.push(copy)
        }
    }
    writeLibrary(library)
}
export function exportLibrary(presetId?: string, setupId?: string): string {
    const library = readLibrary()
    if (presetId || setupId) {
        library.presets = presetId ? library.presets.filter(item => item.id === presetId) : []
        library.setups = setupId ? library.setups.filter(item => item.id === setupId) : []
    }
    return JSON.stringify(library, null, 2) + '\n'
}
export function downloadLibrary(json: string, name = 'harmoneasy-presets') {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${name.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80)}.json`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}
