import { applyPreset, savePreset } from './saved-presets'
import { useChain } from './ChainContext'
import React, { useState } from 'react'
import { PresetBrowser } from './PresetBrowser'

export function Presets() {
    const { chain, manager } = useChain()
    const [saving, setSaving] = useState(false)
    const [name, setName] = useState('')
    const [message, setMessage] = useState('')

    return <div className="presets">
        <PresetBrowser manager={manager} onApply={preset => {
            applyPreset(chain, preset)
            setMessage(`${preset.name} applied`)
        }} />
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
        {message && <span role="status">{message}</span>}
    </div>
}
