import { useNodes, ViewportPortal } from "@xyflow/react"
import React from "react"
import { graphSections } from "./sections"

import type { GraphNode } from "./layout"

/** Dotted, labelled lines between the graph stages; they follow nodes as they are dragged. */
export function SectionDividers({ layoutMode }: { layoutMode: string }) {
	const vertical = layoutMode === "vertical"
	const sections = graphSections(useNodes() as GraphNode[], layoutMode)
	return (
		<ViewportPortal>
			{sections.map(({ label, at, from, to, lane }) => {
				// A divider crosses the flow, so it is horizontal in a vertical layout.
				const horizontal = vertical !== Boolean(lane)
				return (
					<div
						key={label}
						className={`graph-section ${horizontal ? "is-horizontal" : "is-vertical"}`}
						style={
							horizontal
								? { transform: `translate(${from}px, ${at}px)`, width: to - from }
								: { transform: `translate(${at}px, ${from}px)`, height: to - from }
						}
						aria-hidden="true"
					>
						<span>{label}</span>
					</div>
				)
			})}
		</ViewportPortal>
	)
}
