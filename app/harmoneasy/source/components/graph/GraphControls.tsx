import React from "react"
import { Controls, ControlButton, useReactFlow, useViewport } from "@xyflow/react"
import { DEFAULT_GRAPH_OPTIONS } from "./options"

const PAN_STEP = 140

function motionDuration(): number {
	const mode = document.documentElement.dataset.reducedMotion
	if (mode === "reduce") {
		return 0
	}
	if (mode !== "allow" && matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
		return 0
	}
	return 150
}

export function GraphControls({ layoutMode }: { layoutMode: string }) {
	const { zoomIn, zoomOut, fitView, getViewport, setViewport } = useReactFlow()
	const { zoom } = useViewport()
	const panBy = (dx: number, dy: number) => {
		const current = getViewport()
		void setViewport(
			{ x: current.x + dx, y: current.y + dy, zoom: current.zoom },
			{ duration: motionDuration() }
		)
	}
	return (
		<Controls
			className="graph-view-controls"
			showZoom={false}
			showFitView={false}
			orientation={layoutMode === "vertical" ? "horizontal" : "vertical"}
		>
			<ControlButton
				className="graph-zoom-in btn-zoom-in"
				title="Zoom in"
				aria-label="Zoom in"
				disabled={zoom >= DEFAULT_GRAPH_OPTIONS.maxZoom}
				onClick={() => void zoomIn({ duration: motionDuration() })}
			>
				<span className="sr-only">Zoom in</span>
			</ControlButton>
			<ControlButton
				className="graph-zoom-out btn-zoom-out"
				title="Zoom out"
				aria-label="Zoom out"
				disabled={zoom <= DEFAULT_GRAPH_OPTIONS.minZoom}
				onClick={() => void zoomOut({ duration: motionDuration() })}
			>
				<span className="sr-only">Zoom out</span>
			</ControlButton>
			<ControlButton
				className="graph-fit-all"
				title="Fit all inside viewport"
				aria-label="Fit all inside viewport"
				onClick={() =>
					void fitView({
						padding: 0.15,
						duration: motionDuration(),
						...DEFAULT_GRAPH_OPTIONS
					})
				}
			>
				<svg
					className="graph-control-icon"
					viewBox="0 0 24 24"
					aria-hidden="true"
					focusable="false"
				>
					<rect x="2" y="3" width="20" height="18" rx="2" />
					<path d="m5 6 4 4M6 10h3V7m10 11-4-4m0 3v-3h3" />
				</svg>
			</ControlButton>
			<ControlButton
				className="graph-pan-up"
				title="Pan canvas up"
				aria-label="Pan canvas up"
				onClick={() => panBy(0, PAN_STEP)}
			>
				<svg
					className="graph-control-icon"
					viewBox="0 0 24 24"
					aria-hidden="true"
					focusable="false"
				>
					<path d="M12 19V5m-6 6 6-6 6 6" />
				</svg>
			</ControlButton>
			<ControlButton
				className="graph-pan-down"
				title="Pan canvas down"
				aria-label="Pan canvas down"
				onClick={() => panBy(0, -PAN_STEP)}
			>
				<svg
					className="graph-control-icon"
					viewBox="0 0 24 24"
					aria-hidden="true"
					focusable="false"
				>
					<path d="M12 5v14m-6-6 6 6 6-6" />
				</svg>
			</ControlButton>
			<ControlButton
				className="graph-pan-left"
				title="Pan canvas left"
				aria-label="Pan canvas left"
				onClick={() => panBy(PAN_STEP, 0)}
			>
				<svg
					className="graph-control-icon"
					viewBox="0 0 24 24"
					aria-hidden="true"
					focusable="false"
				>
					<path d="M19 12H5m6-6-6 6 6 6" />
				</svg>
			</ControlButton>
			<ControlButton
				className="graph-pan-right"
				title="Pan canvas right"
				aria-label="Pan canvas right"
				onClick={() => panBy(-PAN_STEP, 0)}
			>
				<svg
					className="graph-control-icon"
					viewBox="0 0 24 24"
					aria-hidden="true"
					focusable="false"
				>
					<path d="M5 12h14m-6-6 6 6-6 6" />
				</svg>
			</ControlButton>
		</Controls>
	)
}