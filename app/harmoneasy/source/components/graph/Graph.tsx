import { GraphControls } from "./GraphControls"
import { EVENT_CONFIGURATION_CHANGED } from "audiobus/event-constants"
import { ChainContext, useChain } from "./ChainContext"
import type IOChainManager from "audiobus/io/IO-chain-manager"
import "@xyflow/react/dist/style.css"

import React, { useState, useCallback, useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import {
	ReactFlow,
	ReactFlowProvider,
	applyNodeChanges,
	applyEdgeChanges,
	type NodeChange,
	type EdgeChange,
	type Edge,
	type Connection,
	useReactFlow,
	useNodesInitialized
} from "@xyflow/react"

import { AnimatedSVGEdge } from "./AnimatedSVGEdge.tsx"
import { StartNode } from "./nodes/StartNode.tsx"
import { EndNode } from "./nodes/EndNode.tsx"
import { InputNode } from "./nodes/InputNode.tsx"
import { OutputNode } from "./nodes/OutputNode.tsx"
import { TransformerNode } from "./nodes/TransformerNode.tsx"
import { AddTransformerNode } from "./nodes/AddTransformerNode.tsx"

import { DEFAULT_GRAPH_OPTIONS, DEFAULT_VIEWPORT_OPTIONS, DEFAULT_LAYOUT_MODE } from "./options.ts"

import { EVENT_TRANSFORMERS_UPDATED } from "audiobus/io/transformer-manager.ts"
import { EVENT_INPUTS_UPDATED } from "audiobus/io/input-manager.ts"
import { EVENT_OUTPUTS_UPDATED } from "audiobus/io/output-manager.ts"

import {
	getStructure,
	layoutMeasuredNodes,
	initialEdges,
	initialNodes,
	type GraphNode
} from "./layout.ts"

const nodeTypes = {
	start: StartNode,
	end: EndNode,
	input: InputNode,
	output: OutputNode,
	transformer: TransformerNode,
	addTransformer: AddTransformerNode
}

const edgeTypes = {
	animatedSvg: AnimatedSVGEdge
}

function FlowComponent({ isFront, focusRequest }: { isFront: boolean; focusRequest: number }) {
	const { chain, chainId } = useChain()
	const [nodes, setNodes] = useState(initialNodes)
	const [edges, setEdges] = useState(initialEdges)
	const [layoutMode, setLayoutMode] = useState(chain.options.graphLayout ?? DEFAULT_LAYOUT_MODE)
	const { fitView, getViewport, setViewport } = useReactFlow()
	const savedViewport = useRef<ReturnType<typeof getViewport> | null>(null)
	const fittedLayout = useRef<string | null>(null)
	const fittedFocusRequest = useRef(-1)
	const nodesInitialized = useNodesInitialized()
	const [fullscreenNodeId, setFullscreenNodeId] = useState<string | null>(null)
	const [compactNodeIds, setCompactNodeIds] = useState<Set<string>>(() => new Set())

	useEffect(() => {
		const abortController = new AbortController()

		// an event has bubbled from the Chain
		const onTransformersChanged = () => {
			// const detail = event ? event.detail : null
			const structure = getStructure(chain, true, true, layoutMode, chainId)
			setNodes((previous) => {
				const measured = new Map(previous.map((node) => [node.id, node.measured]))
				return layoutMeasuredNodes(
					structure.nodes.map((node) => ({ ...node, measured: measured.get(node.id) })),
					layoutMode
				)
			})
			setEdges(structure.edges)
		}

		chain.addEventListener(
			EVENT_CONFIGURATION_CHANGED,
			() => {
				setLayoutMode(chain.options.graphLayout ?? DEFAULT_LAYOUT_MODE)
				onTransformersChanged()
			},
			{ signal: abortController.signal }
		)

		// watch for additions / removals of Transformers
		chain.transformerManager.addEventListener(
			EVENT_TRANSFORMERS_UPDATED,
			onTransformersChanged,
			{ signal: abortController.signal }
		)
		chain.inputManager.addEventListener(EVENT_INPUTS_UPDATED, onTransformersChanged, {
			signal: abortController.signal
		})
		chain.outputManager.addEventListener(EVENT_OUTPUTS_UPDATED, onTransformersChanged, {
			signal: abortController.signal
		})

		onTransformersChanged()

		// Cleanup: unsubscribe when component unmounts
		const unsubscribe = () => {
			abortController.abort()
		}
		return unsubscribe
	}, [setNodes, setEdges, layoutMode, chainId, chain])

	const measuredSizes = nodes
		.map((node) => `${node.id}:${node.measured?.width}:${node.measured?.height}`)
		.join("|")
	useEffect(() => {
		if (!nodesInitialized || fullscreenNodeId || !isFront) {
			return
		}
		if (savedViewport.current) {
			void setViewport(savedViewport.current)
			savedViewport.current = null
			return
		}
		// Preserve the user's pan and zoom during structure and size updates.
		if (fittedLayout.current === layoutMode && fittedFocusRequest.current === focusRequest) {
			return
		}
		const frame = requestAnimationFrame(() => {
			fittedLayout.current = layoutMode
			fittedFocusRequest.current = focusRequest
			void fitView({ padding: 0.15, duration: 150, ...DEFAULT_GRAPH_OPTIONS })
		})
		return () => cancelAnimationFrame(frame)
	}, [
		nodesInitialized,
		layoutMode,
		fitView,
		setViewport,
		measuredSizes,
		fullscreenNodeId,
		isFront,
		focusRequest
	])

	const onNodesChange = useCallback(
		(changes: NodeChange<GraphNode>[]) => {
			setNodes((snapshot) => {
				const next = applyNodeChanges(
					changes.filter((change) => change.type !== "remove"),
					snapshot
				)
				const resized = changes.some((change) => change.type === "dimensions")
				return resized && !fullscreenNodeId ? layoutMeasuredNodes(next, layoutMode) : next
			})
		},
		[layoutMode, fullscreenNodeId]
	)
	const onEdgesChange = useCallback((changes: EdgeChange[]) => {
		setEdges((snapshot) =>
			applyEdgeChanges(
				changes.filter((change) => change.type !== "remove"),
				snapshot
			)
		)
	}, [])
	const detachEdges = (edges: Edge[]) => {
		for (const edge of edges) {
			const source = nodes.find((node) => node.id === edge.source)
			const target = nodes.find((node) => node.id === edge.target)
			if (source?.data.input) {
				chain.removeInput(source.data.input)
			}
			if (target?.data.output) {
				chain.removeOutput(target.data.output)
			}
		}
	}
	const removeNodes = (removed: GraphNode[]) => {
		for (const node of removed) {
			if (node.data.input) {
				chain.removeInput(node.data.input)
			}
			if (node.data.output) {
				chain.removeOutput(node.data.output)
			}
			if (node.data.element) {
				chain.removeTransformer(node.data.element)
			}
		}
	}
	const validConnection = (connection: Connection | Edge) => {
		const source = nodes.find((node) => node.id === connection.source)
		const target = nodes.find((node) => node.id === connection.target)
		return Boolean(
			source &&
			target &&
			edges.some(
				(edge) =>
					(source.type === "input" &&
						edge.target === target.id &&
						nodes.some((node) => node.id === edge.source && node.type === "input")) ||
					(target.type === "output" &&
						edge.source === source.id &&
						nodes.some((node) => node.id === edge.target && node.type === "output"))
			)
		)
	}
	const onConnect = (connection: Connection) => {
		if (!validConnection(connection)) {
			return
		}
		const source = nodes.find((node) => node.id === connection.source)
		const target = nodes.find((node) => node.id === connection.target)
		if (source?.data.input) {
			chain.addInput(source.data.input)
		}
		if (target?.data.output) {
			chain.addOutput(target.data.output)
		}
	}

	const handleFullscreenMode = (nodeId: string) => {
		if (!fullscreenNodeId) {
			savedViewport.current = getViewport()
		}
		setFullscreenNodeId((current) => (current === nodeId ? null : nodeId))
	}

	useEffect(() => {
		if (fullscreenNodeId && !nodes.some((node) => node.id === fullscreenNodeId)) {
			setFullscreenNodeId(null)
		}
	}, [nodes, fullscreenNodeId])

	const exitFullscreenMode = () => {
		setFullscreenNodeId(null)
	}

	const handleMinimise = (nodeId: string) => {
		setCompactNodeIds((previous) => {
			const next = new Set(previous)
			if (fullscreenNodeId === nodeId || !next.has(nodeId)) {
				next.add(nodeId)
			} else {
				next.delete(nodeId)
			}
			return next
		})
		if (fullscreenNodeId === nodeId) {
			setFullscreenNodeId(null)
		}
	}

	// Pass fullscreen handlers to node data
	const nodesWithFullscreen: GraphNode[] = nodes.map((node) => ({
		...node,
		data: {
			...node.data,
			onFullscreen: handleFullscreenMode,
			onMinimise: handleMinimise,
			isCompact: compactNodeIds.has(node.id),
			isFullscreen: false,
			layoutMode
		}
	}))

	const isFullscreenActive = fullscreenNodeId !== null
	const selectedNode = nodesWithFullscreen.find((n) => n.id === fullscreenNodeId)
	const ExpandedNode =
		selectedNode?.type === "transformer"
			? TransformerNode
			: selectedNode?.type === "input"
				? InputNode
				: selectedNode?.type === "output"
					? OutputNode
					: null

	return (
		<>
			<ReactFlow
				className={ExpandedNode ? "node-expanded" : undefined}
				panOnScroll={false}
				zoomOnScroll={false}
				zoomActivationKeyCode={["Control", "Meta"]}
				preventScrolling={false}
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
				onNodeDragStop={(_, node) =>
					chain.setGraphOptions({
						positions: {
							...chain.options.positions,
							[node.data.positionKey as string]: node.position
						}
					})
				}
			>
				<GraphControls layoutMode={layoutMode} />
				{selectedNode &&
					ExpandedNode &&
					createPortal(
						<div
							className="node-viewport-editor nodrag nopan nowheel"
							role="dialog"
							aria-label={`${selectedNode.data.label || selectedNode.data.input?.name || selectedNode.data.output?.name} settings`}
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									event.stopPropagation()
									exitFullscreenMode()
								}
							}}
						>
							<ExpandedNode
								key={selectedNode.id}
								id={selectedNode.id}
								data={{ ...selectedNode.data, isFullscreen: true }}
							/>
						</div>,
						document.body
					)}
			</ReactFlow>
		</>
	)
}

export default function Graph({
	chain,
	chainId,
	manager,
	isFront,
	focusRequest
}: {
	chain: import("audiobus/io/IO-chain").default
	chainId: string
	manager: IOChainManager
	isFront: boolean
	focusRequest: number
}) {
	return (
		<ChainContext.Provider value={{ chain, chainId, manager }}>
			<ReactFlowProvider>
				<FlowComponent isFront={isFront} focusRequest={focusRequest} />
			</ReactFlowProvider>
		</ChainContext.Provider>
	)
}