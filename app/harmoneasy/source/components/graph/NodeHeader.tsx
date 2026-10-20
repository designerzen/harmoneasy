import React from 'react'

export function NodeHeader({ title, removeLabel, onRemove, swap, children, enabled }: {
    title: React.ReactNode
    removeLabel: string
    onRemove: () => void
    swap: React.ReactNode
    children: React.ReactNode
    enabled?: boolean
}) {
    return <header className="device-node-header node-actions" data-enabled={enabled}>
        <div className="device-title-controls nodrag nopan">
            <div className="node-actions-left">
                <button type="button" className="device-remove" title={removeLabel} aria-label={removeLabel} onClick={onRemove}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
                </button>
                {swap}
            </div>
            <div className="node-actions-right">{children}</div>
        </div>
        <h6>{title}</h6>
    </header>
}
