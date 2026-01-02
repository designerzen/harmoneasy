import { Handle, Position } from "@xyflow/react"
import React from "react"

export function StartNode() {
    return <div className="node-start graph-node">
        <h6>Input</h6>
		<p>All</p>
		<Handle type="source" position={Position.Right} />
		<Handle type="target" position={Position.Left} />
    </div>
}