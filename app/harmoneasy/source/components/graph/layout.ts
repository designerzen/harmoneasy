import { HORIZONTAL_SPACING, NODE_HEIGHT, LAYOUT_MODE, DEFAULT_LAYOUT_MODE } from './options'
import { Position } from '@xyflow/react'
import { layoutFromMap } from 'entitree-flex'

import type TransformerManager from 'audiobus/io/transformer-manager'
import type TransformerManagerWorker from 'audiobus/io/transformer-manager-worker'
import type IOChain from 'audiobus/io/IO-chain'

const { Top, Bottom, Left, Right } = Position

// thort these were supposed to be dynamic?
const nodeWidth = HORIZONTAL_SPACING
const nodeHeight = NODE_HEIGHT

const Orientation = {
	Vertical: 'vertical',
	Horizontal: 'horizontal',
}

export const EDGE_TYPE = {
	animated: 'animatedSvg'
}

export const NOTE_TYPE = {
	input:"input",
	start:"start",
	transformer:"transformer",
	output:"output",
	end:"end"
}

const entitreeSettings = {
	clone: true, // returns a copy of the input, if your application does not allow editing the original object
	enableFlex: true, // has slightly better performance if turned off (node.width, node.height will not be read)
	firstDegreeSpacing: 100, // spacing in px between nodes belonging to the same source, e.g. children with same parent
	nextAfterAccessor: 'spouses', // the side node prop used to go sideways, AFTER the current node
	nextAfterSpacing: 100, // the spacing of the "side" nodes AFTER the current node
	nextBeforeAccessor: 'siblings', // the side node prop used to go sideways, BEFORE the current node
	nextBeforeSpacing: 100, // the spacing of the "side" nodes BEFORE the current node
	nodeHeight, // default node height in px
	nodeWidth, // default node width in px
	orientation: Orientation.Vertical, // "vertical" to see parents top and children bottom, "horizontal" to see parents left and
	rootX: 0, // set root position if other than 0
	rootY: 0, // set root position if other than 0
	secondDegreeSpacing: 100, // spacing in px between nodes not belonging to same parent eg "cousin" nodes
	sourcesAccessor: 'parents', // the prop used as the array of ancestors ids
	sourceTargetSpacing: 100, // the "vertical" spacing between nodes in vertical orientation, horizontal otherwise
	targetsAccessor: 'children', // the prop used as the array of children ids
}

/**
 * 
 * @param tree 
 * @param rootId 
 * @param direction 
 * @returns 
 */
export const layoutElements = (tree, rootId:String|Number, direction = 'TB') => {
	const isTreeHorizontal = direction === 'LR'

	const { nodes: entitreeNodes, rels: entitreeEdges } = layoutFromMap(
		rootId,
		tree,
		{
			...entitreeSettings,
			orientation: isTreeHorizontal
				? Orientation.Horizontal
				: Orientation.Vertical,
		},
	)

	const nodes = []
	const edges = []

	entitreeEdges.forEach((edge) => {

		const sourceNode = edge.source.id
		const targetNode = edge.target.id

		const newEdge = {}

		newEdge.id = 'e' + sourceNode + targetNode
		newEdge.source = sourceNode
		newEdge.target = targetNode
		newEdge.type = 'smoothstep'
		newEdge.animated = 'true'

		// Check if target node is spouse or sibling
		const isTargetSpouse = !!edge.target.isSpouse
		const isTargetSibling = !!edge.target.isSibling

		if (isTargetSpouse) {
			newEdge.sourceHandle = isTreeHorizontal ? Bottom : Right
			newEdge.targetHandle = isTreeHorizontal ? Top : Left
		} else if (isTargetSibling) {
			newEdge.sourceHandle = isTreeHorizontal ? Top : Left
			newEdge.targetHandle = isTreeHorizontal ? Bottom : Right
		} else {
			newEdge.sourceHandle = isTreeHorizontal ? Right : Bottom
			newEdge.targetHandle = isTreeHorizontal ? Left : Top
		}

		edges.push(newEdge)
	})

	entitreeNodes.forEach((node) => {
		const newNode = {}

		const isSpouse = !!node?.isSpouse
		const isSibling = !!node?.isSibling
		const isRoot = node?.id === rootId

		if (isSpouse) {
			newNode.sourcePosition = isTreeHorizontal ? Bottom : Right
			newNode.targetPosition = isTreeHorizontal ? Top : Left
		} else if (isSibling) {
			newNode.sourcePosition = isTreeHorizontal ? Top : Left
			newNode.targetPosition = isTreeHorizontal ? Bottom : Right
		} else {
			newNode.sourcePosition = isTreeHorizontal ? Right : Bottom
			newNode.targetPosition = isTreeHorizontal ? Left : Top
		}

		newNode.data = { label: node.name, direction, isRoot, ...node }
		newNode.id = node.id
		newNode.type = 'custom'

		newNode.width = nodeWidth
		newNode.height = nodeHeight

		newNode.position = {
			x: node.x,
			y: node.y,
		}

		nodes.push(newNode)
	})

	return { nodes, edges }
}


// These get overwritten immediately - bit pointless really
export const initialNodes = [
	{ id: 'node-start', position: { x: 0, y: 200 }, data: { label: 'Start' } },
	{ id: 'node-end', position: { x: 500, y: 200 }, data: { label: 'End' } }
]

export const initialEdges = [
	{ id: 'edge-start-end', source: initialNodes[0].id, target: initialNodes[1].id }
]

/**
 * node:transformer-Transformer-Harmoniser-2
 * @param uuid 
 * @param nodeType 
 * @returns 
 */
export const getNodeID = ( uuid:string, nodeType:string="node:transformer" ):string => {
	return nodeType + '[' + uuid + ']'
}

/**
 * Set handle positions based on layout mode for custom node structures
 */
const setNodeHandles = (node: any, isVertical: boolean) => {
	if (isVertical) {
		node.sourcePosition = Bottom
		node.targetPosition = Top
	} else {
		node.sourcePosition = Right
		node.targetPosition = Left
	}
	return node
}

/**
 * GUI structure for the interactive node graph - 
 * create the nodes in our graph from our IOChain
 * 
 * @param chain 
 * @param showInputs 
 * @param showOutputs 
 * @param layoutMode - 'horizontal' or 'vertical'
 * @returns 
 */
export const getStructure = ( chain:IOChain, showInputs:boolean=true, showOutputs:boolean=true, layoutMode:string=DEFAULT_LAYOUT_MODE ) => {

	const transformManager:TransformerManager|TransformerManagerWorker = chain.transformerManager
	const transformers = transformManager.activeTransformers
	const hasTransformers = transformers.length > 0

	const firstTransformer = transformers[0]
	const lastTransformer = transformers[transformers.length - 1]
	
	const inputs = chain.inputs
	const outputs = chain.outputs
	
	const isVerticalLayout = layoutMode === LAYOUT_MODE.vertical

	// Calculate vertical layout dimensions
	const verticalInputsY = 0
	const verticalStartY = (inputs.length * (NODE_HEIGHT / 1.5)) + 100
	const verticalTransformersStartY = verticalStartY + NODE_HEIGHT + 100
	const verticalEndY = verticalTransformersStartY + (transformers.length * (NODE_HEIGHT + 50))
	const verticalOutputsY = verticalEndY + NODE_HEIGHT + 100

	const inputNodes = showInputs ? inputs
		.filter((input: AbstractInput) => !input.isHidden)
		.map((input:AbstractInput, index:number) => {
			let xPos: number
			if (isVerticalLayout) {
				// Spread inputs to the left of center, fanning out
				const inputCount = inputs.filter((i: AbstractInput) => !i.isHidden).length
				const offset = ((inputCount - 1) / 2 - index) * HORIZONTAL_SPACING * 1.2
				xPos = -400 + offset
			} else {
				xPos = -660
			}
			return setNodeHandles({
				id: 'node-input-'+index,
				type: NOTE_TYPE.input,
				data: { 
					label: 'INPUT' + input.name,
					input,
					index,
					layoutMode
				},
				position: isVerticalLayout 
					? { x: xPos, y: verticalInputsY }
					: { x: -660 , y: index * (NODE_HEIGHT / 1.5) }
			}, isVerticalLayout)
		}) : []

	// From Inputs to Start
	const nodeStart = setNodeHandles({
		id: 'node-start',
		type: NOTE_TYPE.start,
		data: { 
			label: 'START',
			layoutMode
		},
		position: isVerticalLayout 
			? { x: -350, y: verticalStartY }
			: { x: -180, y: NODE_HEIGHT / 2  }
	}, isVerticalLayout)

	// Chain through the Transformers
	const nodesTransformers = transformers.map((transformer:Transformer, index) => setNodeHandles({
		id: getNodeID(transformer.uuid),
		type: NOTE_TYPE.transformer,
		data: { 
			label: transformer.name, 
			fields: transformer.fields, 
			element: transformer, 
			description: transformer.description,
			layoutMode
		},
		position: isVerticalLayout 
			? { x: 0, y: verticalTransformersStartY + (index * (NODE_HEIGHT + 120)) }
			: { x: HORIZONTAL_SPACING * index, y: 0 }
	}, isVerticalLayout))

	// End Graph nodes
	const nodeEnd = setNodeHandles({
		id: 'node-end',
		type: NOTE_TYPE.end,
		data: { 
			label: 'END',
			layoutMode
		},
		position: isVerticalLayout 
			? { x: 350, y: verticalEndY }
			: { x: HORIZONTAL_SPACING * (transformers.length) , y: NODE_HEIGHT / 2 }
	}, isVerticalLayout)

	// Add in all our output nodes
	const outputNodes = showOutputs ? outputs
		.filter((output: AbstractInput) => !output.isHidden)
		.map((output:AbstractInput, index:number) => {
			let xPos: number
			if (isVerticalLayout) {
				// Spread outputs to the right of center, fanning out
				const outputCount = outputs.filter((o: AbstractInput) => !o.isHidden).length
				const offset = (index - (outputCount - 1) / 2) * HORIZONTAL_SPACING * 1.2
				xPos = 400 + offset
			} else {
				xPos = (HORIZONTAL_SPACING * transformers.length ) + 226
			}
			return setNodeHandles({
				id: 'node-output-'+index,
				type: NOTE_TYPE.output,
				data: { 
					label: 'OUTPUT' + output.name,
					output,
					index,
					layoutMode
				},
				position: isVerticalLayout 
					? { x: xPos, y: verticalOutputsY }
					: { x: (HORIZONTAL_SPACING * transformers.length ) + 226 , y: index * (NODE_HEIGHT / 1.5) }
			}, isVerticalLayout)
		}) : []
	
	const nodes = [
		...inputNodes,
		nodeStart, 
		...nodesTransformers, 
		nodeEnd,
		...outputNodes
	]

	// EDGES -----------------------------------------

	// Simple Edges
	if (!hasTransformers)
	{
		const edgePassthrough = {
			id: 'edge-passthrough',
			source: nodeStart.id,
			target: nodeEnd.id,
			type: EDGE_TYPE.animated,
			animated: true
		}

		return {
			nodes,
			edges:[ edgePassthrough ]
		}
	}
	
	// Complex edges
	const barDuration = '0.8s'

	const inputEdges = inputNodes.map((inputNode, index:number) => ({
		id: 'edge-input-'+index,
		source: inputNode.id,
		target: nodeStart.id,
		type: EDGE_TYPE.animated, 
		animated: true,
		data: { 
			duration: barDuration,
			type: NOTE_TYPE.input,
			name: inputNode.id
		}
	}))

	const edgeStart ={
		id: 'edge-start',
		source: nodeStart.id,
		target: getNodeID( firstTransformer.uuid ),
		// type: EDGE_TYPE.animated,
		data: { 
			duration: barDuration,
			type:NOTE_TYPE.start
		}
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
			// type: EDGE_TYPE.animated,
			data: { 
				duration: barDuration,
				type:NOTE_TYPE.transformer
			}
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
		// type: EDGE_TYPE.animated,
		data: { 
			duration: barDuration 
		}
	}

	const outputEdges = outputNodes.map((outputNode, index:number) => ({
		id: 'edge-output-'+index,
		source: nodeEnd.id,
		target: outputNode.id,
		type: EDGE_TYPE.animated,
		animated: true,
		data: { 
			duration: barDuration,
			type:NOTE_TYPE.output
		}
	}))

	// If there are no transformers, we just connect
	// Start to End
	const edges = [
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



