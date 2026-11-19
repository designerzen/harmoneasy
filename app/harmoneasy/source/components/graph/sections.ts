import { NODE_GAP, NOTE_TYPE, type GraphNode } from "./layout"

export const SECTION = {
	inputs: "Inputs",
	transformers: "Transformers",
	outputs: "Outputs",
	effects: "Effects",
	controls: "Control Surfaces"
}
const FLOW = [SECTION.inputs, SECTION.transformers, SECTION.outputs, SECTION.effects]

export interface GraphSection {
	label: string
	/** Divider position in flow coordinates; the line runs across the flow unless `lane` is set. */
	at: number
	from: number
	to: number
	/** Control surfaces sit in a lane beside the routing, so their divider runs along the flow. */
	lane?: boolean
}

function sectionOf(node: GraphNode, hasEffects: boolean) {
	switch (node.type) {
		case NOTE_TYPE.input:
		case NOTE_TYPE.start:
			return SECTION.inputs
		case NOTE_TYPE.transformer:
		case NOTE_TYPE.addTransformer:
			return SECTION.transformers
		case NOTE_TYPE.end:
			return SECTION.outputs
		case NOTE_TYPE.output:
			return node.data.output?.audioInput ? SECTION.effects : SECTION.outputs
		case NOTE_TYPE.speaker:
			return hasEffects ? SECTION.effects : SECTION.outputs
		case "controlSurface":
		case "addControlSurface":
			return SECTION.controls
	}
}

/** Labelled dividers between the routing stages, measured from where the nodes actually are. */
export function graphSections(nodes: GraphNode[], mode: string): GraphSection[] {
	const vertical = mode === "vertical"
	const visible = nodes.filter((node) => !node.hidden)
	const hasEffects = visible.some(
		(node) => node.type === NOTE_TYPE.output && node.data.output?.audioInput
	)
	const bounds = new Map<string, { along: number[]; cross: number[] }>()
	for (const node of visible) {
		const label = sectionOf(node, hasEffects)
		if (!label) {
			continue
		}
		const width = node.measured?.width ?? node.width ?? 0
		const height = node.measured?.height ?? node.height ?? 0
		const { x, y } = node.position
		const box = bounds.get(label) ?? {
			along: [Infinity, -Infinity],
			cross: [Infinity, -Infinity]
		}
		const [along, alongEnd, cross, crossEnd] = vertical
			? [y, y + height, x, x + width]
			: [x, x + width, y, y + height]
		box.along = [Math.min(box.along[0], along), Math.max(box.along[1], alongEnd)]
		box.cross = [Math.min(box.cross[0], cross), Math.max(box.cross[1], crossEnd)]
		bounds.set(label, box)
	}
	const flow = FLOW.filter((label) => bounds.has(label)).map((label) => bounds.get(label)!)
	if (!flow.length) {
		return []
	}
	const pad = NODE_GAP / 2
	const crossFrom = Math.min(...flow.map((box) => box.cross[0])) - pad
	const crossTo = Math.max(...flow.map((box) => box.cross[1])) + pad
	const sections: GraphSection[] = []
	let previous: number | undefined
	for (const label of FLOW) {
		const box = bounds.get(label)
		if (!box) {
			continue
		}
		const at =
			previous !== undefined && previous < box.along[0]
				? (previous + box.along[0]) / 2
				: box.along[0] - pad
		sections.push({ label, at, from: crossFrom, to: crossTo })
		previous = box.along[1]
	}
	const controls = bounds.get(SECTION.controls)
	if (controls) {
		sections.push({
			label: SECTION.controls,
			at: Math.max(crossTo, controls.cross[0] - pad),
			from: Math.min(sections[0].at, controls.along[0] - pad),
			to: Math.max(previous ?? -Infinity, controls.along[1]) + pad,
			lane: true
		})
	}
	return sections
}