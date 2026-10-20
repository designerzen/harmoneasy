import React, { useSyncExternalStore } from 'react'
import { EVENT_INPUTS_UPDATED, EVENT_OUTPUTS_UPDATED } from 'audiobus/event-constants'
import type AbstractInput from 'audiobus/io/inputs/abstract-input'
import type { IAudioOutput } from 'audiobus/io/outputs/output-interface'
import { useChain } from './ChainContext'
import { deviceIcon, elementDescription } from './element-icons'
import { ElementIcon } from './ElementIcon'

export function DeviceTitleBar({ device, direction, expanded, onExpand, onRemove }: {
    device: AbstractInput | IAudioOutput
    direction: 'input' | 'output'
    expanded: boolean
    onExpand: () => void
    onRemove: () => void
}) {
    const { chain } = useChain()
    const inputs = direction === 'input'
    const manager = inputs ? chain.inputManager : chain.outputManager
    const event = inputs ? EVENT_INPUTS_UPDATED : EVENT_OUTPUTS_UPDATED
    const enabled = useSyncExternalStore(callback => {
        manager.addEventListener(event, callback)
        return () => manager.removeEventListener(event, callback)
    }, () => inputs ? chain.inputManager.isEnabled(device as AbstractInput) : chain.outputManager.isEnabled(device as IAudioOutput))
    const toggle = () => {
        if (inputs) chain.setInputEnabled(device as AbstractInput, !enabled)
        else chain.outputManager.setEnabled(device as IAudioOutput, !enabled)
    }
    const toggleLabel = `${enabled ? 'Disable' : 'Enable'} ${direction}`
    const expandLabel = `${expanded ? 'Minimise' : 'Expand'} ${direction}`
    return <header className="device-node-header node-actions" data-enabled={enabled}>
        <h6><ElementIcon src={deviceIcon(device, direction)} title={elementDescription(direction, '', device.name, device.description)} />{device.name}</h6>
        <div className="device-title-controls nodrag nopan">
            <button type="button" className="device-expand" onClick={onExpand} autoFocus={expanded}
                aria-expanded={expanded} title={expandLabel} aria-label={expandLabel}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d={expanded ? 'M3 9h6V3m6 0v6h6M3 15h6v6m6 0v-6h6' : 'M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6'} /></svg>
            </button>
            <button type="button" className="device-toggle" aria-pressed={enabled} onClick={toggle}
                title={`${toggleLabel} in this chain`} aria-label={toggleLabel}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v9m-5-7a8 8 0 1 0 10 0" /></svg>
                <span>{enabled ? 'On' : 'Off'}</span>
            </button>
            <button type="button" className="device-remove" title={`Remove ${direction} from this chain`}
                aria-label={`Remove ${direction}`} onClick={onRemove}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
        </div>
    </header>
}
