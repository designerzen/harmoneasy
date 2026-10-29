import React, { useState } from "react"
import { Handle, Position } from "@xyflow/react"
import { DeviceDialog } from "../GraphDialogs"

export function StartNode({
	data
}: {
	data?: { layoutMode?: string; standalone?: boolean }
	id?: string
}) {
	const [open, setOpen] = useState(false)
	const vertical = data?.layoutMode === "vertical"
	return (
		<div className="node-start graph-node">
			<button
				className="cta btn-add nodrag nopan"
				type="button"
				onClick={() => setOpen(true)}
			>
				Input
			</button>
			{!data?.standalone && (
				<Handle type="source" position={vertical ? Position.Bottom : Position.Right} />
			)}
			{open && <DeviceDialog direction="input" onClose={() => setOpen(false)} />}
		</div>
	)
}