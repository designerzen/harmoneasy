import { Handle, Position } from "@xyflow/react"
import React, { useCallback } from "react"
import { showDialogFromTemplate } from "../../../libs/dialog-utils.ts"
import { getAvailableInputFactories, createInputById } from "../../../libs/audiobus/io/input-factory.ts"
import type IOChain from "../../../libs/audiobus/io/IO-chain.ts"

export function StartNode(props) {

	const chain = (window as any).chain as IOChain

	const addInput = useCallback(async () => {
		const factories = getAvailableInputFactories()
		
		if (factories.length === 0) {
			console.warn("No available inputs to add")
			return
		}

		const dialogOptions = factories.map((factory) => ({
			id: factory.id,
			label: factory.name,
			description: factory.description,
			onClick: async () => {
				try {
					const input = await createInputById(factory.id)
					chain.addInput(input)
				} catch (error) {
					console.error(`Failed to create input "${factory.name}":`, error)
					throw error
				}
			},
		}))

		await showDialogFromTemplate("add-input-overlay-template", dialogOptions)
	}, [])

    return <div className="node-start graph-node">
        <h6>Inputs</h6>
		<label>
			<span className="sr-only">Add Input Device</span>
			<button className="cta btn-add" type="button" onClick={addInput}>Add</button>
		</label>
		<Handle type="source" position={Position.Right} />
		<Handle type="target" position={Position.Left} />
    </div>
}