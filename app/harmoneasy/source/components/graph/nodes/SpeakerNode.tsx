import React, { useEffect, useRef, useState } from "react"
import { Handle, Position } from "@xyflow/react"
import { deviceId } from "audiobus/io/device-definition"
import type { IAudioOutput } from "audiobus/io/outputs/output-interface"
import { DeviceDialog } from "../GraphDialogs"
import { watchOutputLevel } from "../audio-levels"

export function SpeakerNode({
	data
}: {
	data: { layoutMode?: string; outputs: IAudioOutput[] }
	id?: string
}) {
	const [open, setOpen] = useState(false)
	const root = useRef<HTMLDivElement>(null)
	const outputs = data.outputs
	const outputKey = outputs.map(deviceId).join()
	useEffect(() => {
		const levels = new Map<IAudioOutput, number>()
		const stops = outputs.map((output) =>
			watchOutputLevel(output, (level) => {
				levels.set(output, level)
				const loudest = Math.max(...levels.values())
				root.current?.style.setProperty("--audio-level", loudest.toFixed(3))
				root.current?.toggleAttribute("data-live", loudest > 0)
			})
		)
		return () => stops.forEach((stop) => stop())
	}, [outputKey])
	const label = `Speakers, fed by ${outputs.length} audio ${outputs.length === 1 ? "output" : "outputs"}`
	return (
		<div
			ref={root}
			className="node-speaker graph-node"
			role="group"
			aria-label={label}
			title={label}
		>
			<svg viewBox="0 0 120 80" aria-hidden="true">
				<g className="speaker-waves">
					<path d="M18 26a24 24 0 0 0 0 28" />
					<path d="M8 18a38 38 0 0 0 0 44" />
					<path d="M102 26a24 24 0 0 1 0 28" />
					<path d="M112 18a38 38 0 0 1 0 44" />
				</g>
				<circle className="speaker-surround" cx="60" cy="40" r="32" />
				<g className="speaker-cone">
					<circle cx="60" cy="40" r="24" />
					<circle className="speaker-cap" cx="60" cy="40" r="9" />
				</g>
			</svg>
			<button
				type="button"
				className="cta btn-add nodrag nopan"
				onClick={() => setOpen(true)}
				aria-label="Add Output before speakers"
			>
				Output
			</button>
			{open && (
				<DeviceDialog
					direction="output"
					audioProcessorsOnly
					onClose={() => setOpen(false)}
				/>
			)}
			<Handle
				type="target"
				position={data.layoutMode === "vertical" ? Position.Top : Position.Left}
				isConnectable={false}
			/>
		</div>
	)
}