import { Handle, Position } from "@xyflow/react"
import React, { useCallback } from "react"

export function EndNode() {

	const chain = (window as any).chain as IOChain
	const outputManager:OutputManager = chain.outputManager


	const addOutput = useCallback(() => {
		// chain.addInput(output)
	}, [outputManager])


    return <div className="node-end graph-node">
        <h6>Outputs</h6>
		<label>
			<span className="sr-only">Add Output Device</span>
			<button className="cta btn-add" type="button">Add</button>
		</label>
		<Handle type="source" position={Position.Right} />
		<Handle type="target" position={Position.Left} />
    </div>
}