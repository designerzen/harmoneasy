import React from 'react'
import { elementIcon } from './element-icons'
import { ElementIcon } from './ElementIcon'
import { PRESETS, type TransformerPreset } from 'audiobus/io/transformer-presets'

export function PresetOptions({ presets = PRESETS }: { presets?: TransformerPreset[] }) {
    return <>{[...new Set(presets.map(preset => preset.category))].map(category => <optgroup key={category} label={category}>
        {presets.filter(preset => preset.category === category).map(preset =>
            <option key={preset.id} value={preset.id}>{preset.name}</option>)}
    </optgroup>)}</>
}

export function PresetDetails({ preset }: { preset: TransformerPreset }) {
    return <article className="preset-details">
        <span className="preset-category">{preset.category}</span>
        <h3>{preset.name}</h3>
        <p>{preset.description}</p>
        <h4>Why use it</h4>
        <p>{preset.useCase}</p>
        <h4>Transformers, in order</h4>
        <ol>{preset.steps.map((step, index) => <li key={`${step.type}:${index}`}>
            <ElementIcon src={elementIcon('transformer', step.type)} />{step.summary}
        </li>)}</ol>
        <p className="preset-hint">Uses this chain’s input and instrument. Adjust the transformer settings after applying.</p>
    </article>
}
