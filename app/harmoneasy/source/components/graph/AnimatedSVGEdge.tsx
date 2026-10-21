import { useChain } from './ChainContext'
import React, { useEffect, useRef } from 'react'
import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react'
import { INPUT_EVENT, NOTE_ON } from 'audiobus/commands'
import { convertNoteNumberToColour } from 'audiobus/conversion/note-to-colour'
import { NOTE_TYPE } from './layout'

import type { IAudioCommand } from 'audiobus/audio-command-interface'

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

	const { chain } = useChain()

	const circleRef = useRef<SVGCircleElement>(null)
	const animateMotionRef = useRef<SVGAnimateMotionElement>(null)

	useEffect(() => {
		if (data?.type !== NOTE_TYPE.input) return
		const abortController = new AbortController()
		let frame: number | null = null
		let latest: IAudioCommand
		const onAudioEvent = (event: Event) => {
			const command = (event as Event & { command: IAudioCommand }).command
			if (command.from !== data?.name || command.type !== NOTE_ON || command.velocity === 0) return
			latest = command
			if (frame !== null) return
			frame = requestAnimationFrame(() => {
				frame = null
				const circle = circleRef.current
				const motion = animateMotionRef.current
				if (!circle || !motion) return
				const radius = (latest.velocity ?? 127) / 16
				circle.setAttribute('fill', convertNoteNumberToColour(latest.number))
				circle.setAttribute('r', String(radius))
				motion.setAttribute('dur', `${radius * .1}s`)
				motion.beginElement()
			})
		}
		chain.inputManager.addEventListener(INPUT_EVENT, onAudioEvent, { signal: abortController.signal })
		return () => {
			abortController.abort()
			if (frame !== null) cancelAnimationFrame(frame)
		}
	}, [chain, data?.type, data?.name])

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
			<circle ref={circleRef} className='beat' r={(data?.radius as number) ?? 8} fill={(data?.colour as string) || '#fff'}>
				<animateMotion
					ref={animateMotionRef}
					dur={(data?.duration as string) || '2s'}
					begin="indefinite"
					repeatCount="1"
					path={edgePath}
				/>
			</circle>
		</>
	)
}




