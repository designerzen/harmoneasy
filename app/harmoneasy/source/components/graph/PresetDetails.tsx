import React from 'react'
import { elementDescription, elementIcon } from './element-icons'
import { ElementIcon } from './ElementIcon'
import { PresetArtwork } from './PresetArtwork'
import { presetContext, presetSound } from './preset-catalogue'
import type { TransformerPreset } from 'audiobus/io/transformer-presets'

export function PresetDetails({ preset }: { preset: TransformerPreset }) {
    return <article className="preset-details">
        <PresetArtwork preset={preset} />
        <span className="preset-category">{preset.category}</span>
        <h3>{preset.name}</h3>
        <p>{preset.description}</p>
        <h4>Why use it</h4>
        <p>{preset.useCase}</p>
        {presetSound(preset) && <><h4>Outputs</h4><p>{presetSound(preset)}</p></>}
        <details open className="preset-steps"><summary>How it works · {preset.steps.length} {preset.steps.length === 1 ? 'step' : 'steps'}</summary>
        {!preset.steps.length && <p>Notes pass through unchanged, preserving the pitch, timing and length you play.</p>}
        <ol>{preset.steps.map((step, index) => <li key={`${step.type}:${index}`} title={elementDescription('transformer', step.type, step.type)}>
            <ElementIcon src={elementIcon('transformer', step.type)} title={elementDescription('transformer', step.type, step.type)} />{step.summary}
        </li>)}</ol></details>
        <p className="preset-hint">{presetContext(preset) ? 'A new chain includes only the outputs listed above. Applying to an existing chain keeps its current inputs and outputs.' : 'Keeps the notes you play as the starting point and processes them in the order above. Uses your chain’s input and instrument.'} Change the key, tempo and transformer settings to suit your piece.</p>
    </article>
}
