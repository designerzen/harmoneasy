import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { DevicePicker } from './DevicePicker'
import type AbstractInput from 'audiobus/io/inputs/abstract-input'
import type { IAudioOutput } from 'audiobus/io/outputs/output-interface'

export function DeviceDialog({ direction, replacing, onClose }: { direction: 'input' | 'output'; replacing?: AbstractInput | IAudioOutput; onClose: () => void }) {
    const dialog = useRef<HTMLDialogElement>(null)
    const title = `${replacing ? 'Swap' : 'Add New'} ${direction === 'input' ? 'Input' : 'Output'}`
    useEffect(() => {
        dialog.current?.setAttribute('closedby', 'any')
        dialog.current?.showModal()
    }, [])
    return createPortal(<dialog ref={dialog} className={`add-${direction}-dialog nodrag nopan nowheel`} aria-label={title}
        onClose={onClose} onKeyDown={event => event.stopPropagation()}>
        <header><h5>{title}</h5></header>
        <div className="dialog-content">
            <DevicePicker direction={direction} replacing={replacing} dialog onAdded={() => dialog.current?.close()} />
        </div>
        <form method="dialog">
            <button className="btn-close" type="submit" aria-label={`Cancel ${replacing ? 'swapping' : 'adding'} ${direction}`} title="Cancel">×</button>
        </form>
    </dialog>, document.body)
}
