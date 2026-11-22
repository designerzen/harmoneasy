import { GraphControls } from "./GraphControls"
import {
	EVENT_CONFIGURATION_CHANGED,
	EVENT_CONTROL_SURFACE_MINIMISE
} from "audiobus/events/event-constants"
import { isConfigurationUpdate } from "audiobus/io/configuration-events"
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
	useStoreApi,
	useNodesInitialized
} from "@xyflow/react"

import { AnimatedSVGEdge } from "./AnimatedSVGEdge.tsx"
import { StartNode } from "./nodes/StartNode.tsx"
import { EndNode } from "./nodes/EndNode.tsx"
import { SpeakerNode } from "./nodes/SpeakerNode.tsx"
import { AudioSignalEdge } from "./AudioSignalEdge.tsx"
import { SectionDividers } from "./SectionDividers.tsx"
import { InputNode } from "./nodes/InputNode.tsx"
import { OutputNode } from "./nodes/OutputNode.tsx"
import { TransformerNode } from "./nodes/TransformerNode.tsx"
import { AddTransformerNode } from "./nodes/AddTransformerNode.tsx"
import { ControlSurfaceNode } from "./nodes/ControlSurfaceNode"
import { AddControlSurfaceNode } from "./nodes/AddControlSurfaceNode"
import {
	CONTROL_HANDLE,
	SURFACE_HANDLE,
	controlComponentId,
	disconnectSurface,
	removeSurface,
	selectSurfaceControls
} from "./control-surfaces"
import {
	bezierPreviewPath,
	buildConnectionCandidate,
	describeConnectionStory,
	describeHandleAction,
	handleKey,
	inferConnectionIntent,
	nudgePosition,
	type HandleDescriptor,
	type PendingConnection,
	type PendingNodeMove
} from "./graph-interactions"
import { announceLive } from "../../libs/dialog-utils"

import {
	DEFAULT_GRAPH_OPTIONS,
	DEFAULT_VIEWPORT_OPTIONS,
	DEFAULT_LAYOUT_MODE,
	READABLE_FIT_OPTIONS,
	FIT_TOP_MARGIN
} from "./options.ts"

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
	speaker: SpeakerNode,
	input: InputNode,
	output: OutputNode,
	transformer: TransformerNode,
	addTransformer: AddTransformerNode,
	controlSurface: ControlSurfaceNode,
	addControlSurface: AddControlSurfaceNode
}

const edgeTypes = {
	animatedSvg: AnimatedSVGEdge,
	audioSignal: AudioSignalEdge
}

function FlowComponent({ isFront, focusRequest }: { isFront: boolean; focusRequest: number }) {
	const { chain, chainId } = useChain()
	const [nodes, setNodes] = useState(initialNodes)
	const [edges, setEdges] = useState(initialEdges)
	const [layoutMode, setLayoutMode] = useState(chain.options.graphLayout ?? DEFAULT_LAYOUT_MODE)
	const { fitView, getNodes, getNodesBounds, getViewport, setViewport, screenToFlowPosition } =
		useReactFlow()
	const store = useStoreApi()
	const flowWrapperRef = useRef<HTMLDivElement | null>(null)
	const handlePointerStart = useRef<{ x: number; y: number } | null>(null)
	const handleDragged = useRef(false)
	const savedViewport = useRef<ReturnType<typeof getViewport> | null>(null)
	const fittedLayout = useRef<string | null>(null)
	const fittedFocusRequest = useRef(-1)
	const nodesInitialized = useNodesInitialized()
	const [fullscreenNodeId, setFullscreenNodeId] = useState<string | null>(null)
	const [compactNodeIds, setCompactNodeIds] = useState<Set<string>>(() => new Set())
	const [pendingConnection, setPendingConnection] = useState<PendingConnection | null>(null)
	const [wireOrigin, setWireOrigin] = useState<{ x: number; y: number } | null>(null)
	const [wireTarget, setWireTarget] = useState<{ x: number; y: number } | null>(null)
	const [pendingMoveNode, setPendingMoveNode] = useState<PendingNodeMove | null>(null)
	const [movePointer, setMovePointer] = useState<{ x: number; y: number } | null>(null)
	const controlDialogs = useRef(new Set<{ destroy(): void }>())
	useEffect(() => {
		const minimise = (event: Event) => {
			const surfaceId = (event as CustomEvent<string>).detail
			setCompactNodeIds(
				(previous) => new Set([...previous, `${chainId}:control-surface-${surfaceId}`])
			)
		}
		chain.addEventListener(EVENT_CONTROL_SURFACE_MINIMISE, minimise)
		return () => chain.removeEventListener(EVENT_CONTROL_SURFACE_MINIMISE, minimise)
	}, [chain, chainId])
	useEffect(
		() => () => {
			for (const dialog of controlDialogs.current) {
				dialog.destroy()
			}
		},
		[]
	)

	useEffect(() => {
		const abortController = new AbortController()

		// an event has bubbled from the Chain
		const onTransformersChanged = (event?: Event) => {
			if (isConfigurationUpdate(event)) {
				return
			}
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
			void fitView(READABLE_FIT_OPTIONS).then(() => {
				const { x, zoom } = getViewport()
				const bounds = getNodesBounds(getNodes())
				if (bounds.height * zoom > store.getState().height) {
					void setViewport({ x, y: FIT_TOP_MARGIN - bounds.y * zoom, zoom })
				}
			})
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
			if (edge.data?.controlSurfaceId) {
				disconnectSurface(
					chain,
					String(edge.data.controlSurfaceId),
					String(edge.data.componentId)
				)
				continue
			}
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
			if (node.data.surface) {
				removeSurface(chain, node.data.surface.id)
				continue
			}
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
		if (
			connection.sourceHandle === CONTROL_HANDLE ||
			connection.targetHandle === SURFACE_HANDLE ||
			target?.type === "controlSurface"
		) {
			return Boolean(
				connection.sourceHandle === CONTROL_HANDLE &&
				connection.targetHandle === SURFACE_HANDLE &&
				target?.data.surface &&
				(source?.data.input || source?.data.output || source?.data.element)
			)
		}
		if (connection.sourceHandle === "audio-out" || connection.targetHandle === "audio-in") {
			return Boolean(
				connection.sourceHandle === "audio-out" &&
				connection.targetHandle === "audio-in" &&
				source?.data.output &&
				target?.data.output?.audioInput &&
				source !== target
			)
		}
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
		if (connection.sourceHandle === CONTROL_HANDLE && target?.data.surface) {
			const component = source?.data.input ?? source?.data.output ?? source?.data.element
			if (component) {
				controlDialogs.current.add(
					selectSurfaceControls(
						chain,
						target.data.surface.id,
						controlComponentId(component)
					)
				)
			}
			return
		}
		if (connection.sourceHandle === "audio-out" && source?.data.output && target?.data.output) {
			chain.outputManager.moveAfter(target.data.output, source.data.output)
			return
		}
		if (source?.data.input) {
			chain.addInput(source.data.input)
		}
		if (target?.data.output) {
			chain.addOutput(target.data.output)
		}
	}

	const fullscreenTriggerRef = React.useRef<HTMLElement | null>(null)
	const fullscreenDialogRef = React.useRef<HTMLDivElement | null>(null)

	const handleFullscreenMode = (nodeId: string) => {
		if (!fullscreenNodeId) {
			savedViewport.current = getViewport()
			fullscreenTriggerRef.current =
				document.activeElement instanceof HTMLElement &&
				document.activeElement !== document.body
					? document.activeElement
					: null
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
		const trigger = fullscreenTriggerRef.current
		fullscreenTriggerRef.current = null
		requestAnimationFrame(() => {
			if (trigger?.isConnected) {
				trigger.focus()
			}
		})
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

	const cancelPendingConnection = useCallback((announce = false) => {
		setPendingConnection(null)
		setWireOrigin(null)
		setWireTarget(null)
		if (announce) {
			announceLive("Connection cancelled.")
		}
	}, [])

	const persistNodePosition = useCallback(
		(nodeId: string, positionKey: string, position: { x: number; y: number }) => {
			setNodes((snapshot) =>
				snapshot.map((item) => (item.id === nodeId ? { ...item, position } : item))
			)
			chain.setGraphOptions({
				positions: {
					...chain.options.positions,
					[positionKey]: position
				}
			})
		},
		[chain]
	)

	const cancelPendingMove = useCallback(
		(revert = true, announce = false) => {
			setPendingMoveNode((current) => {
				if (current && revert) {
					setNodes((snapshot) =>
						snapshot.map((item) =>
							item.id === current.nodeId ? { ...item, position: current.origin } : item
						)
					)
				}
				if (current && announce) {
					announceLive(`Cancelled moving ${current.label}.`)
				}
				return null
			})
			setMovePointer(null)
		},
		[]
	)

	const handleStartNodeMove = useCallback(
		(nodeId: string) => {
			cancelPendingConnection(false)
			if (pendingMoveNode?.nodeId === nodeId) {
				cancelPendingMove(true, true)
				return
			}
			const node = nodes.find((item) => item.id === nodeId)
			if (!node || !node.data.positionKey) {
				return
			}
			const label = String(
				node.data.label ||
					node.data.surface?.name ||
					node.data.input?.name ||
					node.data.output?.name ||
					"node"
			)
			setPendingMoveNode({
				nodeId: node.id,
				positionKey: String(node.data.positionKey),
				label,
				origin: { ...node.position },
				width: node.measured?.width ?? 220,
				height: node.measured?.height ?? 140
			})
			setMovePointer(null)
			announceLive(
				`Moving ${label}. Click anywhere on the canvas to place it, use arrow keys to nudge and Enter to confirm, or press Escape to cancel.`
			)
		},
		[nodes, pendingMoveNode, cancelPendingConnection, cancelPendingMove]
	)

	const commitMoveAtPosition = useCallback(
		(position: { x: number; y: number }) => {
			if (!pendingMoveNode) {
				return
			}
			persistNodePosition(pendingMoveNode.nodeId, pendingMoveNode.positionKey, position)
			announceLive(`Placed ${pendingMoveNode.label}.`)
			setPendingMoveNode(null)
			setMovePointer(null)
		},
		[pendingMoveNode, persistNodePosition]
	)

	const centerRelativeToWrapper = useCallback((el: Element | null) => {
		const wrapper = flowWrapperRef.current
		if (!wrapper || !el) {
			return null
		}
		const wrapRect = wrapper.getBoundingClientRect()
		const rect = el.getBoundingClientRect()
		return {
			x: rect.left - wrapRect.left + rect.width / 2,
			y: rect.top - wrapRect.top + rect.height / 2
		}
	}, [])

	const readHandleDescriptor = (el: HTMLElement): HandleDescriptor | null => {
		const nodeId = el.getAttribute("data-nodeid")
		const handleType = el.getAttribute("data-handletype")
		if (!nodeId || (handleType !== "source" && handleType !== "target")) {
			return null
		}
		return {
			nodeId,
			handleId: el.getAttribute("data-handleid"),
			handleType
		}
	}

	const validPartnerHandleElements = useCallback(
		(descriptor: HandleDescriptor): HTMLElement[] => {
			const wrapper = flowWrapperRef.current
			if (!wrapper) {
				return []
			}
			const matches: HTMLElement[] = []
			for (const el of wrapper.querySelectorAll<HTMLElement>(".react-flow__handle")) {
				if (el.style.visibility === "hidden" || el.classList.contains("connectable-false")) {
					continue
				}
				const other = readHandleDescriptor(el)
				if (!other) {
					continue
				}
				const candidate = buildConnectionCandidate(descriptor, other)
				if (candidate && validConnection(candidate)) {
					matches.push(el)
				}
			}
			return matches
		},
		[nodes, edges]
	)

	const activateHandle = useCallback(
		(handleEl: HTMLElement) => {
			const descriptor = readHandleDescriptor(handleEl)
			if (!descriptor) {
				return
			}
			if (pendingMoveNode) {
				cancelPendingMove(true, false)
			}
			const node = nodes.find((item) => item.id === descriptor.nodeId)
			const nodeLabel = String(
				node?.data.label ||
					node?.data.surface?.name ||
					node?.data.input?.name ||
					node?.data.output?.name ||
					"component"
			)

			// Click 2: try to complete connection or cancel/re-arm.
			if (pendingConnection) {
				if (handleKey(pendingConnection) === handleKey(descriptor)) {
					cancelPendingConnection(true)
					return
				}
				const candidate = buildConnectionCandidate(pendingConnection, descriptor)
				if (candidate && validConnection(candidate)) {
					onConnect(candidate)
					cancelPendingConnection(false)
					announceLive(`Connected ${pendingConnection.nodeLabel} and ${nodeLabel}.`)
					return
				}
			}

			// Click 1: arm a new 2-click connection if at least one valid partner exists.
			const partners = validPartnerHandleElements(descriptor)
			const intent = inferConnectionIntent(descriptor.handleId)
			if (!partners.length) {
				if (intent === "controls" && descriptor.handleType === "source") {
					announceLive(
						`Add a Control Surface to connect ${nodeLabel} controls.`
					)
				} else {
					announceLive(`No compatible ports available for ${nodeLabel}.`)
				}
				return
			}
			const nextPending: PendingConnection = {
				...descriptor,
				nodeLabel,
				portLabel: handleEl.getAttribute("aria-label") || `${nodeLabel} port`,
				intent
			}
			setPendingConnection(nextPending)
			const origin = centerRelativeToWrapper(handleEl)
			setWireOrigin(origin)
			setWireTarget(centerRelativeToWrapper(partners[0]) ?? origin)
			announceLive(describeConnectionStory(nextPending))
		},
		[
			nodes,
			pendingConnection,
			pendingMoveNode,
			validPartnerHandleElements,
			centerRelativeToWrapper,
			cancelPendingConnection,
			cancelPendingMove
		]
	)

	// Sync visual storytelling classes/attributes onto React Flow handles and nodes while armed.
	useEffect(() => {
		const wrapper = flowWrapperRef.current
		if (!wrapper) {
			return
		}
		const clear = () => {
			for (const el of wrapper.querySelectorAll<HTMLElement>("[data-connect-role]")) {
				delete el.dataset.connectRole
				delete el.dataset.connectBadge
			}
			for (const el of wrapper.querySelectorAll<HTMLElement>("[data-connect-node]")) {
				delete el.dataset.connectNode
			}
		}
		if (!pendingConnection) {
			clear()
			return
		}
		const sourceKey = handleKey(pendingConnection)
		const actionBadge = describeHandleAction(pendingConnection)
		const validTargets = new Set(
			validPartnerHandleElements(pendingConnection).map((el) => {
				const desc = readHandleDescriptor(el)
				return desc ? handleKey(desc) : ""
			})
		)
		const targetNodes = new Set<string>()
		let sourceEl: HTMLElement | null = null
		for (const el of wrapper.querySelectorAll<HTMLElement>(".react-flow__handle")) {
			const desc = readHandleDescriptor(el)
			if (!desc) {
				continue
			}
			const key = handleKey(desc)
			if (key === sourceKey) {
				el.dataset.connectRole = "source"
				delete el.dataset.connectBadge
				sourceEl = el
			} else if (validTargets.has(key)) {
				el.dataset.connectRole = "valid-target"
				el.dataset.connectBadge = actionBadge
				targetNodes.add(desc.nodeId)
			} else {
				el.dataset.connectRole = "dimmed"
				delete el.dataset.connectBadge
			}
		}
		if (sourceEl) {
			setWireOrigin(centerRelativeToWrapper(sourceEl))
		}
		for (const nodeEl of wrapper.querySelectorAll<HTMLElement>(".react-flow__node")) {
			const id = nodeEl.getAttribute("data-id")
			if (!id) {
				continue
			}
			if (id === pendingConnection.nodeId) {
				nodeEl.dataset.connectNode = "source"
			} else if (targetNodes.has(id)) {
				nodeEl.dataset.connectNode = "target"
			} else {
				nodeEl.dataset.connectNode = "dimmed"
			}
		}
		return clear
	}, [pendingConnection, nodes, edges, validPartnerHandleElements, centerRelativeToWrapper])

	useEffect(() => {
		if (pendingConnection && !nodes.some((n) => n.id === pendingConnection.nodeId)) {
			cancelPendingConnection(false)
		}
		if (pendingMoveNode && !nodes.some((n) => n.id === pendingMoveNode.nodeId)) {
			cancelPendingMove(false, false)
		}
	}, [nodes, pendingConnection, pendingMoveNode, cancelPendingConnection, cancelPendingMove])

	// Pass fullscreen & 2-click move handlers to node data
	const nodesWithFullscreen: GraphNode[] = nodes.map((node) => ({
		...node,
		data: {
			...node.data,
			onFullscreen: handleFullscreenMode,
			onMinimise: handleMinimise,
			onMoveNode: node.draggable !== false ? handleStartNodeMove : undefined,
			isMoving: pendingMoveNode?.nodeId === node.id,
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

	const movingNodeCenter = pendingMoveNode
		? centerRelativeToWrapper(
				flowWrapperRef.current?.querySelector(
					`.react-flow__node[data-id="${CSS.escape(pendingMoveNode.nodeId)}"]`
				) ?? null
			)
		: null
	const activeViewportZoom = getViewport().zoom || 1

	return (
		<div
			ref={flowWrapperRef}
			className="graph-flow-shell"
			data-connect-state={pendingConnection ? "armed" : undefined}
			data-move-state={pendingMoveNode ? "armed" : undefined}
			onPointerDownCapture={(event) => {
				const target = event.target as HTMLElement | null
				if (target?.closest(".react-flow__handle")) {
					handlePointerStart.current = { x: event.clientX, y: event.clientY }
					handleDragged.current = false
				} else {
					handlePointerStart.current = null
				}
			}}
			onPointerMove={(event) => {
				if (handlePointerStart.current) {
					const moved = Math.hypot(
						event.clientX - handlePointerStart.current.x,
						event.clientY - handlePointerStart.current.y
					)
					if (moved > 5) {
						handleDragged.current = true
						if (pendingConnection) {
							cancelPendingConnection(false)
						}
					}
				}
				const wrapper = flowWrapperRef.current
				if (!wrapper) {
					return
				}
				if (pendingConnection) {
					const rect = wrapper.getBoundingClientRect()
					setWireTarget({ x: event.clientX - rect.left, y: event.clientY - rect.top })
				}
				if (pendingMoveNode) {
					const rect = wrapper.getBoundingClientRect()
					setMovePointer({ x: event.clientX - rect.left, y: event.clientY - rect.top })
				}
			}}
			onClickCapture={(event) => {
				const target = event.target as HTMLElement | null
				const handleEl = target?.closest<HTMLElement>(".react-flow__handle")
				if (!handleEl) {
					return
				}
				handlePointerStart.current = null
				if (handleDragged.current) {
					handleDragged.current = false
					return
				}
				event.preventDefault()
				event.stopPropagation()
				activateHandle(handleEl)
			}}
			onFocusCapture={(event) => {
				if (!pendingConnection) {
					return
				}
				const target = event.target as HTMLElement | null
				const handleEl = target?.closest<HTMLElement>(
					'.react-flow__handle[data-connect-role="valid-target"]'
				)
				if (handleEl) {
					setWireTarget(centerRelativeToWrapper(handleEl))
				}
			}}
			onKeyDown={(event) => {
				const target = event.target as HTMLElement | null
				if (event.key === "Escape") {
					if (pendingConnection) {
						event.preventDefault()
						event.stopPropagation()
						cancelPendingConnection(true)
						return
					}
					if (pendingMoveNode) {
						event.preventDefault()
						event.stopPropagation()
						cancelPendingMove(true, true)
						return
					}
				}
				if (
					(event.key === "Enter" || event.key === " ") &&
					target?.classList.contains("react-flow__handle")
				) {
					event.preventDefault()
					event.stopPropagation()
					activateHandle(target)
					return
				}
				if (pendingMoveNode) {
					const moving = nodes.find((item) => item.id === pendingMoveNode.nodeId)
					if (!moving) {
						return
					}
					const nextPos = nudgePosition(moving.position, event.key, event.shiftKey)
					if (nextPos) {
						event.preventDefault()
						event.stopPropagation()
						setNodes((snapshot) =>
							snapshot.map((item) =>
								item.id === pendingMoveNode.nodeId ? { ...item, position: nextPos } : item
							)
						)
						return
					}
					if (
						event.key === "Enter" &&
						!target?.closest(".graph-story-banner button")
					) {
						event.preventDefault()
						event.stopPropagation()
						commitMoveAtPosition(moving.position)
					}
				}
			}}
		>
			{pendingConnection && (
				<div className="graph-story-banner nodrag nopan" role="status">
					<span className="graph-story-step">Step 2 of 2</span>
					<span>{describeConnectionStory(pendingConnection)}</span>
					<div className="graph-story-actions">
						<button
							type="button"
							className="secondary"
							onClick={() => cancelPendingConnection(true)}
						>
							Cancel
						</button>
					</div>
				</div>
			)}
			{pendingMoveNode && (
				<>
					<div className="graph-story-banner nodrag nopan" role="status">
						<span className="graph-story-step">Step 2 of 2</span>
						<span>
							Moving {pendingMoveNode.label} — click anywhere on the canvas to place it,
							or use Arrow keys then Place here.
						</span>
						<div className="graph-story-actions">
							<button
								type="button"
								className="primary"
								onClick={() => {
									const current = nodes.find(
										(item) => item.id === pendingMoveNode.nodeId
									)
									if (current) {
										commitMoveAtPosition(current.position)
									}
								}}
							>
								Place here
							</button>
							<button
								type="button"
								className="secondary"
								onClick={() => cancelPendingMove(true, true)}
							>
								Cancel
							</button>
						</div>
					</div>
					<div
						className="graph-move-overlay nodrag nopan"
						role="button"
						tabIndex={0}
						aria-label={`Click to place ${pendingMoveNode.label} on canvas`}
						onClick={(event) => {
							const flowPoint = screenToFlowPosition({
								x: event.clientX,
								y: event.clientY
							})
							commitMoveAtPosition({
								x: Math.round(flowPoint.x - pendingMoveNode.width / 2),
								y: Math.round(flowPoint.y - pendingMoveNode.height / 2)
							})
						}}
					>
						{movePointer && (
							<div
								className="graph-move-ghost"
								aria-hidden="true"
								style={{
									left: movePointer.x - (pendingMoveNode.width * activeViewportZoom) / 2,
									top: movePointer.y - (pendingMoveNode.height * activeViewportZoom) / 2,
									width: pendingMoveNode.width * activeViewportZoom,
									height: pendingMoveNode.height * activeViewportZoom
								}}
							>
								Place {pendingMoveNode.label} here
							</div>
						)}
					</div>
				</>
			)}
			{((pendingConnection && wireOrigin && wireTarget) ||
				(pendingMoveNode && movingNodeCenter && movePointer)) && (
				<svg className="graph-story-wire" aria-hidden="true">
					{pendingConnection && wireOrigin && wireTarget && (
						<>
							<path d={bezierPreviewPath(wireOrigin, wireTarget)} />
							<circle cx={wireOrigin.x} cy={wireOrigin.y} r={5} />
							<circle cx={wireTarget.x} cy={wireTarget.y} r={6} />
						</>
					)}
					{pendingMoveNode && movingNodeCenter && movePointer && (
						<>
							<path d={bezierPreviewPath(movingNodeCenter, movePointer)} />
							<circle cx={movingNodeCenter.x} cy={movingNodeCenter.y} r={5} />
							<circle cx={movePointer.x} cy={movePointer.y} r={5} />
						</>
					)}
				</svg>
			)}
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
				onPaneClick={() => {
					if (pendingConnection) {
						cancelPendingConnection(true)
					}
				}}
				onEdgeClick={(_, edge) => {
					if (edge.data?.controlSurfaceId) {
						controlDialogs.current.add(
							selectSurfaceControls(
								chain,
								String(edge.data.controlSurfaceId),
								String(edge.data.componentId)
							)
						)
					}
				}}
				onNodeDragStop={(_, node) => {
					if (pendingMoveNode) {
						cancelPendingMove(false, false)
					}
					chain.setGraphOptions({
						positions: {
							...chain.options.positions,
							[node.data.positionKey as string]: node.position
						}
					})
				}}
			>
				<GraphControls layoutMode={layoutMode} />
				<SectionDividers layoutMode={layoutMode} />
				{selectedNode &&
					ExpandedNode &&
					createPortal(
						<div
							ref={fullscreenDialogRef}
							className="node-viewport-editor nodrag nopan nowheel"
							role="dialog"
							aria-modal="true"
							aria-label={`${selectedNode.data.label || selectedNode.data.input?.name || selectedNode.data.output?.name} settings`}
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									event.stopPropagation()
									exitFullscreenMode()
									return
								}
								if (event.key === "Tab" && fullscreenDialogRef.current) {
									const focusables = [
										...fullscreenDialogRef.current.querySelectorAll<HTMLElement>(
											'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
										)
									].filter((el) => !el.closest("[hidden]") && el.tabIndex >= 0)
									const first = focusables[0]
									const last = focusables.at(-1)
									if (focusables.length) {
										if (event.shiftKey && document.activeElement === first) {
											event.preventDefault()
											last?.focus()
										} else if (!event.shiftKey && document.activeElement === last) {
											event.preventDefault()
											first?.focus()
										}
									}
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
		</div>
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