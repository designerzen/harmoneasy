import { Handle, Position } from "@xyflow/react"
import React from "react"

export function StartNode() {
    return <div className="node-start graph-node">
        <h6>Input</h6>
		<p>All</p>
		{/* Add Device Input selector */}
      	<Handle type="source" position={Position.Right} />
    </div>
}