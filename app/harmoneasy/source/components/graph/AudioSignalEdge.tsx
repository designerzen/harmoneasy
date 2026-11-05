import React, { useEffect, useRef } from "react"
import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react"
import type { IAudioOutput } from "audiobus/io/outputs/output-interface"
import { watchOutputLevel } from "./audio-levels"

export function AudioSignalEdge({
	id,
	sourceX,
	sourceY,
	targetX,
	targetY,
	sourcePosition,
	targetPosition,
	data
}: EdgeProps) {
	const group = useRef<SVGGElement>(null)
	const output = data?.output as IAudioOutput | undefined
	useEffect(() => {
		if (!output) {
			return
		}
		return watchOutputLevel(output, (level) => {
			group.current?.style.setProperty("--audio-level", level.toFixed(3))
			group.current?.toggleAttribute("data-live", level > 0)
		})
	}, [output])
	const [path] = getSmoothStepPath({
		sourceX,
		sourceY,
		sourcePosition,
		targetX,
		targetY,
		targetPosition
	})
	return (
		<g ref={group} className="audio-signal-edge">
			<BaseEdge id={id} path={path} />
		</g>
	)
}
