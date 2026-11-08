import { describe, expect, it } from "vitest"
import {
	getStructure,
	layoutMeasuredNodes,
	MAX_STAGE_NODES,
	NODE_GAP,
	type GraphNode
} from "../source/components/graph/layout"
import type IOChain from "audiobus/io/IO-chain"

const node = (
	id: string,
	column: number,
	row: number,
	width: number,
	height: number
): GraphNode => ({
	id,
	position: { x: 0, y: 0 },
	measured: { width, height },
	data: { layoutColumn: column, layoutRow: row }
})

describe("Measured graph layout", () => {
	it.each(["horizontal", "vertical"])(
		"keeps measured surfaces and their picker clear of routing in %s mode",
		(mode) => {
			const routing = [node("input", 0, 0, 400, 900), node("output", 1, 0, 650, 1200)]
			const surface = {
				...node("surface", 3, 0, 700, 600),
				type: "controlSurface",
				data: { layoutColumn: 3, layoutRow: 0, manualPosition: { x: 100, y: 10 } }
			}
			const picker = { ...node("picker", 0, 0, 180, 56), type: "addControlSurface" }
			const result = layoutMeasuredNodes([...routing, surface, picker], mode)
			const axis = mode === "horizontal" ? "y" : "x"
			const dimension = mode === "horizontal" ? "height" : "width"
			const boundary = Math.max(
				...result.slice(0, 2).map((n) => n.position[axis] + n.measured![dimension]!)
			)
			for (const n of result.slice(2)) {
				expect(n.position[axis]).toBeGreaterThanOrEqual(boundary + NODE_GAP)
			}
			const along = mode === "horizontal" ? "x" : "y"
			const alongDimension = mode === "horizontal" ? "width" : "height"
			expect(result[3].position[along]).toBeGreaterThanOrEqual(
				result[2].position[along] + surface.measured![alongDimension]! + NODE_GAP
			)
			expect(layoutMeasuredNodes(result, mode)).toEqual(result)
		}
	)
	it("wraps wide stages onto extra lines and never overlaps them", () => {
		const nodes = Array.from({ length: MAX_STAGE_NODES + 2 }, (_, index) =>
			node(`n${index}`, 0, index, 300, 200)
		)
		const laidOut = layoutMeasuredNodes(nodes, "vertical")
		const lines = [...new Set(laidOut.map((item) => item.position.y))]
		expect(lines).toEqual([0, 200 + NODE_GAP])
		expect(laidOut.filter((item) => item.position.y === 0)).toHaveLength(MAX_STAGE_NODES)
	})
	it.each(["vertical", "horizontal"])(
		"keeps the transformer picker on the trunk after all transformers in %s mode",
		(mode) => {
			for (const count of [0, 2]) {
				const chain = {
					options: { positions: { "node-add-transformer": { x: 9999, y: 9999 } } },
					inputs: [],
					outputs: [],
					transformerQuantity: count,
					transformers: Array.from({ length: count }, (_, index) => ({
						uuid: `t${index}`,
						name: `Transformer ${index}`
					}))
				} as unknown as IOChain
				const { nodes, edges } = getStructure(chain, true, true, mode, "test")
				const picker = nodes.find((node) => node.type === "addTransformer")!
				const end = nodes.find((node) => node.type === "end")!
				const previous = nodes.find(
					(node) => node.id === (count ? "test:transformer-t1" : "test:node-start")
				)!
				expect(picker.deletable).toBe(false)
				expect(picker.draggable).toBe(false)
				expect(picker.data.manualPosition).toBeUndefined()
				const axis = mode === "vertical" ? "y" : "x"
				const cross = mode === "vertical" ? "x" : "y"
				expect(picker.position[cross]).toBe(previous.position[cross])
				expect(previous.position[axis]).toBeLessThan(picker.position[axis])
				expect(
					edges.some((edge) => edge.source === previous.id && edge.target === picker.id)
				).toBe(true)
				expect(
					edges.some((edge) => edge.source === picker.id && edge.target === end.id)
				).toBe(true)
				expect(picker.position[axis]).toBeLessThan(end.position[axis])
			}
		}
	)
	it.each(["vertical", "horizontal"])(
		"appends device add buttons beside their nodes and routes devices directly in %s mode",
		(mode) => {
			const chain = {
				options: {},
				inputs: [
					{ id: "input-a", name: "Input A" },
					{ id: "input-b", name: "Input B" }
				],
				outputs: [
					{ id: "output-a", name: "Output A" },
					{ id: "output-b", name: "Output B" }
				],
				transformers: [{ uuid: "t0", name: "Transformer" }]
			} as unknown as IOChain
			const { nodes, edges } = getStructure(chain, true, true, mode, "test")
			const axis = mode === "vertical" ? "y" : "x"
			const cross = mode === "vertical" ? "x" : "y"
			for (const [type, buttonType] of [
				["input", "start"],
				["output", "end"]
			]) {
				const devices = nodes.filter((node) => node.type === type)
				const button = nodes.find((node) => node.type === buttonType)!
				expect(button.data.standalone).toBe(true)
				expect(button.position[axis]).toBe(devices[0].position[axis])
				expect(button.position[cross]).toBeGreaterThan(devices.at(-1)!.position[cross])
				expect(
					edges.some((edge) => edge.source === button.id || edge.target === button.id)
				).toBe(false)
				for (const device of devices) {
					expect(
						edges.some(
							(edge) =>
								(type === "input" ? edge.source : edge.target) === device.id &&
								edge.deletable
						)
					).toBe(true)
				}
			}
			expect(edges).toHaveLength(5)
		}
	)
	it.each(["vertical", "horizontal"])("uses actual dimensions in %s mode", (mode) => {
		const nodes = layoutMeasuredNodes(
			[
				node("input-a", 0, 0, 410, 260),
				node("input-b", 0, 1, 520, 700),
				node("start", 1, 0, 320, 150),
				node("tall", 2, 0, 270, 880),
				node("short", 3, 0, 190, 360),
				node("end", 4, 0, 320, 150)
			],
			mode
		)
		const vertical = mode === "vertical"
		for (let i = 0; i < nodes.length; i++) {
			for (let j = i + 1; j < nodes.length; j++) {
				const a = nodes[i],
					b = nodes[j]
				expect(
					a.position.x + a.measured!.width! <= b.position.x ||
						b.position.x + b.measured!.width! <= a.position.x ||
						a.position.y + a.measured!.height! <= b.position.y ||
						b.position.y + b.measured!.height! <= a.position.y
				).toBe(true)
			}
		}
		const tall = nodes[3],
			short = nodes[4]
		expect(
			vertical
				? short.position.y - tall.position.y - tall.measured!.height!
				: short.position.x - tall.position.x - tall.measured!.width!
		).toBe(NODE_GAP)
		tall.measured = { width: 500, height: 1200 }
		const resized = layoutMeasuredNodes(nodes, mode)
		expect(
			vertical
				? resized[4].position.y - resized[3].position.y
				: resized[4].position.x - resized[3].position.x
		).toBe((vertical ? 1200 : 500) + NODE_GAP)
		expect(layoutMeasuredNodes(resized, mode)).toEqual(resized)
	})
	it.each([0, 5])(
		"packs device row %i using full widths and updates after controls load",
		(column) => {
			const devices = [
				node("keyboard", column, 0, 440, 260),
				node("gamepad", column, 1, 680, 700),
				node("midi", column, 2, 404, 180)
			]
			const before = layoutMeasuredNodes(devices, "vertical")
			devices[1].measured = { width: 960, height: 800 }
			const after = layoutMeasuredNodes(devices, "vertical")
			for (const nodes of [before, after]) {
				for (let i = 1; i < nodes.length; i++) {
					expect(
						nodes[i].position.x -
							nodes[i - 1].position.x -
							nodes[i - 1].measured!.width!
					).toBe(NODE_GAP)
				}
				expect(
					nodes[0].position.x + nodes.at(-1)!.position.x + nodes.at(-1)!.measured!.width!
				).toBe(0)
			}
		}
	)
	it("preserves explicitly dragged positions", () => {
		const dragged = node("dragged", 0, 0, 320, 500)
		dragged.data.manualPosition = { x: 70, y: 80 }
		expect(layoutMeasuredNodes([dragged], "vertical")[0].position).toEqual({ x: 70, y: 80 })
	})
})