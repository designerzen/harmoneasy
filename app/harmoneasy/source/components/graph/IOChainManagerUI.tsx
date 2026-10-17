import { applyPreset, usePresetLibrary } from './saved-presets'
import React, { useId, useRef, useState } from 'react'
import type IOChainManager from 'audiobus/io/IO-chain-manager'
import { PresetDetails, PresetOptions } from './PresetDetails'

export function IOChainManagerUI({ manager }: { manager: IOChainManager }) {
    const selectId = useId()
    const { library, error: storageError } = usePresetLibrary()
    const [selection, setSelection] = useState('')
    const selectedPreset = library.presets.find(preset => preset.id === selection)
    const [busy, setBusy] = useState(false)
    const adding = useRef(false)
    const [error, setError] = useState('')
    const addChain = async () => {
        if (adding.current) return
        adding.current = true
        setBusy(true)
        setError('')
        try {
            const preset = library.presets.find(preset => preset.id === selection)
            if (selection && !preset) throw new Error('This preset has been deleted. Choose another preset.')
            const id = await manager.createDefaultChain()
            const chain = manager.getChain(id)!
            if (preset) {
                applyPreset(chain, preset)
                chain.setName(preset.name)
            }
            manager.setActiveChain(id)
        } catch (error) { setError(String(error)) }
        finally { adding.current = false; setBusy(false) }
    }
    return <menu id="add-iochain" className="iochain-manager" aria-label="Add a new IOChain">
        <label htmlFor={selectId}>New chain</label>
        <div className="chain-create-control">
        <select id={selectId} disabled={busy} value={selection} onChange={event => setSelection(event.target.value)}>
            <option value="">Default IOChain</option>
            <PresetOptions presets={library.presets} />
        </select>
        <button type="button" disabled={busy} onClick={addChain}>{busy ? 'Adding…' : 'Add Chain'}</button>
        </div>
        {selectedPreset && <PresetDetails preset={selectedPreset} />}
        {(error || storageError) && <p role="alert">{error || storageError}</p>}
    </menu>
}
