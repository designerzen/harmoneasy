import React from 'react'
import { useChain } from './ChainContext'
import { deviceIcon, elementDescription } from './element-icons'
import { ElementIcon } from './ElementIcon'
import { deviceDefinition } from 'audiobus/io/device-definition'
import { INPUT_DEFINITIONS } from 'audiobus/io/input-definitions'
import { OUTPUT_DEFINITIONS } from 'audiobus/io/output-definitions'
import { INSTRUMENTS } from 'audiobus/instruments/instrument-types'
import { choiceMatches } from './device-filters'

export function SharedDevices({ direction, search = '', selection = '', disabled = false, onSelect }: { direction: 'input' | 'output'; search?: string; selection?: string; disabled?: boolean; onSelect?: (device: any) => void }) {
    const { chainId, manager } = useChain()
    const available = manager.devices.filter(entry => {
        if (entry.direction !== direction || entry.chains.has(chainId)) return false
        try {
            const definition = deviceDefinition(entry.device)
            const metadata = definition.factory === 'instrument' ? INSTRUMENTS.get(definition.type!)
                : (direction === 'input' ? INPUT_DEFINITIONS : OUTPUT_DEFINITIONS)[definition.type!]
            if (metadata) return choiceMatches({ ...metadata, name: entry.device.name, description: entry.device.description }, search, selection)
        } catch { /* External devices may not have registered metadata. */ }
        return !selection && `${entry.device.name} ${entry.device.description}`.toLowerCase().includes(search.trim().toLowerCase())
    })
    if (!available.length) return null
    return <section className="shared-device-selector nodrag nopan nowheel" aria-label={`Use existing ${direction}`}>
        <h6>Use existing {direction}</h6>
        <ul>{available.map(entry => <li key={entry.id}>
            <button className="element-choice" type="button" disabled={disabled} onClick={() => onSelect ? onSelect(entry.device) : manager.attachDevice(chainId, entry.id)}
                title={elementDescription(direction, entry.id, entry.device.name, entry.device.description)}>
                <ElementIcon src={deviceIcon(entry.device, direction)} title={elementDescription(direction, entry.id, entry.device.name, entry.device.description)} />
                <span>{entry.device.name}</span>
            </button>
        </li>)}</ul>
    </section>
}
