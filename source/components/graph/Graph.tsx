import '@xyflow/react/dist/style.css'
import React, { useState, useCallback, useEffect } from 'react'
import { ReactFlow, applyNodeChanges, applyEdgeChanges, addEdge, useReactFlow, ReactFlowProvider } from '@xyflow/react'
import { ConfigDrawer } from './ConfigDrawer'
import { StartNode } from './nodes/StartNode'
import { EndNode } from './nodes/EndNode'
import { TransformerNode } from './nodes/TransformerNode'

import type { TransformerManager } from '../../libs/audiobus/transformers/transformer-manager'

const initialNodes = [
	{ id: 'n1', position: { x: 0, y: 200 }, data: { label: 'Start' } },
	{ id: 'n2', position: { x: 500, y: 200 }, data: { label: 'End' } },
];
const initialEdges = [{ id: 'n1-n2', source: 'n1', target: 'n2' }]

const nodeTypes = {
	start: StartNode,
	end: EndNode,
	transformer: TransformerNode
}

const DEFAULT_GRAPH_OPTIONS = {
	minZoom: 0.3,
	maxZoom: 1.5
}

// Calculate positions with better spacing and centering
const HORIZONTAL_SPACING = 342
const NODE_HEIGHT = 323

// GUI stuff
function getStructure( transformers: Array<Transformer> ) {

	const nodes = transformers.map((t, i) => ({
		id: 'node-' + i,
		type: 'transformer',
		data: { label: t.name, fields: t.fields, element: t },
		position: { x: HORIZONTAL_SPACING * i, y: 0 }
	}))

	const alwaysNodes = [{
		id: 'start',
		type: 'start',
		data: { label: 'START' },
		position: { x: -140, y: NODE_HEIGHT / 2  }
	}, {
		id: 'end',
		type: 'end',
		data: { label: 'END' },
		position: { x: HORIZONTAL_SPACING * (transformers.length) , y: NODE_HEIGHT / 2 }
	}]

	const edges = transformers.map((_, i) => ({
		id: 'edge-' + i,
		source: 'node-' + i,
		target: 'node-' + (i + 1)
	}))
	edges.pop()

	const alwaysEdges = transformers.length <= 0 ? [{ id: 'connect', source: 'start', target: 'end'}] : [{
		id: 'edge-start',
		source: 'start',
		target: 'node-0'
	}, {
		id: 'edge-end',
		source: 'node-' + (transformers.length - 1),
		target: 'end'
	}]

	return { nodes: [...nodes, ...alwaysNodes], edges: [...edges, ...alwaysEdges] }
}

function FlowComponent() {
	const [ nodes, setNodes] = useState(initialNodes)
	const [ edges, setEdges] = useState(initialEdges)
	const { fitView } = useReactFlow()

	useEffect(() => {
		const transformerManager = (window as any).transformerManager as TransformerManager
		const onChange = () => {
			const structure = getStructure( transformerManager.activeTransformers )
			setNodes(structure.nodes)
			setEdges(structure.edges)
		}
		
		transformerManager.onChange(onChange)
		onChange()

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
				nodes={nodes}
				edges={edges}
				nodeTypes={nodeTypes}
				minZoom={DEFAULT_GRAPH_OPTIONS.minZoom}
				maxZoom={DEFAULT_GRAPH_OPTIONS.maxZoom}
				defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
				onNodesChange={onNodesChange}
				onEdgesChange={onEdgesChange}
				onConnect={onConnect}
			/>
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