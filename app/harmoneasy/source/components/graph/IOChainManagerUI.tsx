import { applyPreset, useSavedPresets } from './saved-presets'
import React, { useId, useRef, useState } from 'react'
import type IOChainManager from 'audiobus/io/IO-chain-manager'
import { PRESETS } from 'audiobus/io/transformer-presets'
import { tranformerFactory } from 'audiobus/io/transformer-factory'

export function IOChainManagerUI({ manager }: { manager: IOChainManager }) {
    const selectId = useId()
    const { presets: saved, error: storageError } = useSavedPresets()
    const [selection, setSelection] = useState('')
    const [busy, setBusy] = useState(false)
    const adding = useRef(false)
    const [error, setError] = useState('')
    const addChain = async () => {
        if (adding.current) return
        adding.current = true
        setBusy(true)
        setError('')
        try {
            const preset = PRESETS.find(preset => preset.name === selection)
            const id = await manager.createDefaultChain()
            const chain = manager.getChain(id)!
            const custom = saved.find(preset => `saved:${preset.id}` === selection)
            if (custom) { applyPreset(chain, custom); chain.setName(custom.name) }
            if (preset) {
                chain.setTransformers(preset.transformers.map(type => tranformerFactory(type)))
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
            <optgroup label="Presets">
                {PRESETS.map(preset => <option key={preset.name} value={preset.name} title={preset.description}>
                    {preset.name}
                </option>)}
            </optgroup>
            {saved.length > 0 && <optgroup label="Saved presets">
                {saved.map(preset => <option key={preset.id} value={`saved:${preset.id}`}>{preset.name}</option>)}
            </optgroup>}
        </select>
        <button type="button" disabled={busy} onClick={addChain}>{busy ? 'Adding…' : 'Add Chain'}</button>
        </div>
        {(error || storageError) && <p role="alert">{error || storageError}</p>}
    </menu>
}
