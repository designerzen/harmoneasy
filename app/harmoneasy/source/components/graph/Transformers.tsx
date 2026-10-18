import { TRANSFORMER_DEFINITIONS } from 'audiobus/io/transformer-definitions'
import { ClassificationFilter } from './ClassificationFilter'
import { choiceMatches, groupChoices } from './device-filters'
import { useChain } from './ChainContext'
import { elementDescription, elementIcon } from './element-icons'
import { ElementIcon } from './ElementIcon'
import React, { useState, useId } from "react"
import { 
    tranformerFactory,
    TRANSFORMERS
} from 'audiobus/io/transformer-factory'


export function TransformerPicker({ dialog = false, onAdded }: { dialog?: boolean; onAdded?: () => void }) {
    const { chain } = useChain()
    const filterId = useId()
    const [transformersFilterText, setTransformersFilterText] = useState("")
  
    const [classification, setClassification] = useState('')
    const choices = TRANSFORMERS.map(id => TRANSFORMER_DEFINITIONS[id])
    const filteredTransformers = choices.filter(choice => choiceMatches(choice, transformersFilterText, classification))

	const onAdd = (transformerType: string) => () => {

        chain.appendTransformer( tranformerFactory(transformerType) )
        onAdded?.()
    }

    return (<div className="transformer-picker">
			
			<label className={dialog ? 'dialog-filter' : 'filter-label filter-transformer'} htmlFor={filterId}>
                {!dialog && <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" />
                </svg>}
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

            <ClassificationFilter choices={choices} value={classification} onChange={setClassification} label="Filter transformers by type" />
            {groupChoices(filteredTransformers).map(group => <section className="choice-group" key={`${group.type}:${group.subtype}`} aria-label={group.label}>
                <h6 className="section-title">{group.label}</h6>
                <ul className={dialog ? 'items-grid' : undefined} role="list">
                    {group.items.map(choice => <li key={choice.id}>
                        <button className={dialog ? 'grid-item transformer-choice' : 'element-choice'} type="button" onClick={onAdd(choice.id)}
                            title={elementDescription('transformer', choice.id, choice.name, choice.description)}>
                            <ElementIcon src={elementIcon('transformer', choice.id)} title={elementDescription('transformer', choice.id, choice.name, choice.description)} />
                            <span>{choice.name}</span>
                        </button>
                    </li>)}
                </ul>
            </section>)}
            {filteredTransformers.length === 0 && <p role="status">No transformers match the selected filters</p>}
        </div>)
}
