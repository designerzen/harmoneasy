import { afterEach, expect, it, vi } from 'vitest'
import IOChain from '../../../packages/audiobus/io/IO-chain'
import { applyPreset, readPresets, savePreset } from '../source/components/graph/saved-presets'

afterEach(() => vi.unstubAllGlobals())
it('saves independent layout/configuration snapshots and reapplies them without renaming or activating a chain', () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) })
    vi.stubGlobal('window', new EventTarget())
    const chain = new IOChain({} as any)
    chain.setTransformers([])
    chain.setName('Original')
    chain.setGraphOptions({ graphLayout: 'vertical', positions: { start: { x: 10, y: 20 } } })
    const preset = savePreset(chain, '  My layout  ')
    expect(readPresets()[0].name).toBe('My layout')
    chain.setGraphOptions({ graphLayout: 'horizontal', positions: {} })
    chain.setActive(false)
    applyPreset(chain, readPresets()[0])
    expect(chain.options.graphLayout).toBe('vertical')
    expect(chain.options.positions).toEqual({ start: { x: 10, y: 20 } })
    expect(chain.options.name).toBe('Original')
    expect(chain.isActive).toBe(false)
    expect(preset.configuration.options.name).toBeUndefined()
    expect(() => savePreset(chain, 'my layout')).toThrow('already exists')
    expect(() => savePreset(chain, '   ')).toThrow('Enter a preset name')
    chain.destroy()
})
