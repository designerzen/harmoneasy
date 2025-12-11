import { Handle, Position } from "@xyflow/react"
import React from "react"

export function EndNode() {
    return <div className="node-end graph-node">
        <h6>End</h6>
        <Handle type="target" position={Position.Left} />
    </div>
}