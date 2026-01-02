import { Handle, Position } from "@xyflow/react"
import React from "react"

export function OutputNode(props) {
	return <div className="node-output graph-node">
		<h6>{props.data.label ?? "Output"}</h6>
		<Handle type="target" position={Position.Left} />
	</div>
}