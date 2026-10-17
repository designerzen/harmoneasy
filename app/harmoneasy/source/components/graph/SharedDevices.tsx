import React from 'react'
import { useChain } from './ChainContext'
import { deviceIcon } from './element-icons'

export function SharedDevices({ direction }: { direction: 'input' | 'output' }) {
    const { chainId, manager } = useChain()
    const available = manager.devices.filter(device => device.direction === direction && !device.chains.has(chainId))
    if (!available.length) return null
    return <section className="shared-device-selector nodrag nopan nowheel" aria-label={`Use existing ${direction}`}>
        <h6>Use existing {direction}</h6>
        <ul>{available.map(entry => <li key={entry.id}>
            <button className="element-choice" type="button" onClick={() => manager.attachDevice(chainId, entry.id)}>
                <img className="element-icon" src={deviceIcon(entry.device, direction)} alt="" />
                <span>{entry.device.name}</span>
            </button>
        </li>)}</ul>
    </section>
}
