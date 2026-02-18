import React, { useState, useEffect, useRef } from 'react'
import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react'
import { INPUT_EVENT, NOTE_ON, OUTPUT_EVENT } from 'audiobus/commands'
import { convertNoteNumberToColour } from 'audiobus/conversion/note-to-colour'
import { NOTE_TYPE } from './layout'

import type OutputAudioEvent from 'audiobus/outputs/output-audio-event'
import type { IAudioCommand } from 'audiobus/audio-command-interface'
import type IOChain from 'audiobus/IO-chain'
import type InputAudioEvent from 'audiobus/inputs/input-audio-event'

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
	const [ colour, setColour ] = useState( (data?.colour as string) || '#fff' )
	const [ radius, setRadius ] = useState( (data?.radius as number) ?? 8 )
	const animateMotionRef = useRef<SVGAnimateMotionElement>(null)

	useEffect(() => {
		const abortController = new AbortController()
		const onAudioEvent = (audioEvent:InputAudioEvent|OutputAudioEvent) => {
			
			const command:IAudioCommand = audioEvent.command	
			const colour = convertNoteNumberToColour( command.number )
			const radius = ( command.velocity ?? 128) / 16

			// TODO: check to see if this event was started from the Input
			const from = command.from
			console.log("AnimatedSVGEdge::onAudioEvent", {command, from, data})
			
			
			
			setColour( colour )
			setRadius( radius)
			setDuration( (radius * .1) + 's' )
				
			// Restart the animation if it is a NOTE_ON event
			if (command.type === NOTE_ON && animateMotionRef.current) {
			// if ( animateMotionRef.current) {
				animateMotionRef.current.beginElement()
			}
			// console.info(command.type, "AnimatedSVGEdge::AudioEvent", id, {audioEvent, command, colour, radius})
		}

		switch (data?.type)
		{
			case NOTE_TYPE.input:
				chain.inputManager.addEventListener(INPUT_EVENT, onAudioEvent, { signal: abortController.signal })
				break

			default:
				//chain.outputManager.addEventListener(OUTPUT_EVENT, onAudioEvent, { signal: abortController.signal })
		}

		return () => abortController.abort()
	}, [id])

	useEffect(() => {
		if (!animateMotionRef.current) return

		const onAnimationEnd = () => {
			// console.info("AnimatedSVGEdge::animationEnd", id)
			// setColour( 'transparent' )
			// animateMotionRef.current.removeEventListener('endEvent', onAnimationEnd)
		}

		animateMotionRef.current.addEventListener('endEvent', onAnimationEnd)
		return () => animateMotionRef.current?.removeEventListener('endEvent', onAnimationEnd)
	}, [id])

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
				<animateMotion 
					ref={animateMotionRef}
					dur={duration} 
					repeatCount="1" 
					path={edgePath}
				/>
			</circle>
		</>
	)
}




