import { Handle, Position } from "@xyflow/react";
import React from "react";

function SelectField({ values, onChange }) {
    return <select onChange={onChange}>
        {values.map(v => <option value={v}>{v}</option>)}
    </select>
}

function ConfigField({ config, element}) {
    return <div>
        <div>Name: {config.name}</div>
        { config.type === 'select' ? <SelectField values={config.values} onChange={(v) => element.setConfig(config.name, v)} /> : 'unknown' }
        </div>
}

export function TransformerNode(props) {
    console.log('PROPS', props)
    return <div className="node-transformer">
        <div>{props.data.label}</div>
        {props.data.fields.map(f => (
            <ConfigField config={f} element={props.data.element} />
        ))}

        <Handle type="source" position={Position.Right} />
      <Handle type="target" position={Position.Left} />
    </div>
}