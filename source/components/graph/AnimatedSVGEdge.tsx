import React, { useState, useEffect } from 'react'
import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react'
import { OUTPUT_EVENT } from '../../commands'

import type OutputAudioEvent from '../../libs/audiobus/outputs/output-audio-event'
import type { IAudioCommand } from '../../libs/audiobus/audio-command-interface'
import { convertNoteNumberToColour } from '../../libs/audiobus/note-model'

export function AnimatedSVGEdge({
	id,
	sourceX,
	sourceY,
	targetX,
	targetY,
	sourcePosition,
	targetPosition,
	data,
}: EdgeProps) {

	const chain = (window as any).chain as IOChain
	
	const [ duration, setDuration ] = useState( (data?.duration as string) || '2s' )
	const [ colour, setColour ] = useState( (data?.colour as string) || '#ff0073' )
	const [ radius, setRadius ] = useState( (data?.radius as string) || '8' )

	useEffect(() => {
		const abortController = new AbortController()
		const onAudioOutputEvent = (outputEvent:OutputAudioEvent) => {
			const command:IAudioCommand = outputEvent.command	
			// TODO: Extrapolate the colour and size (noteNumber and velocity)
			const colour = convertNoteNumberToColour( command.number )
			setColour( colour )
			console.info("AnimatedSVGEdge::onAudioOutputEvent", id, {event: outputEvent, command})
		}
		chain.addEventListener(OUTPUT_EVENT, onAudioOutputEvent, { signal: abortController.signal })
	}, [])

	// We have altered the destination / source
	// useEffect(() => {
	// 	console.info("AnimatedSVGEdge::useEffect", { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data })
	// }, [id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data])

	const [edgePath] = getSmoothStepPath({
		sourceX,
		sourceY,
		sourcePosition,
		targetX,
		targetY,
		targetPosition,
	})

	return (
		<>
			<BaseEdge id={id} path={edgePath} />
			<circle className='beat' r={radius} fill={colour}>
				<animateMotion dur={duration} repeatCount="indefinite" path={edgePath} />
			</circle>
		</>
	)
}
