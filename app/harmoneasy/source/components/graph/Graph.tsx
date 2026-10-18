import { GraphControls } from './GraphControls'
import ChainName from './ChainName'
import { ChainContext, useChain } from './ChainContext'
import type IOChainManager from 'audiobus/io/IO-chain-manager'
import '@xyflow/react/dist/style.css'

import React, { useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
	ReactFlow,
	ReactFlowProvider,
	applyNodeChanges,
	applyEdgeChanges,
	type NodeChange, type EdgeChange, type Edge, type Connection,
	useReactFlow,
	useNodesInitialized
} from '@xyflow/react'

import { AnimatedSVGEdge } from './AnimatedSVGEdge.tsx'
import { ChainSidebar } from './ChainSidebar.tsx'
import { Presets } from './Presets.tsx'
import { IOChainManagerUI } from './IOChainManagerUI.tsx'
import { StartNode } from './nodes/StartNode.tsx'
import { EndNode } from './nodes/EndNode.tsx'
import { InputNode } from './nodes/InputNode.tsx'
import { OutputNode } from './nodes/OutputNode.tsx'
import { TransformerNode } from './nodes/TransformerNode.tsx'
import { AddTransformerNode } from './nodes/AddTransformerNode.tsx'

import { DEFAULT_GRAPH_OPTIONS, DEFAULT_VIEWPORT_OPTIONS, DEFAULT_LAYOUT_MODE } from './options.ts'

import { EVENT_TRANSFORMERS_UPDATED } from 'audiobus/io/transformer-manager.ts'
import { EVENT_INPUTS_UPDATED } from 'audiobus/io/input-manager.ts'
import { EVENT_OUTPUTS_UPDATED } from 'audiobus/io/output-manager.ts'

import { getStructure, layoutMeasuredNodes, initialEdges, initialNodes, type GraphNode } from './layout.ts'


const nodeTypes = {
	start: StartNode,
	end: EndNode,
	input:InputNode,
	output:OutputNode,
	transformer: TransformerNode,
    addTransformer: AddTransformerNode
}

const edgeTypes = {
  	animatedSvg: AnimatedSVGEdge
}

function FlowComponent() {
    const { chain, chainId } = useChain()
	const [ nodes, setNodes] = useState(initialNodes)
	const [ edges, setEdges] = useState(initialEdges)
	const [ layoutMode, setLayoutMode ] = useState(chain.options.graphLayout ?? DEFAULT_LAYOUT_MODE)
	const { fitView, getViewport, setViewport } = useReactFlow()
	const savedViewport = useRef<ReturnType<typeof getViewport> | null>(null)
	const fittedLayout = useRef<string | null>(null)
	const nodesInitialized = useNodesInitialized()
	const [fullscreenNodeId, setFullscreenNodeId] = useState<string | null>(null)

	useEffect(() => {
		const abortController = new AbortController()

		// an event has bubbled from the Chain
		const onTransformersChanged = () => {
			// const detail = event ? event.detail : null
			const structure = getStructure(chain, true, true, layoutMode, chainId)
            setNodes(previous => {
                const measured = new Map(previous.map(node => [node.id, node.measured]))
                return layoutMeasuredNodes(structure.nodes.map(node => ({ ...node, measured: measured.get(node.id) })), layoutMode)
            })
			setEdges(structure.edges)
		}

        chain.addEventListener('configurationChanged', () => {
            setLayoutMode(chain.options.graphLayout ?? DEFAULT_LAYOUT_MODE)
            onTransformersChanged()
        }, { signal: abortController.signal })

		// watch for additions / removals of Transformers
		chain.transformerManager.addEventListener( EVENT_TRANSFORMERS_UPDATED, onTransformersChanged, {signal:abortController.signal} )
		chain.inputManager.addEventListener( EVENT_INPUTS_UPDATED, onTransformersChanged, {signal:abortController.signal} )
		chain.outputManager.addEventListener( EVENT_OUTPUTS_UPDATED, onTransformersChanged, {signal:abortController.signal} )

		onTransformersChanged()

		// Cleanup: unsubscribe when component unmounts
		const unsubscribe = () => {
			abortController.abort()
		}
		return unsubscribe
	}, [setNodes, setEdges, layoutMode, chainId, chain])

    const measuredSizes = nodes.map(node => `${node.id}:${node.measured?.width}:${node.measured?.height}`).join('|')
    useEffect(() => {
        if (!nodesInitialized || fullscreenNodeId) return
        if (savedViewport.current) {
            void setViewport(savedViewport.current)
            savedViewport.current = null
            return
        }
        // Preserve the user's pan and zoom during structure and size updates.
        if (fittedLayout.current === layoutMode) return
        const frame = requestAnimationFrame(() => {
            fittedLayout.current = layoutMode
            void fitView({ padding: 0.15, duration: 150, ...DEFAULT_GRAPH_OPTIONS })
        })
        return () => cancelAnimationFrame(frame)
    }, [nodesInitialized, layoutMode, fitView, setViewport, measuredSizes, fullscreenNodeId])

    const onNodesChange = useCallback((changes: NodeChange<GraphNode>[]) => {
        setNodes(snapshot => {
            const next = applyNodeChanges(changes.filter(change => change.type !== 'remove'), snapshot)
            const resized = changes.some(change => change.type === 'dimensions')
            return resized && !fullscreenNodeId ? layoutMeasuredNodes(next, layoutMode) : next
        })
    }, [layoutMode, fullscreenNodeId])
    const onEdgesChange = useCallback((changes: EdgeChange[]) => {
        setEdges(snapshot => applyEdgeChanges(changes.filter(change => change.type !== 'remove'), snapshot))
    }, [])
    const detachEdges = (edges: Edge[]) => {
        for (const edge of edges) {
            const source = nodes.find(node => node.id === edge.source)
            const target = nodes.find(node => node.id === edge.target)
            if (source?.data.input) chain.removeInput(source.data.input)
            if (target?.data.output) chain.removeOutput(target.data.output)
        }
    }
    const removeNodes = (removed: GraphNode[]) => {
        for (const node of removed) {
            if (node.data.input) chain.removeInput(node.data.input)
            if (node.data.output) chain.removeOutput(node.data.output)
            if (node.data.element) chain.removeTransformer(node.data.element)
        }
    }
    const validConnection = (connection: Connection | Edge) => {
        const source = nodes.find(node => node.id === connection.source)
        const target = nodes.find(node => node.id === connection.target)
        return Boolean((source?.type === 'input' && target?.type === 'start') ||
            (source?.type === 'end' && target?.type === 'output'))
    }
    const onConnect = (connection: Connection) => {
        if (!validConnection(connection)) return
        const source = nodes.find(node => node.id === connection.source)
        const target = nodes.find(node => node.id === connection.target)
        if (source?.data.input) chain.addInput(source.data.input)
        if (target?.data.output) chain.addOutput(target.data.output)
    }

	const handleFullscreenMode = (nodeId: string) => {
		if (!fullscreenNodeId) savedViewport.current = getViewport()
		setFullscreenNodeId(current => current === nodeId ? null : nodeId)
	}

	useEffect(() => {
		if (fullscreenNodeId && !nodes.some(node => node.id === fullscreenNodeId)) {
			setFullscreenNodeId(null)
		}
	}, [nodes, fullscreenNodeId])

	const exitFullscreenMode = () => {
		setFullscreenNodeId(null)
	}

	// Pass fullscreen handlers to node data
	const nodesWithFullscreen: GraphNode[] = nodes.map(node => ({
		...node,
		data: {
			...node.data,
			onFullscreen: handleFullscreenMode,
			isFullscreen: false,
			layoutMode
		}
	}))

	const isFullscreenActive = fullscreenNodeId !== null
	const selectedNode = nodesWithFullscreen.find(n => n.id === fullscreenNodeId)
	const ExpandedNode = selectedNode?.type === 'transformer' ? TransformerNode
        : selectedNode?.type === 'input' ? InputNode
        : selectedNode?.type === 'output' ? OutputNode : null

	return (
		<>
			<ChainSidebar />

			<ReactFlow
				className={ExpandedNode ? 'node-expanded' : undefined}
				panOnScroll={false}
				panOnDrag={!isFullscreenActive}
				selectionOnDrag={!isFullscreenActive}
				nodesFocusable={true}
				edgesFocusable={true}
				disableKeyboardA11y={false}
				nodes={nodesWithFullscreen}
				edges={edges}
				edgeTypes={edgeTypes}
				nodeTypes={nodeTypes}
				minZoom={DEFAULT_GRAPH_OPTIONS.minZoom}
				maxZoom={DEFAULT_GRAPH_OPTIONS.maxZoom}
				defaultViewport={DEFAULT_VIEWPORT_OPTIONS}
				onNodesChange={onNodesChange}
				onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                isValidConnection={validConnection}
                onNodesDelete={removeNodes}
                onEdgesDelete={detachEdges}
                onNodeDragStop={(_, node) => chain.setGraphOptions({ positions: {
                    ...chain.options.positions, [node.data.positionKey as string]: node.position
                } })}
			>
				<GraphControls layoutMode={layoutMode} />
				{selectedNode && ExpandedNode && createPortal(<div className="node-viewport-editor nodrag nopan nowheel"
					role="dialog" aria-label={`${selectedNode.data.label || selectedNode.data.input?.name || selectedNode.data.output?.name} settings`}
					onKeyDown={event => {
						if (event.key === 'Escape') {
							event.stopPropagation()
							exitFullscreenMode()
						}
					}}>
					<ExpandedNode key={selectedNode.id} id={selectedNode.id} data={{ ...selectedNode.data, isFullscreen: true }} />
				</div>, document.body)}
			</ReactFlow>
		</>
	)
}

export default function App({ manager }: { manager: IOChainManager }) {
    const [, refresh] = useState(0)
    const [soloId, setSoloId] = useState<string | null>(null)
    const solo = soloId && manager.getChain(soloId) ? soloId : null
    const layoutSettings = document.getElementById('graph-layout-settings')
    const chainNavigation = document.getElementById('chain-navigation')
    useEffect(() => {
        const transport = document.getElementById('midi-transport-control')
        if (!transport) return
        const updateOffset = () => document.documentElement.style.setProperty(
            '--transport-height', `${transport.getBoundingClientRect().height}px`)
        updateOffset()
        const observer = new ResizeObserver(updateOffset)
        observer.observe(transport)
        return () => {
            observer.disconnect()
            document.documentElement.style.removeProperty('--transport-height')
        }
    }, [])
    useEffect(() => {
        if (!solo) return
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !document.querySelector('dialog[open]')) {
                setSoloId(null)
            }
        }
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.body.style.overflow = previousOverflow
            document.removeEventListener('keydown', onKeyDown)
        }
    }, [solo])
    useEffect(() => {
        const update = () => refresh(value => value + 1)
        manager.addEventListener('chainsUpdated', update)
        manager.addEventListener('chainActiveChanged', update)
        return () => {
            manager.removeEventListener('chainsUpdated', update)
            manager.removeEventListener('chainActiveChanged', update)
        }
    }, [manager])
    return <div className="chains-workspace">
        {chainNavigation && createPortal(<>
            {manager.entries.map(([chainId, chain], index) => <a key={chainId}
                href={`#${encodeURIComponent(`iochain-${chainId}`)}`}>
                {chain.options.name ?? `Chain ${index + 1}`}
            </a>)}
            <button className="btn-add" type="button" onClick={() => {
                const section = document.getElementById('add-iochain')
                section?.scrollIntoView({ block: 'start', behavior: 'auto' })
                section?.querySelector('select')?.focus({ preventScroll: true })
            }}>Add</button>
        </>, chainNavigation)}
        {layoutSettings && createPortal(<>
            {manager.entries.map(([chainId, chain], index) => <label key={chainId} data-midi-scope={`${chainId}:layout`}>
                {chain.options.name ?? `Chain ${index + 1}`}
                <select value={chain.options.graphLayout ?? DEFAULT_LAYOUT_MODE}
                    onChange={event => chain.setGraphOptions({
                        graphLayout: event.target.value as 'horizontal' | 'vertical', positions: {}
                    })}>
                    <option value="vertical">Vertical</option>
                    <option value="horizontal">Horizontal</option>
                </select>
            </label>)}
            {manager.chainCount === 0 && <p>Add a chain to choose its layout.</p>}
        </>, layoutSettings)}
       
        {manager.restoreWarnings.map(warning => <p role="status" key={warning}>{warning}</p>)}
        {manager.entries.map(([chainId, chain], index) => <section key={chainId}
            id={`iochain-${chainId}`} data-midi-scope={chainId} tabIndex={-1}
            className={`chain-panel ${chain.isActive ? 'active' : 'inactive'} ${solo === chainId ? 'chain-solo' : ''}`}
            hidden={!!solo && solo !== chainId}
            aria-label={chain.options.name ?? `Chain ${index + 1}`}>
            <header className="chain-toolbar">
                <div className="chain-identity">
                    <button className="chain-power chain-icon-button" title={chain.isActive ? 'Turn chain off' : 'Turn chain on — settings are still editable while off'} aria-label={chain.isActive ? 'Turn chain off' : 'Turn chain on'} type="button" aria-pressed={chain.isActive} onClick={() => chain.setActive(!chain.isActive)}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v10M6 5a9 9 0 1 0 12 0" /></svg>
                        <span>{chain.isActive ? 'On' : 'Off'}</span>
                    </button>
                    <ChainName chain={chain} />
                </div>
                <ChainContext.Provider value={{ chain, chainId, manager }}><Presets /></ChainContext.Provider>
                <div className="chain-actions">
                    <select aria-label="Actions" value="" onChange={event => {
                        switch (event.target.value) {
                            case 'horizontal':
                            case 'vertical':
                                chain.setGraphOptions({ graphLayout: event.target.value, positions: {} })
                                break
                            case 'clone':
                                void manager.cloneChain(chainId)
                                break
                            case 'delete':
                                manager.removeChain(chainId)
                                break
                            case 'solo':
                                setSoloId(current => current === chainId ? null : chainId)
                                break
                        }
                    }}>
                        <option value="" disabled>Actions</option>
                        <option value="clone">Clone chain</option>
                        <option value="solo">{solo === chainId ? 'Exit Solo' : 'Solo'}</option>
                        <optgroup label="Graph layout">
                            <option value="horizontal" disabled={(chain.options.graphLayout ?? DEFAULT_LAYOUT_MODE) === 'horizontal'}>Horizontal layout</option>
                            <option value="vertical" disabled={(chain.options.graphLayout ?? DEFAULT_LAYOUT_MODE) === 'vertical'}>Vertical layout</option>
                        </optgroup>
                        <option value="delete">Delete chain</option>
                    </select>
                </div>
            </header>
            <div className="chain-graph">
                <ChainContext.Provider value={{ chain, chainId, manager }}>
                    <ReactFlowProvider><FlowComponent /></ReactFlowProvider>
                </ChainContext.Provider>
            </div>
		</section>)}
        
		{manager.chainCount === 0 && <p>No IOChains. Add a chain to start routing inputs to outputs.</p>}
         <IOChainManagerUI manager={manager} />
    </div>
}
