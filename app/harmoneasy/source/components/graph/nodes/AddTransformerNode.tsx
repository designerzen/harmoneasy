import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Handle, Position } from '@xyflow/react'
import { TransformerPicker } from '../Transformers'
import type { Transformer } from 'audiobus/io/transformers/abstract-transformer'

export function TransformerDialog({ onClose, replacing }: { onClose: () => void; replacing?: Transformer<any> }) {
    const dialog = useRef<HTMLDialogElement>(null)
    const title = replacing ? 'Swap Transformer' : 'Add New Transformer'
    useEffect(() => {
        dialog.current?.setAttribute('closedby', 'any')
        dialog.current?.showModal()
    }, [])

    return createPortal(<dialog ref={dialog} className="add-transformer-dialog nodrag nopan nowheel" aria-label={title}
        onClose={onClose} onKeyDown={event => event.stopPropagation()}>
        <header><h5>{title}</h5></header>
        <div className="dialog-content">
            <TransformerPicker dialog replacing={replacing} onAdded={() => dialog.current?.close()} />
        </div>
        <form method="dialog">
            <button className="btn-close" type="submit" aria-label={`Cancel ${replacing ? 'swapping' : 'adding'} transformer`} title="Cancel">×</button>
        </form>
    </dialog>, document.body)
}

export function AddTransformerNode({ data }: { data?: { layoutMode?: string } }) {
    const [open, setOpen] = useState(false)
    const vertical = data?.layoutMode === 'vertical'
    return <div className="node-add-transformer graph-node">
        <h6>Transformers</h6>
        <button className="cta btn-add nodrag nopan" type="button" onClick={() => setOpen(true)}>
            Add New Transformer
        </button>
        <Handle type="target" position={vertical ? Position.Top : Position.Left} />
        <Handle type="source" position={vertical ? Position.Bottom : Position.Right} />
        {open && <TransformerDialog onClose={() => setOpen(false)} />}
    </div>
}
