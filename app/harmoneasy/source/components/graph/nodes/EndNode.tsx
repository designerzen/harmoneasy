import React, { useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import { DeviceDialog } from '../DeviceDialog'
import { SharedDevices } from '../SharedDevices'

export function EndNode({ data }: { data?: { layoutMode?: string }; id?: string }) {
    const [open, setOpen] = useState(false)
    const vertical = data?.layoutMode === 'vertical'
    return <div className="node-end graph-node">
        <h6>Outputs</h6>
        <SharedDevices direction="output" />
        <button className="cta btn-add nodrag nopan" type="button" onClick={() => setOpen(true)}>
            Add New Output
        </button>
        <Handle type="source" position={vertical ? Position.Bottom : Position.Right} />
        <Handle type="target" position={vertical ? Position.Top : Position.Left} />
        {open && <DeviceDialog direction="output" onClose={() => setOpen(false)} />}
    </div>
}
