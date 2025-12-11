import { Handle, Position } from "@xyflow/react"
import React from "react"

// Chrome and later browsers allow for custom selects!
function SelectField({ values, onChange }) {
    return <select onChange={onChange}>

		<button>Close</button>

        {values.map((v) => {
            const isObject = typeof v === 'object' && v !== null
            const value = isObject ? v.value : v
            const name = isObject ? v.name : v
            return <option key={value} value={value}>{name}</option>
        })}
    </select>
}

function ConfigField({ config, element}) {
    return <label>{config.name}
        { config.type === 'select' ? <SelectField values={config.values} onChange={(v) => {
            element.setConfig(config.name, v.target.value)
        }} /> : 'unknown' }
        </label>
}

export function TransformerNode(props) {
    const removeNode = () => {
        window.transformerManager.removeTransformer(props.data.element)
    }

    const moveBack = () => {
        window.transformerManager.moveOneStepBefore(props.data.element)
    }

    const moveForwards = () => {
        window.transformerManager.moveOneStepAfter(props.data.element)
    }

	console.info("TransformerNode", props )

    return <div className={`node-transformer graph-node category-${props.data.element.category.toLowerCase()}`}>
        <h6 title={props.data.description}>{props.data.label}</h6>
      
        <button type="button" className="btn-remove" onClick={removeNode}>Remove</button>
      
        {props.data.fields.map(f => (
            <ConfigField key={f.name} config={f} element={props.data.element} />
        ))}

        <menu className="buttons-back">
            <button className="btn-previous" onClick={moveBack}>Move before</button>
            <button className="btn-next" onClick={moveForwards}>Move after</button>
        </menu>

        <Handle type="source" position={Position.Right} />
        <Handle type="target" position={Position.Left} />
    </div>
}