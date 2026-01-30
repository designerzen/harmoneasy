import '@xyflow/react/dist/style.css'

import React, { useState, useCallback, useEffect } from 'react'
import { 
	ReactFlow, 
	ReactFlowProvider,
	Controls, 
	applyNodeChanges, 
	applyEdgeChanges, 
	addEdge, 
	useReactFlow
} from '@xyflow/react'

import { AnimatedSVGEdge } from './AnimatedSVGEdge.tsx'
import { Transformers } from './Transformers.tsx'
import { Presets } from './Presets.tsx'
import { StartNode } from './nodes/StartNode.tsx'
import { EndNode } from './nodes/EndNode.tsx'
import { InputNode } from './nodes/InputNode.tsx'
import { OutputNode } from './nodes/OutputNode.tsx'
import { TransformerNode } from './nodes/TransformerNode.tsx'

import { DEFAULT_GRAPH_OPTIONS, DEFAULT_VIEWPORT_OPTIONS } from './options.ts'

import { EVENT_TRANSFORMERS_UPDATED } from '../../libs/audiobus/io/transformer-manager.ts'
import { EVENT_INPUTS_UPDATED } from '../../libs/audiobus/io/input-manager.ts'
import { EVENT_OUTPUTS_UPDATED } from '../../libs/audiobus/io/output-manager.ts'

import { getStructure, initialEdges, initialNodes } from './layout.ts'

import type IOChain from '../../libs/audiobus/io/IO-chain.ts'

const nodeTypes = {
	start: StartNode,
	end: EndNode,
	input:InputNode,
	output:OutputNode,
	transformer: TransformerNode
}

const edgeTypes = {
  	animatedSvg: AnimatedSVGEdge
}

function FlowComponent() {
	const [ nodes, setNodes] = useState(initialNodes)
	const [ edges, setEdges] = useState(initialEdges)
	const { fitView } = useReactFlow()

	useEffect(() => {
		const chain = (window as any).chain as IOChain
		const abortController = new AbortController()

		// an event has bubbled from the Chain
		const onTransformersChanged = (event:CustomEvent|null) => {
			// const detail = event ? event.detail : null
			const structure = getStructure( chain, true, true  )
			setNodes(structure.nodes)
			setEdges(structure.edges)
		}
		
		// watch for additions / removals of Transformers
		chain.transformerManager.addEventListener( EVENT_TRANSFORMERS_UPDATED, onTransformersChanged, {signal:abortController.signal} )
		chain.inputManager.addEventListener( EVENT_INPUTS_UPDATED, onTransformersChanged, {signal:abortController.signal} )
		chain.outputManager.addEventListener( EVENT_OUTPUTS_UPDATED, onTransformersChanged, {signal:abortController.signal} )

		onTransformersChanged( null )
		
		// Cleanup: unsubscribe when component unmounts
		const unsubscribe = () => { 
			abortController.abort()
		}
		return unsubscribe
	}, [setNodes, setEdges])

	// Auto-fit view whenever nodes change
	useEffect(() => {
		if (nodes.length > 0) {
			// Use setTimeout to ensure nodes are rendered before fitting
			setTimeout(() => {
				fitView({
					padding: 0.2,
					minZoom: DEFAULT_GRAPH_OPTIONS.minZoom,
					maxZoom: DEFAULT_GRAPH_OPTIONS.maxZoom,
					duration: 100
				})
			}, 0)
		}
	}, [nodes, fitView])

	const onNodesChange = useCallback(
		(changes) => setNodes((nodesSnapshot) => applyNodeChanges(changes, nodesSnapshot)), []
	)

	const onEdgesChange = useCallback(
		(changes) => setEdges((edgesSnapshot) => applyEdgeChanges(changes, edgesSnapshot)), []
	)

	const onConnect = useCallback(
		(params) => setEdges((edgesSnapshot) => addEdge(params, edgesSnapshot)), []
	)

	return (
		<>
			<aside className="transformers-drawer">
				<Transformers />
				<Presets />
			</aside>
			<ReactFlow
				panOnScroll={false}
				panOnDrag={true}
				selectionOnDrag={true}
				nodesFocusable={true}
				edgesFocusable={true}
				disableKeyboardA11y={false}
				nodes={nodes}
				edges={edges}
				edgeTypes={edgeTypes}
				nodeTypes={nodeTypes}
				minZoom={DEFAULT_GRAPH_OPTIONS.minZoom}
				maxZoom={DEFAULT_GRAPH_OPTIONS.maxZoom}
				defaultViewport={DEFAULT_VIEWPORT_OPTIONS}
				onNodesChange={onNodesChange}
				onEdgesChange={onEdgesChange}
				onConnect={onConnect}
			>
				{/* <Controls /> */}
			</ReactFlow>
		</>
	)
}

export default function App() {
	return (
		<ReactFlowProvider>
			<FlowComponent />
		</ReactFlowProvider>
	)
}