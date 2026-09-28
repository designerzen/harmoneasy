import { useEffect, useState } from 'react'
import type IOChain from 'audiobus/io/IO-chain'

const KEY = 'harmoneasy.chain-presets.v1'
const UPDATED = 'chain-presets-updated'
export interface SavedPreset {
    id: string
    name: string
    configuration: ReturnType<IOChain['exportConfiguration']>
}
export function readPresets(): SavedPreset[] {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    if (!Array.isArray(value)) throw new Error('Saved presets could not be read')
    return value
}
export function savePreset(chain: IOChain, name: string): SavedPreset {
    const trimmed = name.trim().slice(0, 80)
    if (!trimmed) throw new Error('Enter a preset name')
    const presets = readPresets()
    if (presets.some(preset => preset.name.toLowerCase() === trimmed.toLowerCase())) {
        throw new Error('A preset with that name already exists')
    }
    const configuration = chain.exportConfiguration()
    delete configuration.options.name
    delete configuration.options.active
    const preset = { id: crypto.randomUUID(), name: trimmed, configuration }
    localStorage.setItem(KEY, JSON.stringify([...presets, preset]))
    window.dispatchEvent(new Event(UPDATED))
    return preset
}
export function applyPreset(chain: IOChain, preset: SavedPreset) {
    chain.clearNoteCommands()
    chain.importConfiguration({ ...structuredClone(preset.configuration), options: {
        ...structuredClone(preset.configuration.options), name: chain.options.name, active: chain.isActive
    } })
    chain.setGraphOptions({})
}
export function useSavedPresets() {
    const [presets, setPresets] = useState<SavedPreset[]>([])
    const [error, setError] = useState('')
    useEffect(() => {
        const refresh = () => {
            try { setPresets(readPresets()); setError('') }
            catch { setError('Saved presets are unavailable. Check browser storage access.') }
        }
        refresh()
        window.addEventListener(UPDATED, refresh)
        window.addEventListener('storage', refresh)
        return () => {
            window.removeEventListener(UPDATED, refresh)
            window.removeEventListener('storage', refresh)
        }
    }, [])
    return { presets, error }
}
