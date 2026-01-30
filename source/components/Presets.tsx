import React, { useState } from "react"
import { tranformerFactory } from "../libs/audiobus/io/transformer-factory"
import { PRESETS } from "./graph/presets"
import type IOChain from "../libs/audiobus/io/IO-chain"

export function Presets() {
    const [presetsFilterText, setPresetFilterText] = useState("")

    const filteredPresets = PRESETS.filter(preset => {
        const filterTerm = presetsFilterText.toLowerCase()
        return preset.name.toLowerCase().includes(filterTerm) || preset.transformers.includes(filterTerm)
    })

    const onSetPreset = (transformers: string[]) => () => {
        const chain = (window as any).chain as IOChain
        chain.setTransformers(transformers.map(tranformerFactory))
    }

    return (
        <section className="presets-section">
            <h3>Presets</h3>

            <label className="filter-label">
                <input
                    id="filter-presets"
                    type="search"
                    placeholder="Filter presets..."
                    value={presetsFilterText}
                    onChange={(e) => setPresetFilterText(e.target.value)}
                />
            </label>

            <ul id="presets-list" role="list">
                {
                    filteredPresets.map((preset) => (
                        <li key={preset.name}>
                            <button
                                type="button"
                                title={preset.description}
                                onClick={onSetPreset(preset.transformers)}
                            >
                                {preset.name}
                            </button>
                        </li>
                    ))
                }
                {filteredPresets.length === 0 && (
                    <li className="no-matches">
                        <p className="error-message">No presets match "{presetsFilterText}"</p>
                    </li>
                )}
            </ul>
        </section>
    )
}
