import React, { useState } from "react"
import { Handle, Position } from "@xyflow/react"
import { TransformerDialog } from "../GraphDialogs"

export function AddTransformerNode({
	data
}: {
	data?: { layoutMode?: string; standalone?: boolean }
}) {
	const [open, setOpen] = useState(false)
	const vertical = data?.layoutMode === "vertical"
	return (
		<div className="node-add-transformer graph-node">
			<button
				className="cta btn-add nodrag nopan"
				type="button"
				onClick={() => setOpen(true)}
			>
				Transformer
			</button>
			{!data?.standalone && (
				<>
					<Handle type="target" position={vertical ? Position.Top : Position.Left} />
					<Handle type="source" position={vertical ? Position.Bottom : Position.Right} />
				</>
			)}
			{open && <TransformerDialog onClose={() => setOpen(false)} />}
		</div>
	)
}