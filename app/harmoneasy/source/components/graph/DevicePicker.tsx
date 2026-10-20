import React, { useEffect, useId, useRef, useState } from 'react'
import { useChain } from './ChainContext'
import { SharedDevices } from './SharedDevices'
import { elementDescription, elementIcon } from './element-icons'
import { ElementIcon } from './ElementIcon'
import { createInstrumentById, getAvailableInstrumentFactories } from 'audiobus/instruments/instrument-factory-ui.ts'

import { ClassificationFilter } from './ClassificationFilter'
import { choiceMatches, groupChoices, type ClassifiedChoice } from './device-filters'
import { fillDeviceCard } from './device-card'
import { loadMidiProfilesForPorts, matchMidiDeviceProfile, MIDI_DEVICE_PROFILES, onMidiDeviceProfilesChanged } from 'audiobus/midi/hardware/device-profiles'
import { sharedWebMidi } from 'audiobus/midi/shared-webmidi'
import { EVENT_DEVICE_LIST_CHANGED, EVENT_READY } from 'audiobus/event-constants'
import type AbstractInput from 'audiobus/io/inputs/abstract-input'
import type { IAudioInput } from 'audiobus/io/inputs/input-interface'
import type { IAudioOutput } from 'audiobus/io/outputs/output-interface'

type Choice = ClassifiedChoice & { kind: 'input' | 'output' | 'instrument'; factoryId?: string; midiOptions?: Record<string, any>; midiPortId?: string; profileId?: string }

export function DevicePicker({ direction, replacing, dialog = false, onAdded }: { direction: 'input' | 'output'; replacing?: AbstractInput | IAudioOutput; dialog?: boolean; onAdded?: () => void }) {
    const { chain, manager } = useChain()
    const filterId = useId()
    const [choices, setChoices] = useState<Choice[]>([])
    const [profileRevision, setProfileRevision] = useState(0)
    useEffect(() => onMidiDeviceProfilesChanged(() => setProfileRevision(value => value + 1)), [])
    const [, setMidiRevision] = useState(0)
    useEffect(() => {
        const changed = () => {
            setMidiRevision(value => value + 1)
            void loadMidiProfilesForPorts(direction === 'input' ? sharedWebMidi.inputs : sharedWebMidi.outputs)
                .catch(error => console.debug('MIDI device descriptions unavailable', error))
        }
        sharedWebMidi.addEventListener(EVENT_DEVICE_LIST_CHANGED, changed)
        sharedWebMidi.addEventListener(EVENT_READY, changed)
        changed()
        return () => {
            sharedWebMidi.removeEventListener(EVENT_DEVICE_LIST_CHANGED, changed)
            sharedWebMidi.removeEventListener(EVENT_READY, changed)
        }
    }, [direction])
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
    }, [chain, direction, profileRevision])

    const select = (device: IAudioInput | IAudioOutput) => {
        if (replacing) manager.replaceDevice(chain, replacing, device, direction)
        else manager.addDevice(chain, device, direction)
        onAdded?.()
    }
    const add = async (choice: Choice) => {
        if (adding.current) return
        adding.current = true
        setBusy(true)
        setError('')
        try {
            if (choice.midiPortId && !(direction === 'input' ? sharedWebMidi.inputs : sharedWebMidi.outputs).some(port => port.id === choice.midiPortId)) {
                throw new Error(`${choice.name} is no longer connected. Choose another MIDI device.`)
            }
            const ready = async (device: IAudioInput | IAudioOutput) => {
                if (choice.midiOptions) {
                    try {
                        await device.connect?.()
                        if (choice.midiPortId && !(direction === 'input' ? sharedWebMidi.inputs : sharedWebMidi.outputs).some(port => port.id === choice.midiPortId)) {
                            throw new Error(`${choice.name} disconnected while being added. Choose another MIDI device.`)
                        }
                    }
                    catch (error) { await (device as any).destroy?.(); throw error }
                }
                return device
            }
            if (choice.kind === 'input') {
                const { createInputById } = await import('audiobus/io/input-factory')
                select(await ready(await createInputById(choice.factoryId ?? choice.id,
                    choice.midiOptions ? { ...manager.deviceOptions, ...choice.midiOptions } : manager.deviceOptions)))
            } else {
                const audioContext = manager.audioContext || (manager.outputMixer as any)?.context
                const options = manager.outputMixer ? { mixer: manager.outputMixer, audioContext } : undefined
                if (choice.kind === 'instrument') {
                    select(await createInstrumentById(audioContext, choice.id, options))
                } else {
                    const { createOutputById } = await import('audiobus/io/output-factory')
                    select(await ready(await createOutputById(choice.factoryId ?? choice.id,
                        choice.midiOptions ? { ...options, ...choice.midiOptions } : options)))
                }
            }
        } catch (error) { setError(String(error)) }
        finally { adding.current = false; setBusy(false) }
    }
    const midiFactory = choices.find(choice => choice.id === 'webmidi' && choice.kind === direction)
    const midiPorts = direction === 'input' ? sharedWebMidi.inputs : sharedWebMidi.outputs
    const connectedChoices: Choice[] = midiFactory ? midiPorts.map(port => {
        const profileId = matchMidiDeviceProfile(port)
        const profile = profileId ? MIDI_DEVICE_PROFILES[profileId] : undefined
        return { ...midiFactory, id: `webmidi:${port.id}`, factoryId: direction === 'input' && profileId ? profileId : 'webmidi',
            profileId, midiPortId: port.id, name: port.name || profile?.name || port.id,
            description: [port.manufacturer, profile?.description || `Connected MIDI ${direction}`, `MIDI ID: ${port.id}`].filter(Boolean).join(' · '),
            midiOptions: { transport: 'webmidi', deviceId: port.id, selectedDevice: port.id, devices: [port.id], deviceName: port.name || port.id,
                ...(direction === 'input' ? { listenToAllDevices: false } : { sendToAllDevices: false }) } }
    }) : []
    if (midiFactory && midiPorts.length) connectedChoices.push({ ...midiFactory, id: 'webmidi:all', factoryId: 'webmidi',
        name: `All MIDI ${direction}s`, description: `Use all connected MIDI ${direction} devices.`,
        midiOptions: { selectedDevice: '', devices: [], ...(direction === 'input' ? { listenToAllDevices: true } : { sendToAllDevices: true }) } })
    const availableChoices = [...choices.filter(choice => choice.id !== 'webmidi'
        && !(midiFactory && direction === 'input' && MIDI_DEVICE_PROFILES[choice.id])), ...connectedChoices]
    const filtered = availableChoices.filter(choice => choiceMatches(choice, filter, classification))
    return <div className="device-picker" aria-busy={loading || busy}>
        <div className="picker-filter-row">
        <label className={dialog ? 'dialog-filter' : 'filter-label'} htmlFor={filterId}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" />
            </svg>
            <input id={filterId} type="search" aria-label={`Search ${direction}s`}
                autoFocus={dialog} className={dialog ? 'filter-input-global' : undefined} placeholder={`Filter ${direction}s...`} value={filter} onChange={event => setFilter(event.target.value)} />
        </label>
        <ClassificationFilter compact choices={availableChoices} value={classification} onChange={setClassification} label={`Filter ${direction}s by type`} />
        </div>
        <SharedDevices direction={direction} search={filter} selection={classification} disabled={busy} onSelect={device => {
            try { select(device) } catch (error) { setError(String(error)) }
        }} />
        {error && <p role="alert">{error}</p>}
        {!loading && midiFactory && !midiPorts.length && <p role="status">No MIDI {direction} devices connected.</p>}
        {loading ? <p role="status">Loading {direction}s…</p> : <>
            {groupChoices(filtered).map(group => <section className="choice-group" key={`${group.type}:${group.subtype}`} aria-label={group.label}>
                <h6 className="section-title">{group.label}</h6>
                <ul className={dialog ? 'items-grid' : undefined} role="list">{group.items.map(choice => <li key={`${choice.kind}:${choice.id}`}>
                    <button className={dialog ? 'grid-item' : 'element-choice'} type="button"
                        ref={dialog ? button => {
                            if (!button) return
                            fillDeviceCard(button, { ...choice, id: choice.factoryId ?? choice.id }, choice.kind)
                            const profile = choice.profileId ? MIDI_DEVICE_PROFILES[choice.profileId] : undefined
                            const icon = button.querySelector<HTMLElement>('.item-icon')
                            if (profile?.icon && icon) icon.style.maskImage = `url("${profile.icon}")`
                        } : undefined}
                        title={choice.title ? `${choice.title}: ${choice.description}` : elementDescription(choice.kind, choice.id, choice.name, choice.description)} disabled={busy} onClick={() => void add(choice)}>
                        {!dialog && <><ElementIcon src={(choice.profileId ? MIDI_DEVICE_PROFILES[choice.profileId]?.icon : undefined) ?? elementIcon(choice.kind, choice.factoryId ?? choice.id)} title={elementDescription(choice.kind, choice.id, choice.name, choice.description)} />
                            <span>{choice.name}</span></>}
                    </button>
                </li>)}</ul>
            </section>)}
            {filtered.length === 0 && !error && <p role="status">{filter || classification ? `No ${direction}s match the selected filters` : `No ${direction}s available`}</p>}
        </>}
    </div>
}
