import { Position, type Node, type Edge } from '@xyflow/react'
import { deviceId } from 'audiobus/io/device-definition'
import type IOChain from 'audiobus/io/IO-chain'
import { DEFAULT_LAYOUT_MODE } from './options'

export const EDGE_TYPE = { animated: 'animatedSvg' }
export const NOTE_TYPE = { input: 'input', start: 'start', transformer: 'transformer', output: 'output', end: 'end' }
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
            id: prefix(id), type, data: { ...data, layoutMode, positionKey, layoutColumn: column, layoutRow: row, manualPosition: chain.options.positions?.[positionKey] },
            position: chain.options.positions?.[positionKey] ?? { x: 0, y: 0 },
            sourcePosition: vertical ? Position.Bottom : Position.Right,
            targetPosition: vertical ? Position.Top : Position.Left,
            deletable: type !== 'start' && type !== 'end'
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
    const start = addNode('node-start', 'start', 1, 0, { label: 'Inputs' })
    const inputs = showInputs ? chain.inputs.filter(input => !input.isHidden) : []
    inputs.forEach((input, index) => {
        const node = addNode('node-input-' + deviceId(input), 'input', 0,
            index - (inputs.length - 1) / 2, { label: input.name, input })
        connect(node, start)
    })
    let previous = start
    chain.transformers.forEach((element, index) => {
        const node = addNode('transformer-' + element.uuid, 'transformer', index + 2, 0,
            { label: element.name, element, fields: element.fields, description: element.description }, `transformer:${index}`)
        connect(previous, node)
        previous = node
    })
    const end = addNode('node-end', 'end', chain.transformerQuantity + 2, 0, { label: 'Outputs' })
    connect(previous, end)
    const outputs = showOutputs ? chain.outputs.filter(output => !output.isHidden) : []
    outputs.forEach((output, index) => {
        const node = addNode('node-output-' + deviceId(output), 'output', chain.transformerQuantity + 3,
            index - (outputs.length - 1) / 2, { label: output.name, output })
        connect(end, node)
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
        const total = group.reduce((sum, node) => sum + crossSize(node), 0) + NODE_GAP * (group.length - 1)
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
