import { Handle, Position } from "@xyflow/react"
import React, { useCallback } from "react"
import { showDialogFromTemplate } from "../../../libs/dialog-utils.ts"
import { getAvailableInputFactories, createInputById } from 'audiobus/io/input-factory.ts'
import type IOChain from 'audiobus/io/IO-chain.ts'

export function StartNode(props) {

	const chain = (window as any).chain as IOChain

	const addInput = useCallback(async () => {
		const factories = getAvailableInputFactories()
		const availableFactories = factories.filter((factory) => factory.isAvailable?.() !== false)
		
		if (availableFactories.length === 0) {
			console.warn("No available inputs to add")
			return
		}

		const dialogOptions = availableFactories.map((factory) => ({
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

	const isVertical = props.data.layoutMode === 'vertical'

    return <div className="node-start graph-node">
        <h6>Inputs</h6>
		<label>
			<span className="sr-only">Add Input Device</span>
			<button className="cta btn-add" type="button" onClick={addInput}>Add</button>
		</label>
		<Handle type="source" position={isVertical ? Position.Bottom : Position.Right} />
		<Handle type="target" position={isVertical ? Position.Top : Position.Left} />
    </div>
}


