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
import { ConfigDrawer } from './ConfigDrawer.tsx'
import { StartNode } from './nodes/StartNode.tsx'
import { EndNode } from './nodes/EndNode.tsx'
import { InputNode } from './nodes/InputNode.tsx'
import { OutputNode } from './nodes/OutputNode.tsx'
import { TransformerNode } from './nodes/TransformerNode.tsx'
import { DEFAULT_GRAPH_OPTIONS, DEFAULT_VIEWPORT_OPTIONS, HORIZONTAL_SPACING, NODE_HEIGHT } from './options.ts'

import type IOChain from '../../libs/audiobus/IO-chain.ts'
import type TransformerManager from '../../libs/audiobus/transformers/transformer-manager.ts'
import type TransformerManagerWorker from '../../libs/audiobus/transformers/transformer-manager-worker.ts'
import type { IAudioOutput } from '../../libs/audiobus/outputs/output-interface.ts'
import { EVENT_TRANSFORMERS_UPDATED } from '../../libs/audiobus/transformers/transformer-manager.ts'

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

// These get overwritten immediately - bit pointless really
const initialNodes = [
	{ id: 'node-start', position: { x: 0, y: 200 }, data: { label: 'Start' } },
	{ id: 'node-end', position: { x: 500, y: 200 }, data: { label: 'End' } }
]

const initialEdges = [
	{ id: 'edge-start-end', source: initialNodes[0].id, target: initialNodes[1].id }
]

// node:transformer-Transformer-Harmoniser-2
function getNodeID( uuid:string, nodeType:string="node:transformer" ){
	return nodeType + '[' + uuid + ']'
}

/**
 * GUI stuff - create the nodes in our graph from our IOChain
 * @param transformers 
 * @returns 
 */
function getStructure( chain:IOChain, showInputs:boolean=true, showOutputs:boolean=true ){

	const transformManager:TransformerManager|TransformerManagerWorker = chain.transformerManager
	const transformers = transformManager.activeTransformers

	const firstTransformer = transformers[0]
	const lastTransformer = transformers[transformers.length - 1]
	const hasTransformers = transformers.length > 0

	const inputs = chain.inputs
	const outputs = chain.outputs
	
	const inputNodes = showInputs ? inputs.map((input:AbstractInput, index:number) => ({
		id: 'node-input-'+index,
		type: 'input',
		data: { 
			label: 'INPUT' + input.name 
		},
		position: { x: -330 , y: index * NODE_HEIGHT / 2 }
	})) : []

	// From Inputs to Start
	const nodeStart = {
		id: 'node-start',
		type: 'start',
		data: { 
			label: 'START' 
		},
		position: { x: -140, y: NODE_HEIGHT / 2  }
	}

	// Chain through the Transformers
	const nodesTransformers = transformers.map((transformer:Transformer, index) => ({
		id: getNodeID(transformer.uuid),
		type: 'transformer',
		data: { 
			label: transformer.name, 
			fields: transformer.fields, 
			element: transformer, 
			description: transformer.description 
		},
		position: { x: HORIZONTAL_SPACING * index, y: 0 }
	}))

	// End Graph nodes
	const nodeEnd =  {
		id: 'node-end',
		type: 'end',
		data: { 
			label: 'END' 
		},
		position: { x: HORIZONTAL_SPACING * (transformers.length) , y: NODE_HEIGHT / 2 }
	}

	// Add in all our output nodes
	const outputNodes = showOutputs ? outputs.map((input:AbstractInput, index:number) => ({
		id: 'node-output-'+index,
		type: 'output',
		data: { 
			label: 'OUTPUT' + input.name 
		},
		position: { x: HORIZONTAL_SPACING * (transformers.length ) + 80 + 44 , y: index * NODE_HEIGHT / 2 }
	})) : []

	
	const nodes = [
		...inputNodes,
		nodeStart, 
		...nodesTransformers, 
		nodeEnd,
		...outputNodes
	]


	// EDGES -----------------------------------------

	const barDuration = '0.8s'

	const inputEdges = inputNodes.map((inputNode, index:number) => ({
		id: 'edge-input-'+index,
		source: inputNode.id,
		target: nodeStart.id,
		type: 'animatedSvg', 
		data: { duration: barDuration }
	}))

	const edgeStart ={
		id: 'edge-start',
		source: nodeStart.id,
		target: getNodeID( firstTransformer.uuid ),
		type: 'animatedSvg',
		data: { duration: barDuration }
	}

	// Now create the edges that link these nodes
	const edgesTransformers = transformers.map((transformer:Transformer, index:number) => {
		const nextTransformer:Transformer|null = transformers[index + 1]
		return {
			id: getNodeID( transformer.uuid, "edge" ),
			source: getNodeID( transformer.uuid ),
			target: nextTransformer ? 
				getNodeID(nextTransformer.uuid) : 
				nodeEnd.id,
			type: 'animatedSvg', 
			data: { duration: barDuration }
		}
	})
		
	// Remove the last edge since it's handled by alwaysEdges
	if (hasTransformers) {
		edgesTransformers.pop()
	}

	const edgeEnd = {
		id: 'edge-end',
		source: getNodeID(lastTransformer.uuid),
		target: nodeEnd.id,
		type: 'animatedSvg',
		data: { duration: barDuration }
	}

	const outputEdges = outputNodes.map((outputNode, index:number) => ({
		id: 'edge-output-'+index,
		source: nodeEnd.id,
		target: outputNode.id,
		type: 'animatedSvg',
		data: { duration: barDuration }
	}))

	const edgePassthrough = {
		id: 'edge-passthrough',
		source: nodeStart.id,
		target: nodeEnd.id,
		type: 'animatedSvg'
	}

	// If there are no transformers, we just connect
	// Start to End
	const edges = !hasTransformers
		? [ edgePassthrough ] 
		: [
			...inputEdges,
			edgeStart, 
			...edgesTransformers,
			edgeEnd, 
			...outputEdges
		]

	const output = { 
		nodes, 
		edges
	}
	
	return output
}

function FlowComponent() {
	const [ nodes, setNodes] = useState(initialNodes)
	const [ edges, setEdges] = useState(initialEdges)
	const { fitView } = useReactFlow()

	useEffect(() => {
		const chain = (window as any).chain as IOChain
		const abortController = new AbortController()

		// an event has bubbled from the Chain
		const onTransformersChanged = (event:CustomEvent) => {
			const detail = event ? event.detail : null
			const structure = getStructure( chain )
			setNodes(structure.nodes)
			setEdges(structure.edges)
			console.info("Graph::Transformers Updated", detail )
		}
		
		// TODO: watch inputs / outputs 
		// watch for additions / removals of Transformers
		chain.addEventListener( EVENT_TRANSFORMERS_UPDATED, onTransformersChanged, {signal:abortController.signal} )
		
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
			<ConfigDrawer />
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
				<Controls />
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