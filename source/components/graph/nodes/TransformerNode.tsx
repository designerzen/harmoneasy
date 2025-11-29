import { Handle, Position } from "@xyflow/react";
import React from "react";

function SelectField({ values, onChange }) {
    return <select onChange={onChange}>
        {values.map(v => {
            const isObject = typeof v === 'object' && v !== null;
            const value = isObject ? v.value : v;
            const name = isObject ? v.name : v;
            return <option key={value} value={value}>{name}</option>;
        })}
    </select>
}

function ConfigField({ config, element}) {
    return <div>
        <div>{config.name}</div>
        { config.type === 'select' ? <SelectField values={config.values} onChange={(v) => element.setConfig(config.name, v)} /> : 'unknown' }
        </div>
}

export function TransformerNode(props) {
    console.log('PROPS', props)
    const removeNode = () => {
        window.transformerManager.removeTransformer(props.data.element)
    }
    return <div className="node-transformer graph-node">
        <div>{props.data.label} <button className="button-remove" onClick={removeNode}>X</button></div>
        {props.data.fields.map(f => (
            <ConfigField config={f} element={props.data.element} />
        ))}

        <Handle type="source" position={Position.Right} />
      <Handle type="target" position={Position.Left} />
    </div>
}