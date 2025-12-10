import React, { useState } from "react"
import type { TransformerManager } from "../../libs/audiobus/transformers/transformer-manager"
import { 
    tranformerFactory,
    TRANSFORMER_TYPE,
    TRANSFORMERS
} from "../../libs/audiobus/transformers/transformer-factory"

export function ConfigDrawer() {

    const [filterText, setFilterText] = useState("")

    const onAdd = (s: string) => () => {
        const tM = (window as any).transformerManager as TransformerManager
        tM.appendTransformer( tranformerFactory(s) )
    }

    const onSetPreset = (transformers: string[]) => () => {
        const tM = (window as any).transformerManager as TransformerManager
        tM.setTransformers(transformers.map(tranformerFactory))
    }

    const filteredTransformers = TRANSFORMERS.filter(transformer =>
        transformer.toLowerCase().includes(filterText.toLowerCase())
    )

    return (<aside className="transformers-drawer">
        
        <details open className="transformers">
            <summary>{filterText.length > 2 && filteredTransformers.length > 0  ? filterText : 'Transformers'}</summary>
			<label className="filter-label">
				<input 
					id="filter-transformers" 
					type="search"
					placeholder="Filter transformers..."
					value={filterText}
					onChange={(e) => setFilterText(e.target.value)}
				/>
				<button type="button">Filter</button>
			</label>
			<ul id="transformers-list">
            { 
                filteredTransformers.map( (transformer) => ( <li key={transformer}><button type="button" onClick={onAdd(transformer)}>{transformer}</button></li>) ) 
            }
			</ul>
            {filteredTransformers.length === 0 && (
                <li className="no-matches">
                    No transformers match "{filterText}"
                </li>
            )}
        </details>

        <details open className="presets">

            <summary>Presets</summary>

			<label className="filter-label">
				<input id="filter-presets" type="search"></input>
				<button type="button">Filter</button>
			</label>

			<ul id="presets-list">

            <button type="button" onClick={onSetPreset([TRANSFORMER_TYPE.ID_QUANTISE, TRANSFORMER_TYPE.ID_CHORDIFIER, TRANSFORMER_TYPE.ID_ARPEGGIATOR])}>
                Chord Arpeggiator
            </button>

            <button type="button" onClick={onSetPreset([TRANSFORMER_TYPE.ID_RANDOMISER, TRANSFORMER_TYPE.ID_QUANTISE, TRANSFORMER_TYPE.ID_NOTE_SHORTENER])}>
                Random Patch
            </button>

            <button type="button" onClick={onSetPreset([TRANSFORMER_TYPE.ID_QUANTISE, TRANSFORMER_TYPE.ID_CHORDIFIER, TRANSFORMER_TYPE.ID_NOTE_REPEATER])}>
                Chord Repeater
            </button>

            <button type="button" onClick={onSetPreset([TRANSFORMER_TYPE.ID_QUANTISE, TRANSFORMER_TYPE.ID_RANDOMISER, TRANSFORMER_TYPE.ID_CHORDIFIER])}>
                Harmonic Randomiser
            </button>

            <button type="button" onClick={onSetPreset([TRANSFORMER_TYPE.ID_QUANTISE, TRANSFORMER_TYPE.ID_ARPEGGIATOR, TRANSFORMER_TYPE.ID_NOTE_SHORTENER])}>
                Staccato Arp
            </button>

            <button type="button" onClick={onSetPreset([TRANSFORMER_TYPE.ID_RANDOMISER, TRANSFORMER_TYPE.ID_HARMONISER, TRANSFORMER_TYPE.ID_ARPEGGIATOR, TRANSFORMER_TYPE.ID_NOTE_REPEATER])}>
                Complex Pattern
            </button>
			</ul>
        </details>
    </aside>)
}