import React, { useState, useId } from "react"
import { tranformerFactory } from "../../libs/audiobus/io/transformer-factory"
import type IOChain from "../../libs/audiobus/io/IO-chain"
import { PRESETS } from "../../libs/audiobus/io/transformer-presets"

export function Presets() {
   const filterId = useId()
   const [presetsFilterText, setPresetFilterText] = useState("")
 
    const filteredPresets = PRESETS.filter(preset => {
		const filterTerm = presetsFilterText.toLowerCase()
		return preset.name.toLowerCase().includes(filterTerm) || preset.transformers.includes(filterTerm)
    })

    const onSetPreset = (transformers: string[]) => () => {
        const chain = (window as any).chain as IOChain
		chain.setTransformers( transformers.map(tranformerFactory) )
    }

    return (<details open className="presets">
            <summary>Presets</summary>

			<label className="filter-label" htmlFor={filterId}>
				<input 
					id={filterId}
					type="search"
					placeholder="Filter presets..."
					value={presetsFilterText}
					onChange={(e) => setPresetFilterText(e.target.value)}
				/>
				{/* <button type="button">Filter</button> */}
			</label>

			<ul className="presets-list" role="list">
				{ 
					filteredPresets.map( (preset) => ( 
						<li key={preset.name}>
							<button type="button" title={preset.description} onClick={onSetPreset(preset.transformers)}>
								{preset.icon && <img src={preset.icon} alt={preset.name} className="preset-icon" />}
								<span>{preset.name}</span>
							</button>
						</li>
					) ) 
				}
				{filteredPresets.length === 0 && (
					<li className="no-matches">
						<p className="error-message">No presets match "{presetsFilterText}"</p>
					</li>
				)}
			</ul>
        </details>)
}