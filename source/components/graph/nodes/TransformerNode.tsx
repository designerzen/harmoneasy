import { Handle, Position } from "@xyflow/react"
import React, { memo, useCallback } from "react"
import { ConfigField } from "../Widgets.tsx"

/**
 * TransformerNode component
 * Uses useCallback for event handlers to maintain referential equality
 * @param props - The props for the TransformerNode component
 */
export function TransformerNode(props) {

	const chain = (window as any).chain as IOChain
			
	const removeNode = useCallback(() => {
        chain.transformerManager.removeTransformer(props.data.element)
    }, [props.data.element])

    const moveBack = useCallback(() => {
        chain.transformerManager.moveOneStepBefore(props.data.element)
    }, [props.data.element])

    const moveForwards = useCallback(() => {
        chain.transformerManager.moveOneStepAfter(props.data.element)
    }, [props.data.element])

	const hasControls = props.data.fields.length
    const shouldShowMoveButtons = chain.transformerQuantity > 1

	const isVertical = props.data.layoutMode === 'vertical'

    return <div className={`node-transformer graph-node can-remove category-${props.data.element.category.toLowerCase()}`}>
        <h6>{props.data.label}</h6>
      
	  	<details>
			<summary className="summary-info" title={props.data.description}>Info</summary>
			<p>{props.data.description}</p>
		</details>

        <button type="button" className="btn-remove" onClick={removeNode}>Remove</button>
      
        {props.data.fields.map( (f,i) => (
            <ConfigField key={`${f.uuid}-${i}`} config={f} element={props.data.element} />
        ))}

		{ shouldShowMoveButtons ? 
			(<menu className="graph-node-menu">
				<button className="btn-previous" onClick={moveBack}>Move before</button>
				<button className="btn-next" onClick={moveForwards}>Move after</button>
			</menu>) : null 
		}

        <Handle type="source" position={isVertical ? Position.Bottom : Position.Right} />
        <Handle type="target" position={isVertical ? Position.Top : Position.Left} />
    </div>
}