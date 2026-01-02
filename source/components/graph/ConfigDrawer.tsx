import React, { useState } from "react"
import { 
    tranformerFactory,
    TRANSFORMER_TYPE,
    TRANSFORMERS
} from "../../libs/audiobus/transformers/transformer-factory"
import { PRESETS } from "./presets"
import type { TransformerManager } from "../../libs/audiobus/transformers/transformer-manager"
import type IOChain from "../../libs/audiobus/IO-chain"

export function ConfigDrawer() {

    const [transformersFilterText, setTransformersFilterText] = useState("")
    const [presetsFilterText, setPresetFilterText] = useState("")
 
    const filteredTransformers = TRANSFORMERS.filter(transformerId =>
        transformerId.toLowerCase().includes(transformersFilterText.toLowerCase())
    )
    const filteredPresets = PRESETS.filter(preset => {
		const filterTerm = presetsFilterText.toLowerCase()
		return preset.name.toLowerCase().includes(filterTerm) || preset.transformers.includes(filterTerm)
    })

	const onAdd = (transformerType: string) => () => {
		const chain = (window as any).chain as IOChain
        chain.appendTransformer( tranformerFactory(transformerType) )
    }

    const onSetPreset = (transformers: string[]) => () => {
        const chain = (window as any).chain as IOChain
		chain.setTransformers( transformers.map(tranformerFactory) )
    }

    return (<aside className="transformers-drawer">
        
        <details open className="transformers">
            <summary>{transformersFilterText.length > 2 && filteredTransformers.length > 0  ? transformersFilterText : 'Transformers'}</summary>
			
			<label className="filter-label">
				<input 
					id="filter-transformers" 
					type="search"
					placeholder="Filter transformers..."
					value={transformersFilterText}
					onChange={(e) => setTransformersFilterText(e.target.value)}
				/>
				{/* <button type="button">Filter</button> */}
			</label>

			<ul id="transformers-list" role="list">
				{ 
					filteredTransformers.map( (preset) => ( <li key={preset}><button type="button" onClick={onAdd(preset)}>{preset}</button></li>) ) 
				}
				{filteredTransformers.length === 0 && (
					<li className="no-matches">
						<p className="error-message">No transformers match "{presetsFilterText}"</p>
					</li>
				)}
			</ul>
        </details>

        <details open className="presets">
            <summary>Presets</summary>

			<label className="filter-label">
				<input 
					id="filter-presets" 
					type="search"
					placeholder="Filter presets..."
					value={presetsFilterText}
					onChange={(e) => setPresetFilterText(e.target.value)}
				/>
				{/* <button type="button">Filter</button> */}
			</label>

			<ul id="presets-list" role="list">
				{ 
					filteredPresets.map( (transformer) => ( <li key={transformer.name}><button type="button" onClick={onSetPreset(transformer.transformers)}>{transformer.name}</button></li>) ) 
				}
				{filteredPresets.length === 0 && (
					<li className="no-matches">
						<p className="error-message">No transformers match "{transformersFilterText}"</p>
					</li>
				)}
			</ul>
        </details>
    </aside>)
}