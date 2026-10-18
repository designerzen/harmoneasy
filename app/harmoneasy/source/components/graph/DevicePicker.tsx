import React, { useEffect, useId, useRef, useState } from 'react'
import { useChain } from './ChainContext'
import { SharedDevices } from './SharedDevices'
import { elementDescription, elementIcon } from './element-icons'
import { ElementIcon } from './ElementIcon'
import { createInstrumentById, getAvailableInstrumentFactories } from 'audiobus/instruments/instrument-factory-ui.ts'

import { ClassificationFilter } from './ClassificationFilter'
import { choiceMatches, groupChoices, type ClassifiedChoice } from './device-filters'
import { fillDeviceCard } from './device-card'

type Choice = ClassifiedChoice & { kind: 'input' | 'output' | 'instrument' }

export function DevicePicker({ direction, dialog = false, onAdded }: { direction: 'input' | 'output'; dialog?: boolean; onAdded?: () => void }) {
    const { chain, manager } = useChain()
    const filterId = useId()
    const [choices, setChoices] = useState<Choice[]>([])
    const [filter, setFilter] = useState('')
    const [classification, setClassification] = useState('')
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const adding = useRef(false)
    const [error, setError] = useState('')

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        setChoices([])
        setClassification('')
        setError('')
        const load = async (): Promise<Choice[]> => {
            if (direction === 'input') {
                return (await chain.inputManager.getAvailableFactories()).map(factory => ({ ...factory, kind: 'input' }))
            }
            const [outputs, instruments] = await Promise.allSettled([
                Promise.resolve().then(() => chain.outputManager.getAvailableFactories()),
                Promise.resolve().then(() => getAvailableInstrumentFactories())
            ])
            const failures = [
                outputs.status === 'rejected' ? 'Outputs could not be loaded.' : '',
                instruments.status === 'rejected' ? 'Instruments could not be loaded.' : ''
            ].filter(Boolean)
            if (!cancelled) setError(failures.join(' '))
            return [
                ...(outputs.status === 'fulfilled' ? outputs.value.map(factory => ({ ...factory, kind: 'output' as const })) : []),
                ...(instruments.status === 'fulfilled' ? instruments.value.map(factory => ({ ...factory, kind: 'instrument' as const })) : [])
            ]
        }
        void load().then(items => { if (!cancelled) setChoices(items) })
            .catch(error => { if (!cancelled) setError(String(error)) })
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [chain, direction])

    const add = async (choice: Choice) => {
        if (adding.current) return
        adding.current = true
        setBusy(true)
        setError('')
        try {
            if (choice.kind === 'input') {
                const { createInputById } = await import('audiobus/io/input-factory')
                manager.addDevice(chain, await createInputById(choice.id, manager.deviceOptions), 'input')
            } else {
                const audioContext = manager.audioContext || (manager.outputMixer as any)?.context
                const options = manager.outputMixer ? { mixer: manager.outputMixer, audioContext } : undefined
                if (choice.kind === 'instrument') {
                    manager.addDevice(chain, await createInstrumentById(audioContext, choice.id, options), 'output')
                } else {
                    const { createOutputById } = await import('audiobus/io/output-factory')
                    manager.addDevice(chain, await createOutputById(choice.id, options), 'output')
                }
            }
            onAdded?.()
        } catch (error) { setError(String(error)) }
        finally { adding.current = false; setBusy(false) }
    }
    const filtered = choices.filter(choice => choiceMatches(choice, filter, classification))
    return <div className="device-picker" aria-busy={loading || busy}>
        <label className={dialog ? 'dialog-filter' : 'filter-label'} htmlFor={filterId}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" />
            </svg>
            <input id={filterId} type="search" aria-label={`Search ${direction}s`}
                autoFocus={dialog} className={dialog ? 'filter-input-global' : undefined} placeholder={`Filter ${direction}s...`} value={filter} onChange={event => setFilter(event.target.value)} />
        </label>
        <ClassificationFilter choices={choices} value={classification} onChange={setClassification} label={`Filter ${direction}s by type`} />
        <SharedDevices direction={direction} search={filter} selection={classification} />
        {error && <p role="alert">{error}</p>}
        {loading ? <p role="status">Loading {direction}s…</p> : <>
            {groupChoices(filtered).map(group => <section className="choice-group" key={`${group.type}:${group.subtype}`} aria-label={group.label}>
                <h6 className="section-title">{group.label}</h6>
                <ul className={dialog ? 'items-grid' : undefined} role="list">{group.items.map(choice => <li key={`${choice.kind}:${choice.id}`}>
                    <button className={dialog ? 'grid-item' : 'element-choice'} type="button"
                        ref={dialog ? button => { if (button) fillDeviceCard(button, choice, choice.kind) } : undefined}
                        title={elementDescription(choice.kind, choice.id, choice.name, choice.description)} disabled={busy} onClick={() => void add(choice)}>
                        {!dialog && <><ElementIcon src={elementIcon(choice.kind, choice.id)} title={elementDescription(choice.kind, choice.id, choice.name, choice.description)} />
                            <span>{choice.name}</span></>}
                    </button>
                </li>)}</ul>
            </section>)}
            {filtered.length === 0 && !error && <p role="status">{filter || classification ? `No ${direction}s match the selected filters` : `No ${direction}s available`}</p>}
        </>}
    </div>
}
