import { useChain } from './ChainContext'
import React, { useState, useId } from "react"
import { 
    tranformerFactory,
    TRANSFORMERS
} from 'audiobus/io/transformer-factory'


export function Transformers() {
    const { chain } = useChain()
    const filterId = useId()
    const [transformersFilterText, setTransformersFilterText] = useState("")
  
    const filteredTransformers = TRANSFORMERS.filter(transformerId =>
        transformerId.toLowerCase().includes(transformersFilterText.toLowerCase())
    )

	const onAdd = (transformerType: string) => () => {

        chain.appendTransformer( tranformerFactory(transformerType) )
    }

    return (<details className="transformers transformers-drawer">
            <summary title="Open or close Add Transformer menu"><span>Add Transformer</span></summary>
            <div className="transformer-picker">
			
			<label className="filter-label filter-transformer" htmlFor={filterId}>
				<input 
					id={filterId}
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
						<p className="error-message">No transformers match "{transformersFilterText}"</p>
					</li>
				)}
			</ul>
            </div>
        </details>)
}



