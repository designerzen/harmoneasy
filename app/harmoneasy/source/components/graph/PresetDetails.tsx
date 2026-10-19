import React from 'react'
import { elementDescription, elementIcon } from './element-icons'
import { ElementIcon } from './ElementIcon'
import { PresetArtwork } from './PresetArtwork'
import type { TransformerPreset } from 'audiobus/io/transformer-presets'

export function PresetDetails({ preset }: { preset: TransformerPreset }) {
    return <article className="preset-details">
        <PresetArtwork preset={preset} />
        <span className="preset-category">{preset.category}</span>
        <h3>{preset.name}</h3>
        <p>{preset.description}</p>
        <h4>Why use it</h4>
        <p>{preset.useCase}</p>
        <details className="preset-steps"><summary>How it works · {preset.steps.length} steps</summary>
        <ol>{preset.steps.map((step, index) => <li key={`${step.type}:${index}`} title={elementDescription('transformer', step.type, step.type)}>
            <ElementIcon src={elementIcon('transformer', step.type)} title={elementDescription('transformer', step.type, step.type)} />{step.summary}
        </li>)}</ol></details>
        <p className="preset-hint">Uses this chain’s input and instrument. Adjust the transformer settings after applying.</p>
    </article>
}
