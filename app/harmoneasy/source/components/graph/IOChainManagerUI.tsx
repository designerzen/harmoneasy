import { applyPreset, usePresetLibrary } from './saved-presets'
import React, { useId, useRef, useState } from 'react'
import type IOChainManager from 'audiobus/io/IO-chain-manager'
import { PresetOptions } from './PresetDetails'

export function IOChainManagerUI({ manager }: { manager: IOChainManager }) {
    const selectId = useId()
    const { library, error: storageError } = usePresetLibrary()
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
        <select className="chain-preset-picker" id={selectId} disabled={busy} value={selection}
            onChange={event => setSelection(event.target.value)}>
            <button type="button">{React.createElement('selectedcontent')}</button>
            <option value="">
                <span className="chain-preset-copy"><strong>Default IOChain</strong><span className="chain-preset-description">Start with the default chain settings.</span></span>
            </option>
            <PresetOptions presets={library.presets} />
        </select>
        <button type="button" disabled={busy} onClick={addChain}>{busy ? 'Adding…' : 'Add Chain'}</button>
        </div>
        {(error || storageError) && <p role="alert">{error || storageError}</p>}
    </menu>
}
