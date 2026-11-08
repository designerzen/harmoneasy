import React from "react"
import { useChain } from "../ChainContext"
import { createSurface } from "../control-surfaces"

export function AddControlSurfaceNode() {
	const { chain } = useChain()
	return (
		<div className="node-add-control-surface graph-node">
			<button
				className="cta btn-add nodrag nopan"
				type="button"
				onClick={() => void createSurface(chain)}
			>
				Control Surface
			</button>
		</div>
	)
}