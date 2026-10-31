import React, { useState } from "react"
import { Handle, Position } from "@xyflow/react"
import { DeviceDialog } from "../GraphDialogs"
import { useChain } from "../ChainContext"
import { createSurface } from "../control-surfaces"

export function EndNode({
	data
}: {
	data?: { layoutMode?: string; standalone?: boolean }
	id?: string
}) {
	const [open, setOpen] = useState(false)
	const { chain } = useChain()
	const vertical = data?.layoutMode === "vertical"
	return (
		<div className="node-end graph-node">
			<button
				className="cta btn-add nodrag nopan"
				type="button"
				onClick={() => setOpen(true)}
			>
				Output
			</button>
			<button className="nodrag nopan" type="button" onClick={() => createSurface(chain)}>
				Control Surface
			</button>
			{!data?.standalone && (
				<Handle type="target" position={vertical ? Position.Top : Position.Left} />
			)}
			{open && <DeviceDialog direction="output" onClose={() => setOpen(false)} />}
		</div>
	)
}