import React, { useEffect, useId, useRef, useState } from 'react'
import { useChain } from './ChainContext'
import { SharedDevices } from './SharedDevices'
import { elementIcon } from './element-icons'
import { ElementIcon } from './ElementIcon'
import { createInstrumentById, getAvailableInstrumentFactories } from 'audiobus/instruments/instrument-factory-ui.ts'

type Choice = { id: string; name: string; description: string; kind: 'input' | 'output' | 'instrument' }

export function DevicePicker({ direction }: { direction: 'input' | 'output' }) {
    const { chain, manager } = useChain()
    const filterId = useId()
    const [choices, setChoices] = useState<Choice[]>([])
    const [filter, setFilter] = useState('')
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const adding = useRef(false)
    const [error, setError] = useState('')

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        setChoices([])
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
        } catch (error) { setError(String(error)) }
        finally { adding.current = false; setBusy(false) }
    }
    const filtered = choices.filter(choice => `${choice.name} ${choice.description}`.toLowerCase().includes(filter.toLowerCase()))
    return <div className="device-picker" aria-busy={loading || busy}>
        <label className="filter-label" htmlFor={filterId}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" />
            </svg>
            <input id={filterId} type="search" aria-label={`Search ${direction}s`}
                placeholder={`Filter ${direction}s...`} value={filter} onChange={event => setFilter(event.target.value)} />
        </label>
        <SharedDevices direction={direction} />
        {error && <p role="alert">{error}</p>}
        {loading ? <p role="status">Loading {direction}s…</p> : <>
            {(['input', 'output', 'instrument'] as const).map(kind => {
                const items = filtered.filter(choice => choice.kind === kind)
                return items.length > 0 && <section key={kind} aria-label={`${kind}s`}>
                    {kind === 'instrument' && <h6>Instruments</h6>}
                    <ul role="list">{items.map(choice => <li key={choice.id}>
                        <button className="element-choice" type="button" title={choice.description} disabled={busy} onClick={() => void add(choice)}>
                            <ElementIcon src={elementIcon(choice.kind, choice.id)} />
                            <span>{choice.name}</span>
                        </button>
                    </li>)}</ul>
                </section>
            })}
            {filtered.length === 0 && !error && <p role="status">{filter ? `No ${direction}s match "${filter}"` : `No ${direction}s available`}</p>}
        </>}
    </div>
}
