import React, { useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type IOChainManager from 'audiobus/io/IO-chain-manager'
import type { TransformerPreset, PresetSetup } from 'audiobus/io/preset-library'
import { PresetDetails } from './PresetDetails'
import { PresetArtwork } from './PresetArtwork'
import { completePresets } from './preset-catalogue'
import { applySetup, deleteLibraryItem, downloadLibrary, exportLibrary, importLibrary, readLibrary,
    saveSetup, updatePreset, usePresetLibrary, writeLibrary } from './saved-presets'

export function PresetBrowser({ manager, onApply, createChain = false, hideTrigger = false, startup = false, onChooseSetup }: {
    manager?: IOChainManager
    onApply: (preset: TransformerPreset) => void | Promise<void>
    createChain?: boolean
    hideTrigger?: boolean
    startup?: boolean
    onChooseSetup?: (setup: PresetSetup) => void
}) {
    const dialog = useRef<HTMLDialogElement>(null)
    const fileInput = useRef<HTMLInputElement>(null)
    const preview = useRef<HTMLDivElement>(null)
    const titleId = useId()
    const { library, error: storageError } = usePresetLibrary()
    const [selection, setSelection] = useState('')
    const [message, setMessage] = useState('')
    const [busy, setBusy] = useState(false)
    const [query, setQuery] = useState('')
    const [setupName, setSetupName] = useState<string | null>(null)
    const [editor, setEditor] = useState<{ kind: 'presets' | 'setups'; id: string; json: string } | null>(null)
    const [undo, setUndo] = useState<string | null>(null)
    const setup = library.setups.find(item => `setup:${item.id}` === selection)
    const presets = completePresets(library.presets)
    const preset = setup ? undefined : presets.find(item => `preset:${item.id}` === selection) ?? presets[0]
    const categories = [...new Set(presets.map(item => item.category))]
    const words = query.trim().toLowerCase().split(/\s+/)
    const matches = (item: { name: string; description: string; category?: string; useCase?: string }) =>
        words.every(word => `${item.name} ${item.description} ${item.category ?? ''} ${item.useCase ?? ''}`.toLowerCase().includes(word))
    const filteredPresets = presets.filter(matches)
    const filteredSetups = createChain && !startup ? [] : library.setups.filter(matches)
    const run = (action: () => void) => {
        try { action() }
        catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    }
    const select = (id: string) => {
        setSelection(id); setEditor(null); setMessage('')
        if (window.matchMedia('(max-width: 640px)').matches) preview.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
    }
    const remove = (kind: 'presets' | 'setups', id: string) => run(() => {
        const before = exportLibrary(kind === 'presets' ? id : undefined, kind === 'setups' ? id : undefined)
        deleteLibraryItem(kind, id)
        setUndo(before); setSelection(''); setEditor(null); setMessage('Deleted from your library. You can undo this change.')
    })
    return <>
        <button type="button" className="preset-browse" hidden={hideTrigger} onClick={() => {
            dialog.current?.showModal()
            dialog.current?.querySelector<HTMLButtonElement>('.preset-apply-button:not(:disabled)')?.focus({ preventScroll: true })
        }}>{startup ? 'Browse all presets…' : createChain ? 'New chain' : 'Apply a preset…'}</button>
        {createPortal(<dialog ref={dialog} className="preset-browser" aria-labelledby={titleId}>
            <header><div><h2 id={titleId}>Find your next sound</h2><p>{createChain ? 'Choose a preset for your new chain, or start with a blank chain.' : 'Choose a preset, explore its pattern, then apply it to your chain.'}</p></div>
                <button type="button" onClick={() => dialog.current?.close()} aria-label="Close presets">Close</button></header>
            <div className="preset-browser-scroll">
            <div className="preset-browser-toolbar">
            {createChain && <button type="button" disabled={busy} onClick={async () => {
                setBusy(true)
                try { await onApply({ id: '', name: 'Blank chain', category: '', description: '', useCase: '', steps: [] }); dialog.current?.close() }
                catch (error) { setMessage(String(error)) }
                finally { setBusy(false) }
            }}>Create blank chain</button>}
            <label className="preset-search"><span className="sr-only">Search presets</span><input type="search" value={query} placeholder="Search sounds, moods or ideas…" onInput={event => setQuery(event.currentTarget.value)} /></label>
            <details className="preset-library-tools"><summary>Library options</summary><div className="preset-library-actions">
                <button type="button" disabled={busy || !!storageError} onClick={() => run(() => downloadLibrary(exportLibrary()))}>Save library to file</button>
                <button type="button" disabled={busy || !!storageError} onClick={() => fileInput.current?.click()}>Import JSON file</button>
                <input ref={fileInput} className="sr-only" type="file" accept=".json,application/json" aria-label="Import preset library" onChange={async event => {
                    const input = event.currentTarget
                    const file = input.files?.[0]
                    if (!file) return
                    setBusy(true)
                    try {
                        if (file.size > 10 * 1024 * 1024) throw new Error('Choose a JSON file smaller than 10 MB')
                        importLibrary(await file.text()); setMessage('Imported into your library. Your playing workspace has not changed.'); setUndo(null)
                    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
                    finally { input.value = ''; setBusy(false) }
                }} />
                <button type="button" disabled={busy || !!storageError} onClick={() => {
                    const item: TransformerPreset = { id: crypto.randomUUID(), name: 'New preset', category: 'My presets', description: '', useCase: '', steps: [] }
                    setEditor({ kind: 'presets', id: item.id, json: JSON.stringify(item, null, 2) }); setMessage('')
                }}>New preset</button>
                {manager && <button type="button" disabled={busy || !!storageError} onClick={() => setSetupName('My setup')}>Save current setup</button>}
                {undo && <button type="button" disabled={busy} onClick={() => run(() => {
                    importLibrary(undo); setUndo(null); setMessage('Deletion undone.')
                })}>Undo delete</button>}
            </div>
            <p className="preset-library-note">Saved in this browser. Export your library to keep a portable copy; imports are added to your existing presets.</p></details>
            </div>
            {setupName !== null && manager && <form className="preset-setup-save" onSubmit={event => {
                event.preventDefault()
                run(() => { const item = saveSetup(manager, setupName); setSelection(`setup:${item.id}`); setSetupName(null); setUndo(null); setMessage('Setup saved to your library. Use Save selected to download it.') })
            }}>
                <label>Setup name <input required maxLength={80} value={setupName} onChange={event => setSetupName(event.target.value)} /></label>
                <button type="submit">Save setup</button><button type="button" onClick={() => setSetupName(null)}>Cancel</button>
            </form>}
            {(message || storageError) && <p className="preset-library-note" role="status">{storageError || message}</p>}
            <div className="preset-browser-content">
                <nav aria-label="Preset sections">
                    {categories.filter(category => filteredPresets.some(item => item.category === category)).map(category => <section key={category}>
                        <h3>{category}</h3>
                        {filteredPresets.filter(item => item.category === category).map(item =>
                            <button type="button" key={item.id} disabled={busy} aria-pressed={preset?.id === item.id}
                                onClick={() => select(`preset:${item.id}`)}><PresetArtwork preset={item} compact /><span>{item.name}<small className="preset-list-description">{item.description}</small></span></button>)}
                    </section>)}
                    {filteredSetups.length > 0 && <section><h3>Setups · multiple chains</h3>{filteredSetups.map(item =>
                        <button type="button" key={item.id} disabled={busy} aria-pressed={setup?.id === item.id}
                            onClick={() => select(`setup:${item.id}`)}><PresetArtwork preset={{ ...item, steps: item.chains.flatMap(chain => chain.steps) }} compact /><span>{item.name}</span></button>)}</section>}
                    {!filteredPresets.length && !filteredSetups.length && <p className="preset-no-results">No matching presets. Try another search.</p>}
                </nav>
                <div className="preset-preview" ref={preview}>
                    {editor ? <form className="preset-editor" onSubmit={event => {
                        event.preventDefault()
                        run(() => {
                            const item = { ...JSON.parse(editor.json), id: editor.id }
                            if (editor.kind === 'presets') updatePreset(item)
                            else {
                                const latest = readLibrary()
                                latest.setups = latest.setups.map(setup => setup.id === editor.id ? item : setup)
                                writeLibrary(latest)
                            }
                            setSelection(`${editor.kind === 'presets' ? 'preset' : 'setup'}:${item.id}`)
                            setEditor(null); setUndo(null); setMessage('Changes saved in this browser. Save to file for a portable copy.')
                        })
                    }}>
                        <label>Edit {editor.kind === 'presets' ? 'preset' : 'setup'} JSON
                            <textarea required rows={20} spellCheck={false} value={editor.json} onChange={event => setEditor({ ...editor, json: event.target.value })} /></label>
                        <p>Change the name, description, category, use case or transformer settings. IDs remain stable when editing.</p>
                        <button type="submit">Save changes</button><button type="button" onClick={() => setEditor(null)}>Cancel edit</button>
                    </form> : <>
                        {preset && <>
                            <PresetDetails preset={preset} />
                        </>}
                        {setup && <article className="preset-details"><PresetArtwork preset={{ ...setup, steps: setup.chains.flatMap(chain => chain.steps) }} /><span className="preset-category">Workspace setup</span>
                            <h3>{setup.name}</h3><p>{setup.description || 'A snapshot of chains, device settings and shared routing.'}</p>
                            <h4>{setup.chains.length} chains</h4><ul>{setup.chains.map(chain => <li key={chain.id}>
                                {chain.options.name || chain.id} · {chain.steps.length} transformers
                            </li>)}</ul>
                            <p>Loading replaces all current chains and routing. Save your current setup first if you want to keep it.</p>
                        </article>}
                        {!preset && !setup && <p>Your library is empty. Create a preset or import a JSON file to get started.</p>}
                        {(preset || setup) && !preset?.id.startsWith('activity:') && <details className="preset-item-tools"><summary>Manage this {setup ? 'setup' : 'preset'}</summary><div className="preset-item-actions">
                            <button type="button" disabled={busy || !!storageError} onClick={() => run(() => downloadLibrary(exportLibrary(preset?.id, setup?.id), (preset ?? setup)!.name))}>Save selected to file</button>
                            <button type="button" disabled={busy || !!storageError} onClick={() => setEditor({ kind: setup ? 'setups' : 'presets', id: (preset ?? setup)!.id, json: JSON.stringify(preset ?? setup, null, 2) })}>Edit JSON</button>
                            {preset && <button type="button" disabled={busy || !!storageError} onClick={() => setEditor({ kind: 'presets', id: crypto.randomUUID(), json: JSON.stringify({ ...preset, name: `${preset.name} copy` }, null, 2) })}>Duplicate preset</button>}
                            <button type="button" disabled={busy || !!storageError} onClick={() => remove(setup ? 'setups' : 'presets', (preset ?? setup)!.id)}>Delete {setup ? 'setup' : 'preset'}</button>
                        </div></details>}
                    </>}
                </div>
            </div>
            </div>
            {!editor && (preset || setup) && <footer className="preset-apply-bar">
                <p>{startup ? 'Choose this preset, then press Start Preset to begin.' : createChain ? 'Creates a new chain with this preset.' : setup ? 'Replaces every chain and its routing.' : 'Replaces transformers on this chain. Your input and instrument stay connected.'}</p>
                <button type="button" className="preset-apply-button primary" disabled={busy || !!storageError || (!!setup && !manager && !onChooseSetup)} onClick={async () => {
                    if (setup && onChooseSetup) { onChooseSetup(setup); dialog.current?.close(); return }
                    if (preset) {
                        setBusy(true)
                        try { const result = onApply(preset); if (result) await result; dialog.current?.close() }
                        catch (error) { setMessage(String(error)) }
                        finally { setBusy(false) }
                        return
                    }
                    if (!setup || !manager) return
                    setBusy(true)
                    try { await applySetup(manager, setup); dialog.current?.close() }
                    catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
                    finally { setBusy(false) }
                }}>{startup ? `Choose ${(preset ?? setup)!.name}` : setup ? `Replace workspace with ${setup.name}` : createChain ? `Create ${preset!.name} chain` : `Apply ${preset!.name}`}</button>
            </footer>}
        </dialog>, document.body)}
    </>
}
