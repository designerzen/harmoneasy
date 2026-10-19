import { applyPreset, usePresetLibrary } from './saved-presets'
import React, { useId, useLayoutEffect, useRef, useState } from 'react'
import type IOChainManager from 'audiobus/io/IO-chain-manager'
import { createChainPresetPicker, updateChainPresetOptions } from './chain-preset-picker'

export function IOChainManagerUI({ manager }: { manager: IOChainManager }) {
    const selectId = useId()
    const { library, error: storageError } = usePresetLibrary()
    const [selection, setSelection] = useState('')
    const [busy, setBusy] = useState(false)
    const adding = useRef(false)
    const [error, setError] = useState('')
    const pickerHost = useRef<HTMLSpanElement>(null)
    const picker = useRef<HTMLSelectElement | null>(null)
    useLayoutEffect(() => {
        const select = createChainPresetPicker(selectId)
        const change = () => setSelection(select.value)
        select.addEventListener('change', change)
        pickerHost.current!.append(select)
        picker.current = select
        return () => {
            select.removeEventListener('change', change)
            select.remove()
            picker.current = null
        }
    }, [selectId])
    useLayoutEffect(() => {
        updateChainPresetOptions(picker.current!, library.presets)
        setSelection(picker.current!.value)
    }, [library.presets])
    useLayoutEffect(() => { picker.current!.disabled = busy }, [busy])
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
        <span className="chain-preset-host" ref={pickerHost} />
        <button type="button" disabled={busy} onClick={addChain}>{busy ? 'Adding…' : 'Add Chain'}</button>
        </div>
        {(error || storageError) && <p role="alert">{error || storageError}</p>}
    </menu>
}
