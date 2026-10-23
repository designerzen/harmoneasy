import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { compressToBase64 } from 'lz-string'
import IOChain from '../../../packages/audiobus/io/IO-chain'
import IOChainManager from '../../../packages/audiobus/io/IO-chain-manager'
import { DEFAULT_PRESET_LIBRARY } from '../../../packages/audiobus/io/transformer-presets'
import { parsePresetLibrary, stepsConfiguration } from '../../../packages/audiobus/io/preset-library'
import { applyPreset, applySetup, deleteLibraryItem, exportLibrary, importLibrary, readLibrary, saveSetup, updatePreset, writeLibrary } from '../source/components/graph/saved-presets'

let storage: Map<string, string>
beforeEach(() => {
    storage = new Map()
    vi.stubGlobal('localStorage', { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) })
    vi.stubGlobal('window', new EventTarget())
})
afterEach(() => vi.unstubAllGlobals())
const blank = () => ({ ...structuredClone(DEFAULT_PRESET_LIBRARY), presets: [], setups: [] })

describe('portable JSON preset libraries', () => {
    it('loads defaults from JSON and persists edits, deletions and an empty list', () => {
        expect(parsePresetLibrary(JSON.stringify(DEFAULT_PRESET_LIBRARY)).presets).toHaveLength(DEFAULT_PRESET_LIBRARY.presets.length)
        const edited = { ...readLibrary().presets[0], name: 'My version' }
        updatePreset(edited)
        expect(readLibrary().presets[0].name).toBe('My version')
        deleteLibraryItem('presets', edited.id)
        expect(readLibrary().presets.some(item => item.id === edited.id)).toBe(false)
        writeLibrary(blank())
        expect(readLibrary().presets).toEqual([])
    })
    it('migrates old chain presets without losing their settings or layout', () => {
        storage.set('harmoneasy.chain-presets.v1', JSON.stringify([{ id: 'old', name: 'Old lead', configuration: {
            options: { graphLayout: 'vertical' }, transformers: stepsConfiguration(DEFAULT_PRESET_LIBRARY.presets[0].steps)
        } }]))
        const preset = readLibrary().presets.find(item => item.id === 'old')!
        expect(preset.options?.graphLayout).toBe('vertical')
        expect(preset.steps[0].config.root).toBe(0)
        writeLibrary(readLibrary())
        expect(readLibrary().presets.filter(item => item.id === 'old')).toHaveLength(1)
        expect(storage.has('harmoneasy.chain-presets.v1')).toBe(true)
    })
    it('round-trips selected presets, forks conflicting IDs and skips identical imports', () => {
        const original = readLibrary().presets[0]
        const exported = exportLibrary(original.id)
        expect(parsePresetLibrary(exported).presets).toHaveLength(1)
        importLibrary(exported)
        expect(readLibrary().presets).toHaveLength(DEFAULT_PRESET_LIBRARY.presets.length)
        const conflicting = parsePresetLibrary(exported)
        conflicting.presets[0].steps[0].config.root = 7
        importLibrary(JSON.stringify(conflicting))
        const library = readLibrary()
        expect(library.presets).toHaveLength(DEFAULT_PRESET_LIBRARY.presets.length + 1)
        expect(library.presets[DEFAULT_PRESET_LIBRARY.presets.length].id).not.toBe(original.id)
        expect(library.presets[DEFAULT_PRESET_LIBRARY.presets.length].name).toBe(`${original.name} (2)`)
        expect(library.presets[0].steps[0].config.root).toBe(0)
    })
    it('rejects invalid and future files without changing stored data', () => {
        writeLibrary(readLibrary())
        const before = exportLibrary()
        for (const change of [
            library => { library.version = 99 },
            library => { library.presets.push(library.presets[0]) },
            library => { library.presets[0].steps[0].type = 'unknown' },
            library => { library.presets[0].steps[0].config = null },
            library => { library.presets[0].options = { graphLayout: 'bad' } }
        ]) {
            const invalid: any = JSON.parse(before)
            change(invalid)
            expect(() => importLibrary(JSON.stringify(invalid))).toThrow()
            expect(exportLibrary()).toBe(before)
        }
    })
    it('applies only to the target chain and retains other chains and their names', () => {
        const first = new IOChain({} as any), second = new IOChain({} as any)
        first.setName('First'); second.setName('Second')
        first.setTransformers([]); second.setTransformers([])
        applyPreset(first, DEFAULT_PRESET_LIBRARY.presets[0])
        expect(first.transformers).toHaveLength(1)
        expect(second.transformers).toHaveLength(0)
        expect(first.options.name).toBe('First')
        first.destroy(); second.destroy()
    })
    it('round-trips a setup with multiple chains, shared devices and active states', async () => {
        const timer = { BPM: 120 } as any
        const manager = new IOChainManager({ timer, outputMixer: {} as GainNode })
        const setup = { id: 'duet', name: 'Duet', description: 'Shared synth', activeChainId: 'lead',
            devices: [{ id: 'shared', direction: 'output' as const, definition: { factory: 'external' as const, type: 'missing-synth' } }],
            chains: [
                { id: 'lead', options: { name: 'Lead', active: true }, steps: DEFAULT_PRESET_LIBRARY.presets[0].steps, inputs: [], outputs: ['shared'] },
                { id: 'bass', options: { name: 'Bass', active: false }, steps: DEFAULT_PRESET_LIBRARY.presets[18].steps, inputs: [], outputs: ['shared'] }
            ] }
        const library = { ...blank(), setups: [setup] }
        importLibrary(JSON.stringify(library))
        expect(manager.chainCount).toBe(0)
        await applySetup(manager, readLibrary().setups[0])
        expect(manager.chainCount).toBe(2)
        expect(manager.activeChainId).toBe('lead')
        expect(manager.getChain('bass')?.isActive).toBe(false)
        expect(manager.getChain('lead')?.outputs[0]).toBe(manager.getChain('bass')?.outputs[0])
        expect(manager.restoreWarnings).toHaveLength(1)
        const saved = saveSetup(manager, 'Duet snapshot')
        const exported = parsePresetLibrary(exportLibrary(undefined, saved.id))
        expect(exported.presets).toEqual([])
        expect(exported.setups[0].chains).toHaveLength(2)
        expect(exported.setups[0].chains[1].steps[1].config.distance).toBe(-12)
        const before = manager.exportWorkspace()
        const invalid = structuredClone(exported)
        invalid.setups[0].chains[0].outputs = ['missing']
        expect(() => importLibrary(JSON.stringify(invalid))).toThrow('device reference')
        expect(manager.exportWorkspace()).toBe(before)
        // Existing compressed workspace saves remain compatible.
        const data = manager.exportWorkspaceData()
        expect(before).toBe('workspace:' + compressToBase64(JSON.stringify(data)))
        manager.destroy()
    })
})
