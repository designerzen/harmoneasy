import { Position, type Node, type Edge } from '@xyflow/react'
import { deviceId } from 'audiobus/io/device-definition'
import type IOChain from 'audiobus/io/IO-chain'
import { DEFAULT_LAYOUT_MODE } from './options'

export const EDGE_TYPE = { animated: 'animatedSvg' }
export const NOTE_TYPE = { input: 'input', start: 'start', transformer: 'transformer', addTransformer: 'addTransformer', output: 'output', end: 'end' }
export type GraphNode = Node<Record<string, any>>
export const initialNodes: GraphNode[] = []
export const initialEdges: Edge[] = []

export const getStructure = (chain: IOChain, showInputs = true, showOutputs = true,
    layoutMode = DEFAULT_LAYOUT_MODE, chainId = 'chain'): { nodes: GraphNode[]; edges: Edge[] } => {
    const vertical = layoutMode === 'vertical'
    const nodes: GraphNode[] = []
    const edges: Edge[] = []
    const prefix = (id: string) => `${chainId}:${id}`
    const addNode = (id: string, type: string, column: number, row: number, data: Record<string, any>, positionKey = id) => {
        const node: GraphNode = {
            id: prefix(id), type, data: { ...data, layoutMode, positionKey, layoutColumn: column, layoutRow: row,
                manualPosition: type === 'addTransformer' ? undefined : chain.options.positions?.[positionKey] },
            position: chain.options.positions?.[positionKey] ?? { x: 0, y: 0 },
            sourcePosition: vertical ? Position.Bottom : Position.Right,
            targetPosition: vertical ? Position.Top : Position.Left,
            deletable: type !== 'start' && type !== 'end' && type !== 'addTransformer',
            draggable: type !== 'addTransformer'
        }
        nodes.push(node)
        return node
    }
    const connect = (source: GraphNode, target: GraphNode) => edges.push({
        id: `${source.id}->${target.id}`, source: source.id, target: target.id,
        type: EDGE_TYPE.animated, animated: true,
        deletable: source.type === 'input' || target.type === 'output',
        data: { type: source.type, name: source.data.input?.name }
    })
    const inputs = showInputs ? chain.inputs.filter(input => !input.isHidden) : []
    const start = addNode('node-start', 'start', 0, inputs.length, { label: 'Inputs', standalone: inputs.length > 0 })
    const inputNodes = inputs.map((input, index) =>
        addNode('node-input-' + deviceId(input), 'input', 0, index, { label: input.name, input }))
    let previous = inputNodes.length ? inputNodes : [start]
    chain.transformers.forEach((element, index) => {
        const node = addNode('transformer-' + element.uuid, 'transformer', index + 1, 0,
            { label: element.name, element, fields: element.fields, description: element.description }, `transformer:${index}`)
        previous.forEach(source => connect(source, node))
        previous = [node]
    })
    const transformerColumn = chain.transformers.length + 1
    const addTransformer = addNode('node-add-transformer', 'addTransformer', transformerColumn, 0,
        { label: 'Transformers' })
    previous.forEach(source => connect(source, addTransformer))
    previous = [addTransformer]
    const outputs = showOutputs ? chain.outputs.filter(output => !output.isHidden) : []
    const end = addNode('node-end', 'end', transformerColumn + 1, outputs.length,
        { label: 'Outputs', standalone: outputs.length > 0 })
    if (!outputs.length) previous.forEach(source => connect(source, end))
    outputs.forEach((output, index) => {
        const node = addNode('node-output-' + deviceId(output), 'output', transformerColumn + 1,
            index, { label: output.name, output })
        previous.forEach(source => connect(source, node))
    })
    return { nodes: layoutMeasuredNodes(nodes, layoutMode), edges }
}

export const NODE_GAP = 48

/** Lay out each routing stage using actual node bounds, centered across the flow. */
export function layoutMeasuredNodes(nodes: GraphNode[], mode: string): GraphNode[] {
    const vertical = mode === 'vertical'
    const size = (node: GraphNode) => ({
        width: node.measured?.width ?? node.width ?? 320,
        height: node.measured?.height ?? node.height ?? 240,
    })
    const columns = new Map<number, GraphNode[]>()
    for (const node of nodes) {
        const column = node.data.layoutColumn as number
        if (!columns.has(column)) columns.set(column, [])
        columns.get(column)!.push(node)
    }
    const positions = new Map<string, { x: number; y: number }>()
    let along = 0
    for (const [, group] of [...columns].sort(([a], [b]) => a - b)) {
        group.sort((a, b) => a.data.layoutRow - b.data.layoutRow)
        const crossSize = (node: GraphNode) => vertical ? size(node).width : size(node).height
        const alongSize = (node: GraphNode) => vertical ? size(node).height : size(node).width
        const routingNodes = group.filter(node => !node.data.standalone)
        const total = routingNodes.reduce((sum, node) => sum + crossSize(node), 0) + NODE_GAP * (routingNodes.length - 1)
        let cross = -total / 2
        for (const node of group) {
            positions.set(node.id, node.data.manualPosition ?? (vertical ? { x: cross, y: along } : { x: along, y: cross }))
            cross += crossSize(node) + NODE_GAP
        }
        along += Math.max(...group.map(alongSize)) + NODE_GAP
    }
    return nodes.map(node => {
        const position = positions.get(node.id)!
        return node.position.x === position.x && node.position.y === position.y ? node : { ...node, position }
    })
}
