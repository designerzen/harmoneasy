import { applyPreset, savePreset, useSavedPresets } from './saved-presets'
import { useChain } from './ChainContext'
import React, { useId, useState } from 'react'
import { tranformerFactory } from 'audiobus/io/transformer-factory'
import { PRESETS } from 'audiobus/io/transformer-presets'

export function Presets() {
    const { chain } = useChain()
    const selectId = useId()
    const { presets: saved, error: storageError } = useSavedPresets()
    const [saving, setSaving] = useState(false)
    const [name, setName] = useState('')
    const [message, setMessage] = useState('')

    return <div className="presets">
        <label className="sr-only" htmlFor={selectId}>Preset</label>
        <select id={selectId} value="" onChange={event => {
            const custom = saved.find(preset => `saved:${preset.id}` === event.target.value)
            if (custom) {
                try { applyPreset(chain, custom); setMessage('') }
                catch (error) { setMessage(String(error)) }
                return
            }
            const preset = PRESETS.find(preset => preset.name === event.target.value)
            if (preset) chain.setTransformers(preset.transformers.map(type => tranformerFactory(type)))
        }}>
            <option value="" disabled>Apply a preset…</option>
            {PRESETS.map(preset => <option key={preset.name} value={preset.name} title={preset.description}>
                {preset.name}
            </option>)}
            {saved.length > 0 && <optgroup label="Saved presets">
                {saved.map(preset => <option key={preset.id} value={`saved:${preset.id}`}>{preset.name}</option>)}
            </optgroup>}
        </select>
        <button className="chain-icon-button" type="button" title="Save as preset" aria-expanded={saving}
            onClick={() => { setName(chain.options.name ?? ''); setSaving(true); setMessage('') }}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 3h12l4 4v14H3V3h2Z M7 3v6h10V3 M7 21v-8h10v8" /></svg>
            <span className="sr-only">Save as preset</span>
        </button>
        {saving && <form className="save-preset" onSubmit={event => {
            event.preventDefault()
            try { savePreset(chain, name); setSaving(false); setMessage('Preset saved') }
            catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
        }}>
            <label>Preset name <input autoFocus required maxLength={80} value={name} onChange={event => setName(event.target.value)} /></label>
            <button type="submit">Save</button>
            <button type="button" onClick={() => setSaving(false)}>Cancel</button>
        </form>}
        {(message || storageError) && <span role="status">{message || storageError}</span>}
    </div>
}
