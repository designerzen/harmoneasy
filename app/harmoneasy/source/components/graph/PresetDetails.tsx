import React from 'react'
import { elementDescription, elementIcon } from './element-icons'
import { ElementIcon } from './ElementIcon'
import type { TransformerPreset } from 'audiobus/io/transformer-presets'

export function PresetDetails({ preset }: { preset: TransformerPreset }) {
    return <article className="preset-details">
        <span className="preset-category">{preset.category}</span>
        <h3>{preset.name}</h3>
        <p>{preset.description}</p>
        <h4>Why use it</h4>
        <p>{preset.useCase}</p>
        <h4>Transformers, in order</h4>
        <ol>{preset.steps.map((step, index) => <li key={`${step.type}:${index}`} title={elementDescription('transformer', step.type, step.type)}>
            <ElementIcon src={elementIcon('transformer', step.type)} title={elementDescription('transformer', step.type, step.type)} />{step.summary}
        </li>)}</ol>
        <p className="preset-hint">Uses this chain’s input and instrument. Adjust the transformer settings after applying.</p>
    </article>
}
