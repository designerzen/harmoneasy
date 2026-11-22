import React, { useEffect, useRef } from "react"
import { Handle, Position } from "@xyflow/react"
import { useChain } from "../ChainContext"
import { mountControlSurface, removeSurface, SURFACE_HANDLE } from "../control-surfaces"
import { EVENT_CONTROL_SURFACE_EXPAND } from "audiobus/events/event-constants"
import { NodeHeader } from "../NodeHeader"
import { MinimiseButton } from "../MinimiseButton"

export function ControlSurfaceNode({ id, data }: any) {
	const { chain } = useChain(),
		host = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (!host.current) {
			return
		}
		// Graph zoom must not resize gadgets, or fitting the view grows the node forever.
		const view = mountControlSurface(
			host.current,
			chain,
			data.surface.id,
			undefined,
			undefined,
			false
		)
		return () => view.destroy()
	}, [chain, data.surface.id])
	const isMoving = Boolean(data.isMoving)
	return (
		<div
			className={`node-control-surface graph-node can-remove ${data.isCompact ? "is-compact" : ""} ${isMoving ? "is-moving-node" : ""}`}
		>
			<NodeHeader
				title={data.surface.name}
				removeLabel="Remove control surface"
				onRemove={() => removeSurface(chain, data.surface.id)}
				onMove={data.onMoveNode ? () => data.onMoveNode(id) : undefined}
				isMoving={isMoving}
			>
				<MinimiseButton
					compact={Boolean(data.isCompact)}
					direction="control surface"
					onClick={() => data.onMinimise?.(id)}
				/>
				<button
					type="button"
					className="device-expand"
					title="Expand control surface"
					aria-label="Expand control surface"
					aria-expanded={false}
					onClick={() =>
						chain.dispatchEvent(
							new CustomEvent(EVENT_CONTROL_SURFACE_EXPAND, {
								detail: data.surface.id
							})
						)
					}
				>
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<path d="M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6" />
					</svg>
				</button>
			</NodeHeader>
			<Handle
				type="target"
				id={SURFACE_HANDLE}
				position={data.layoutMode === "vertical" ? Position.Left : Position.Top}
				className="control-connector"
				tabIndex={0}
				role="button"
				aria-label={`Connect component controls to ${data.surface.name}`}
			/>
			<div ref={host} className="nodrag nopan nowheel" />
		</div>
	)
}