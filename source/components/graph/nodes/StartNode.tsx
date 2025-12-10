import { Handle, Position } from "@xyflow/react"
import React from "react"

export function StartNode() {
    return <div className="node-start graph-node">
        <h5>Start</h5>
      	<Handle type="source" position={Position.Right} />
    </div>
}