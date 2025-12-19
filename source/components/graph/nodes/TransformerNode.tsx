import { Handle, Position } from "@xyflow/react"
import React, { memo, useCallback } from "react"

/**
 * SelectField component - memoized to prevent unnecessary re-renders
 * GAH React is so crap it doesn't allow modern html already landed in browsers
 */
const SelectField = memo(function SelectField({ values, onChange, defaultValue }) {
    return <select suppressHydrationWarning={true} defaultValue={defaultValue ?? ''}>
		<button className="btn-select">
			<selectedcontent></selectedcontent>
		</button>

        {values.map((v) => {
            const isObject = typeof v === 'object' && v !== null
            const value = isObject ? v.value : v
            const name = isObject ? v.name : v
            return ( <option 
			 	onClick={() => onChange({ target: { value } })}
				key={value} 
				value={value}>
					{name}
				</option>)
        })}
    </select>
}, (prevProps, nextProps) => {
    // Custom comparison: only re-render if values, onChange, or defaultValue change
    return (
        prevProps.defaultValue === nextProps.defaultValue &&
        prevProps.values.length === nextProps.values.length &&
        prevProps.values.every((v, i) => {
            const curr = nextProps.values[i]
            const prevVal = typeof v === 'object' ? v.value : v
            const currVal = typeof curr === 'object' ? curr.value : curr
            return prevVal === currVal
        })
    )
})

/**
 * ConfigField component - memoized to prevent unnecessary re-renders
 */
const ConfigField = memo(function ConfigField({ config, element }) {
    const handleChange = useCallback((v) => {
        element.setConfig(config.name, v.target.value)
    }, [config.name, element])

    return <label>{config.name}
        { config.type === 'select' ? <SelectField values={config.values} defaultValue={config.default} onChange={handleChange} /> : 'unknown' }
    </label>
}, (prevProps, nextProps) => {
    // Only re-render if config values changed
    return (
        prevProps.config.name === nextProps.config.name &&
        prevProps.config.default === nextProps.config.default &&
        (prevProps.config.values?.length ?? 0) === (nextProps.config.values?.length ?? 0) &&
        prevProps.element === nextProps.element
    )
})

/**
 * TransformerNode component
 * Uses useCallback for event handlers to maintain referential equality
 * 
 * NOTE: Removed memo optimization due to stale closure issues with props.data.element
 * The memo was preventing proper updates when transformers were removed, causing
 * the element reference to become stale in the callback closure.
 */
export function TransformerNode(props) {
    const removeNode = useCallback(() => {
        window.transformerManager.removeTransformer(props.data.element)
    }, [props.data.element])

    const moveBack = useCallback(() => {
        window.transformerManager.moveOneStepBefore(props.data.element)
    }, [props.data.element])

    const moveForwards = useCallback(() => {
        window.transformerManager.moveOneStepAfter(props.data.element)
    }, [props.data.element])

    const shouldShowMoveButtons = window.transformerManager.quantity > 1

    return <div className={`node-transformer graph-node category-${props.data.element.category.toLowerCase()}`}>
        <h6 title={props.data.description}>{props.data.label}</h6>
      
	  	<details>
			<summary>Details</summary>
			<p>{props.data.description}</p>
		</details>

        <button type="button" className="btn-remove" onClick={removeNode}>Remove</button>
      
        {props.data.fields.map( (f,i) => (
            <ConfigField key={`${f.uuid}-${i}`} config={f} element={props.data.element} />
        ))}

		{ shouldShowMoveButtons ? 
			(<menu className="buttons-back">
					<button className="btn-previous" onClick={moveBack}>Move before</button>
					<button className="btn-next" onClick={moveForwards}>Move after</button>
			</menu>) : null 
		}

        <Handle type="source" position={Position.Right} />
        <Handle type="target" position={Position.Left} />
    </div>
}