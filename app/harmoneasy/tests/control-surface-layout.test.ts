import { describe, expect, it } from "vitest"
import {
	layoutWidgets,
	minimumWidgetHeight,
	playingLayout
} from "../../../packages/control-surface/src/layout"

type Box = { x: number; y: number; width: number; height: number }

/** Sweep the union of widget footprints plus their permitted half-gutters. */
function unusedArea(
	items: Box[],
	width: number,
	height: number,
	gap: number,
	gutter: number
): number {
	const boxes = items.map((item) => ({
		left: Math.max(0, item.x - Math.max(gap, gutter) / 2),
		right: Math.min(width, item.x + item.width + Math.max(gap, gutter) / 2),
		top: Math.max(0, item.y - gap / 2),
		bottom: Math.min(height, item.y + item.height + gap / 2)
	}))
	const edges = [...new Set([0, height, ...boxes.flatMap((box) => [box.top, box.bottom])])].sort(
		(a, b) => a - b
	)
	let unused = 0
	for (let i = 1; i < edges.length; i++) {
		const spans = boxes
			.filter((box) => box.top < edges[i] && box.bottom > edges[i - 1])
			.sort((a, b) => a.left - b.left)
		let edge = 0,
			covered = 0
		for (const span of spans) {
			covered += Math.max(0, span.right - Math.max(edge, span.left))
			edge = Math.max(edge, span.right)
		}
		unused += (width - covered) * (edges[i] - edges[i - 1])
	}
	return unused
}

describe("control surface area coverage", () => {
	it("repartitions an interlocked floorplan instead of leaving its centre empty", () => {
		const widgets = [
			{ span: 3, height: 129 },
			{ span: 1, height: 508 },
			{ span: 1, height: 508 },
			{ span: 3, height: 129 }
		]
		const layout = layoutWidgets(widgets, 900, 900, 655)
		expect(layout.pages).toBe(1)
		expect(unusedArea(layout.items, 900, 655, 11, 24)).toBeLessThan(0.001)
	})
	it.each(Array.from({ length: 20 }, (_, i) => i))(
		"covers every page outside its permitted gutters: sample group %i",
		(batch) => {
			let seed = 123456789 + batch
			const random = () => (seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296
			const kinds = ["dial", "text", "xy", "piano-roll", "strum"]
			for (let sample = 0; sample < 100; sample++) {
				const trial = batch * 100 + sample
				const scale = [0.5, 1, 1.5, 2][trial % 4]
				const screen = [280, 390, 640, 900, 1200][trial % 5]
				const width = screen / scale,
					height = (300 + Math.floor(random() * 600)) / scale
				const gap = 11 / Math.min(1, scale)
				const widgets = Array.from({ length: 2 + Math.floor(random() * 30) }, () => ({
					widget: kinds[Math.floor(random() * kinds.length)],
					span: 1 + Math.floor(random() * 3),
					height: 44 + Math.floor(random() * 600),
					column: random() < 0.2 ? Math.floor(random() * 5) : undefined
				}))
				const layout = layoutWidgets(widgets, width, screen, height, scale)
				for (let page = 0; page < layout.pages; page++) {
					const boxes = layout.items.filter((box) => box.page === page)
					expect(boxes.length).toBeGreaterThan(0)
					expect(
						unusedArea(boxes, width, height, gap, playingLayout(width, screen).gutter),
						`Unused area in trial ${trial}, page ${page}`
					).toBeLessThan(0.01)
				}
				for (const [i, a] of layout.items.entries()) {
					expect(a.x).toBeGreaterThanOrEqual(-0.001)
					expect(a.y).toBeGreaterThanOrEqual(-0.001)
					expect(a.x + a.width).toBeLessThanOrEqual(width + 0.001)
					expect(a.y + a.height).toBeLessThanOrEqual(height + 0.001)
					expect(a.width * scale + 0.001).toBeGreaterThanOrEqual(44)
					expect(a.height + 0.001).toBeGreaterThanOrEqual(
						Math.min(height, minimumWidgetHeight(widgets[i].widget, scale))
					)
					for (const b of layout.items
						.slice(i + 1)
						.filter((box) => box.page === a.page)) {
						const dx = Math.max(0, a.x - b.x - b.width, b.x - a.x - a.width)
						const dy = Math.max(0, a.y - b.y - b.height, b.y - a.y - a.height)
						expect(Math.hypot(dx, dy) + 0.001).toBeGreaterThanOrEqual(gap)
					}
				}
			}
		}
	)
})