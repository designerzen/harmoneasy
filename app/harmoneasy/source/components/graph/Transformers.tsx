import { useChain } from './ChainContext'
import React, { useState, useId } from "react"
import { 
    tranformerFactory,
    TRANSFORMERS
} from 'audiobus/io/transformer-factory'


export function TransformerPicker({ dialog = false, onAdded }: { dialog?: boolean; onAdded?: () => void }) {
    const { chain } = useChain()
    const filterId = useId()
    const [transformersFilterText, setTransformersFilterText] = useState("")
  
    const filteredTransformers = TRANSFORMERS.filter(transformerId =>
        transformerId.toLowerCase().includes(transformersFilterText.toLowerCase())
    )

	const onAdd = (transformerType: string) => () => {

        chain.appendTransformer( tranformerFactory(transformerType) )
        onAdded?.()
    }

    return (<div className="transformer-picker">
			
			<label className={dialog ? 'dialog-filter' : 'filter-label filter-transformer'} htmlFor={filterId}>
				<input 
					id={filterId}
					type="search"
                    className={dialog ? 'filter-input-global' : undefined}
                    aria-label="Search transformers"
                    autoFocus={dialog}
					placeholder="Filter transformers..."
					value={transformersFilterText}
					onChange={(e) => setTransformersFilterText(e.target.value)}
				/>
				{/* <button type="button">Filter</button> */}
			</label>

			<ul className={dialog ? 'items-grid' : undefined} role="list">
				{ 
					filteredTransformers.map( (preset) => ( <li key={preset}><button className={dialog ? 'grid-item' : undefined} type="button" onClick={onAdd(preset)}>{preset}</button></li>) )
				}
				{filteredTransformers.length === 0 && (
					<li className="no-matches">
						<p className="error-message">No transformers match "{transformersFilterText}"</p>
					</li>
				)}
			</ul>
            </div>)
}
