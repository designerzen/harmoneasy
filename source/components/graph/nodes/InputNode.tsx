import { Handle, Position } from "@xyflow/react"
import React from "react"

export function InputNode(props) {
	return <div className="node-input graph-node">
		<h6>{props.data.label ?? "Input"}</h6>
		<Handle type="source" position={Position.Right} />
	</div>
}