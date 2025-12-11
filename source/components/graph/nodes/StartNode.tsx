import { Handle, Position } from "@xyflow/react"
import React from "react"

export function StartNode() {
    return <div className="node-start graph-node">
        <h6>Start</h6>
      	<Handle type="source" position={Position.Right} />
    </div>
}