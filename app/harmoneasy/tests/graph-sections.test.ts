import { expect, it } from "vitest"
import { graphSections, SECTION } from "../source/components/graph/sections"
import type { GraphNode } from "../source/components/graph/layout"

const node = (type: string, x: number, y: number, data: Record<string, any> = {}): GraphNode => ({
	id: `${type}-${x}-${y}`,
	type,
	position: { x, y },
	measured: { width: 100, height: 50 },
	data
})

it("places a labelled divider before each stage and a lane divider above control surfaces", () => {
	const sections = graphSections(
		[
			node("input", 0, 0),
			node("transformer", 200, 0),
			node("addTransformer", 400, 0),
			node("output", 600, 0, { output: {} }),
			node("output", 800, 0, { output: { audioInput: true } }),
			node("speaker", 1000, 0),
			node("controlSurface", 0, 300)
		],
		"horizontal"
	)
	expect(sections.map(({ label, at }) => [label, at])).toEqual([
		[SECTION.inputs, -24],
		[SECTION.transformers, 150],
		[SECTION.outputs, 550],
		[SECTION.effects, 750],
		[SECTION.controls, 276]
	])
	expect(sections.at(-1)).toMatchObject({ lane: true, from: -24, to: 1124 })
})

it("omits empty stages and keeps the speaker with Outputs when there are no effects", () => {
	const sections = graphSections(
		[node("start", 0, 0), node("output", 0, 200, { output: {} }), node("speaker", 0, 400)],
		"vertical"
	)
	expect(sections.map(({ label, at }) => [label, at])).toEqual([
		[SECTION.inputs, -24],
		[SECTION.outputs, 125]
	])
})
