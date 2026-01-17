import { Handle, Position } from "@xyflow/react"
import React, { useCallback } from "react"
import type InputManager from "../../../libs/audiobus/inputs/input-manager"

export function StartNode(props) {

	const chain = (window as any).chain as IOChain
	const inputManager:InputManager = chain.inputManager

	const addInpout = useCallback(() => {
		// chain.addInput(output)
	}, [inputManager])

    return <div className="node-start graph-node">
        <h6>Inputs</h6>
		<label>
			<span className="sr-only">Add Input Device</span>
			<button className="cta btn-add" type="button" onClick={addInpout}>Add</button>
		</label>
		<Handle type="source" position={Position.Right} />
		<Handle type="target" position={Position.Left} />
    </div>
}