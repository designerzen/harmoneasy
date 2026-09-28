import React from 'react'
import { useChain } from './ChainContext'

export function SharedDevices({ direction }: { direction: 'input' | 'output' }) {
    const { chainId, manager } = useChain()
    const available = manager.devices.filter(device => device.direction === direction && !device.chains.has(chainId))
    if (!available.length) return null
    return <label className="shared-device-selector nodrag nopan nowheel">
        Use existing {direction}
        <select value="" onChange={event => {
            if (event.target.value) manager.attachDevice(chainId, event.target.value)
        }}>
            <option value="">Choose a device</option>
            {available.map(entry => <option key={entry.id} value={entry.id}>{entry.device.name}</option>)}
        </select>
    </label>
}
