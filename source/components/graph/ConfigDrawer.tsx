import React, { useState } from "react"
import type { TransformerManager } from "../../libs/audiobus/transformers/transformer-manager"
import { 
    tranformerFactory,
    TRANSFORMER_TYPE,
    TRANSFORMERS
} from "../../libs/audiobus/transformers/transformer-factory"

const PRESETS = [
	{
		name:"Chord Arpeggiator",
		transformers: [TRANSFORMER_TYPE.ID_QUANTISE, TRANSFORMER_TYPE.ID_CHORDIFIER, TRANSFORMER_TYPE.ID_ARPEGGIATOR]
	},
	{
		name:"Random Patch",
		transformers: [TRANSFORMER_TYPE.ID_RANDOMISER, TRANSFORMER_TYPE.ID_QUANTISE, TRANSFORMER_TYPE.ID_NOTE_SHORTENER]
	},
	{
		name:"Chord Repeater",
		transformers: [TRANSFORMER_TYPE.ID_QUANTISE, TRANSFORMER_TYPE.ID_CHORDIFIER, TRANSFORMER_TYPE.ID_NOTE_REPEATER]
	},
	{
		name:"Harmonic Randomiser",
		transformers: [TRANSFORMER_TYPE.ID_QUANTISE, TRANSFORMER_TYPE.ID_QUANTISE, TRANSFORMER_TYPE.ID_CHORDIFIER]
	},
	{
		name:"Staccato Arp",
		transformers: [TRANSFORMER_TYPE.ID_QUANTISE, TRANSFORMER_TYPE.ID_ARPEGGIATOR, TRANSFORMER_TYPE.ID_NOTE_SHORTENER]
	},
	{
		name:"Complex Pattern",
		transformers: [TRANSFORMER_TYPE.ID_RANDOMISER, TRANSFORMER_TYPE.ID_HARMONISER, TRANSFORMER_TYPE.ID_ARPEGGIATOR, TRANSFORMER_TYPE.ID_NOTE_REPEATER]
	}
]

export function ConfigDrawer() {

    const [transformersFilterText, setTransformersFilterText] = useState("")
    const [presetsFilterText, setPresetFilterText] = useState("")

    const onAdd = (s: string) => () => {
        const tM = (window as any).transformerManager as TransformerManager
        tM.appendTransformer( tranformerFactory(s) )
    }

    const onSetPreset = (transformers: string[]) => () => {
        const tM = (window as any).transformerManager as TransformerManager
        tM.setTransformers(transformers.map(tranformerFactory))
    }

    const filteredTransformers = TRANSFORMERS.filter(transformerId =>
        transformerId.toLowerCase().includes(transformersFilterText.toLowerCase())
    )
    const filteredPresets = PRESETS.filter(preset => {
		const filterTerm = presetsFilterText.toLowerCase()
		return preset.name.toLowerCase().includes(filterTerm) || preset.transformers.includes(filterTerm)
    })

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