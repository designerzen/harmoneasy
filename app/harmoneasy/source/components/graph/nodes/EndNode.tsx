import { Handle, Position } from "@xyflow/react"
import React, { useCallback } from "react"
import { showDialogFromTemplate } from "../../../libs/dialog-utils.ts"
import { getAvailableOutputFactories, createOutputById } from 'audiobus/io/output-factory.ts'
import type IOChain from 'audiobus/io/IO-chain.ts'

export function EndNode(props) {

	const chain = (window as any).chain as IOChain
	const isVertical = props.data?.layoutMode === 'vertical'

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
		<Handle type="source" position={isVertical ? Position.Bottom : Position.Right} />
		<Handle type="target" position={isVertical ? Position.Top : Position.Left} />
    </div>
}


