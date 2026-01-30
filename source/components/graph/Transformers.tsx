import React, { useState } from "react"
import { 
    tranformerFactory,
    TRANSFORMER_TYPE,
    TRANSFORMERS
} from "../../libs/audiobus/io/transformer-factory"

import type { TransformerManager } from "../../libs/audiobus/io/transformer-manager"
import type IOChain from "../../libs/audiobus/io/IO-chain"

export function Transformers() {

    const [transformersFilterText, setTransformersFilterText] = useState("")
  
    const filteredTransformers = TRANSFORMERS.filter(transformerId =>
        transformerId.toLowerCase().includes(transformersFilterText.toLowerCase())
    )

	const onAdd = (transformerType: string) => () => {
		const chain = (window as any).chain as IOChain
        chain.appendTransformer( tranformerFactory(transformerType) )
    }

    return (<details open className="transformers">
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
        </details>)
}