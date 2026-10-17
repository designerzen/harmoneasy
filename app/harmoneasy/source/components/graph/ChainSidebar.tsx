import React, { useId, useRef, useState } from 'react'
import { TransformerPicker } from './Transformers'
import { DevicePicker } from './DevicePicker'

const tabs = ['Inputs', 'Transformers', 'Outputs'] as const

export function ChainSidebar() {
    const id = useId()
    const [active, setActive] = useState<number | null>(null)
    const buttons = useRef<(HTMLButtonElement | null)[]>([])
    return <aside className="chain-sidebar nodrag nopan nowheel" data-open={active !== null} aria-label="Add to chain">
        <div className="chain-sidebar-tabs" role="tablist" aria-label="Chain elements" aria-orientation="vertical">
            {tabs.map((label, index) => <button key={label} ref={element => { buttons.current[index] = element }}
                id={`${id}-tab-${index}`} type="button" role="tab" aria-selected={active === index}
                aria-controls={`${id}-panel-${index}`} tabIndex={(active ?? 0) === index ? 0 : -1}
                onClick={() => setActive(index)} onKeyDown={event => {
                    const next = event.key === 'ArrowDown' ? (index + 1) % tabs.length
                        : event.key === 'ArrowUp' ? (index + tabs.length - 1) % tabs.length
                        : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null
                    if (next === null) return
                    event.preventDefault()
                    setActive(next)
                    buttons.current[next]?.focus()
                }}>{label}</button>)}
        </div>
        {tabs.map((label, index) => <div key={label} role="tabpanel" id={`${id}-panel-${index}`}
            aria-labelledby={`${id}-tab-${index}`} hidden={active !== index} className="chain-sidebar-panel">
            {active === index && <>
                <button className="chain-sidebar-close" type="button" aria-label="Close sidebar" title={`Close ${label}`} onClick={() => {
                    setActive(null)
                    buttons.current[index]?.focus()
                }}>
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="m14 6-6 6 6 6M8 12h12" />
                    </svg>
                </button>
                <div className="chain-sidebar-content">
                    {index === 1 ? <TransformerPicker /> : <DevicePicker direction={index === 0 ? 'input' : 'output'} />}
                </div>
            </>}
        </div>)}
    </aside>
}
