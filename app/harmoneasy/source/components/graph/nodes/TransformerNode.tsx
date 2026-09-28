import { useChain } from '../ChainContext'
import { Handle, Position } from "@xyflow/react"
import React, { useCallback } from "react"
import { ConfigField } from "../Widgets.tsx"
import { getTransformerIcon } from 'audiobus/io/transformer-definitions'

/**
 * TransformerNode component
 * Uses useCallback for event handlers to maintain referential equality
 * @param props - The props for the TransformerNode component
 */
export function TransformerNode(props: any) {

	const { chain } = useChain()
	const icon = getTransformerIcon(props.data.element.id)
			
	const removeNode = useCallback(() => {
        chain.transformerManager.removeTransformer(props.data.element)
    }, [props.data.element])

    const moveBack = useCallback(() => {
        chain.transformerManager.moveOneStepBefore(props.data.element)
    }, [props.data.element])

    const moveForwards = useCallback(() => {
        chain.transformerManager.moveOneStepAfter(props.data.element)
    }, [props.data.element])

    const shouldShowMoveButtons = chain.transformerQuantity > 1

	const isVertical = props.data.layoutMode === 'vertical'
	const isFullscreen = props.data.isFullscreen || false
	const onFullscreen = props.data.onFullscreen

	const handleFullscreen = useCallback(() => {
		if (onFullscreen) {
			onFullscreen(props.id)
		}
	}, [props.id, onFullscreen])

    return <div className={`node-transformer graph-node can-remove category-${props.data.element.category.toLowerCase()} ${isFullscreen ? 'is-fullscreen' : ''}`}>
        {isFullscreen ? <header className="expanded-node-heading">
            <div className="expanded-node-emblem"><img src={icon} alt="" /></div>
            <div>
                <span className="expanded-node-category">{props.data.element.category} / Transformer</span>
                <h2>{props.data.label}</h2>
                <p>{props.data.description}</p>
            </div>
        </header> : <>
        <img src={icon} alt={props.data.label} className="transformer-icon" title={props.data.label}/>
        <h6>{props.data.label}</h6>
      
	  	<details>
			<summary className="summary-info" title={props.data.description}>Info</summary>
			<p>{props.data.description}</p>
		</details>

        </>}

        <menu className="node-actions">
            <button type="button" className="btn-remove nodrag nopan" title="Delete transformer" aria-label="Delete transformer" onClick={removeNode}>Remove</button>
            <button type="button" className="btn-fullscreen nodrag nopan" onClick={handleFullscreen}
                autoFocus={isFullscreen} aria-expanded={isFullscreen}
                title={isFullscreen ? 'Minimise transformer' : 'Expand transformer'}
                aria-label={isFullscreen ? 'Minimise transformer' : 'Expand transformer'}>
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d={isFullscreen ? 'M3 9h6V3m6 0v6h6M3 15h6v6m6 0v-6h6' : 'M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6'} />
                </svg>
            </button>
        </menu>
      
        {isFullscreen ? <div className="expanded-node-settings">
            {props.data.fields.map((f: any, i: number) => <ConfigField
                key={`${f.uuid}-${i}-${props.data.element.config[f.name] ?? f.default}`}
                config={{ ...f, default: props.data.element.config[f.name] ?? f.default }} element={props.data.element} />)}
        </div> : <>
        {props.data.fields.map( (f: any, i: number) => (
            <ConfigField key={`${f.uuid}-${i}-${props.data.element.config[f.name] ?? f.default}`} config={{ ...f, default: props.data.element.config[f.name] ?? f.default }} element={props.data.element} />
        ))}
        </>}

		{ shouldShowMoveButtons ? 
			(<menu className="graph-node-menu">
				<button type="button" className="btn-previous nodrag nopan" onClick={moveBack}
                    title={isVertical ? 'Move transformer up' : 'Move transformer left'}>
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d={isVertical ? 'M12 20V4m-6 6 6-6 6 6' : 'M20 12H4m6-6-6 6 6 6'} />
                    </svg>
                    {isVertical ? 'Move up' : 'Move left'}
                </button>
                <button type="button" className="btn-next nodrag nopan" onClick={moveForwards}
                    title={isVertical ? 'Move transformer down' : 'Move transformer right'}>
                    {isVertical ? 'Move down' : 'Move right'}
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d={isVertical ? 'M12 4v16m-6-6 6 6 6-6' : 'M4 12h16m-6-6 6 6-6 6'} />
                    </svg>
                </button>
			</menu>) : null 
		}

        {!isFullscreen && <Handle type="source" position={isVertical ? Position.Bottom : Position.Right} />}
        {!isFullscreen && <Handle type="target" position={isVertical ? Position.Top : Position.Left} />}
    </div>
}


