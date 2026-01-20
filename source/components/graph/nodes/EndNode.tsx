import { Handle, Position } from "@xyflow/react"
import React, { useCallback } from "react"
import { showDialogFromTemplate } from "../../../libs/dialog-utils.ts"
import { getAvailableOutputFactories, createOutputById } from "../../../libs/output-factory.ts"
import type IOChain from "../../../libs/audiobus/IO-chain.ts"

export function EndNode() {

	const chain = (window as any).chain as IOChain

	const addOutput = useCallback(async () => {
		const factories = getAvailableOutputFactories()
		
		if (factories.length === 0) {
			console.warn("No available outputs to add")
			return
		}

		const dialogOptions = factories.map((factory) => ({
			id: factory.id,
			label: factory.name,
			description: factory.description,
			icon: factory.icon,
			onClick: async () => {
				try {
					const output = await createOutputById(factory.id)
					chain.addOutput(output)
				} catch (error) {
					console.error(`Failed to create output "${factory.name}":`, error)
					throw error
				}
			},
		}))

		await showDialogFromTemplate("add-output-overlay-template", dialogOptions)
	}, [])

    return <div className="node-end graph-node">
        <h6>Outputs</h6>
		<label>
			<span className="sr-only">Add Output Device</span>
			<button className="cta btn-add" type="button" onClick={addOutput}>Add</button>
		</label>
		<Handle type="source" position={Position.Right} />
		<Handle type="target" position={Position.Left} />
    </div>
}