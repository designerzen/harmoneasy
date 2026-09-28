import { DeviceGui } from '../DeviceGui'
import { useChain } from '../ChainContext'
import { Handle, Position } from "@xyflow/react"
import React, { useCallback } from "react"

import type AbstractInput from 'audiobus/io/inputs/abstract-input'
import type { IAudioInput } from 'audiobus/io/inputs/input-interface'

export function InputNode(props: any) {
	const { chain, manager: ioManager } = useChain()
	const input: AbstractInput & IAudioInput = props.data?.input
	const hasConnectMethod = typeof input.connect === 'function'
	const hasDisconnectMethod = typeof input.disconnect === 'function'
	const hasControls = hasConnectMethod || hasDisconnectMethod

	const removeNode = useCallback(() => {
        chain.removeInput(input)
	}, [input, chain])

	const connectToInput = useCallback(async () => {
		try{
			await input.connect?.()
            chain.dispatchEvent(new Event('configurationChanged'))
		}catch(error){
			console.error(error)
		}
	}, [input, chain])

	const disconnectFromInput = useCallback(async () => {
		try{
			await input.disconnect?.()
            chain.dispatchEvent(new Event('configurationChanged'))
		}catch(error){
			console.error(error)
		}
	}, [input, chain])

	const isVertical = props.data?.layoutMode === 'vertical'
	const isFullscreen = props.data?.isFullscreen || false
	const onFullscreen = props.data?.onFullscreen

	const handleFullscreen = useCallback(() => {
		if (onFullscreen) {
			onFullscreen(props.id)
		}
	}, [props.id, onFullscreen])

	return <div className={`node-input graph-node can-remove ${hasControls ? 'has-controls' : 'no-controls'} ${isFullscreen ? 'is-fullscreen' : ''}`} title={input.description}>
		<div className="device-node-header node-actions">
			<button type="button" className="btn-remove nodrag nopan" title="Remove input" aria-label="Remove input" onClick={removeNode}>Remove</button>
            <h6>{input.name}</h6>
            <button type="button" className="btn-fullscreen nodrag nopan" onClick={handleFullscreen}
                autoFocus={isFullscreen} aria-expanded={isFullscreen}
                title={isFullscreen ? 'Minimise input' : 'Expand input'}
                aria-label={isFullscreen ? 'Minimise input' : 'Expand input'}>
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d={isFullscreen ? 'M3 9h6V3m6 0v6h6M3 15h6v6m6 0v-6h6' : 'M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6'} />
                </svg>
            </button>
		</div>
        {(ioManager.devices.find(entry => entry.device === input)?.chains.size ?? 0) > 1 && <small>Shared device</small>}
		<p className="sr-only">{props.data.label }</p>
		{
			hasConnectMethod && !input.isConnected && (
				<label className="connect-input">
					<span className="sr-only">Connect to Device</span>
					<button className="cta btn-connect" type="button" onClick={connectToInput}>
						Connect
					</button>
				</label>
			)
		}
		{
			hasDisconnectMethod && input.isConnected && (
				<label className="disconnect-input">
					<span className="sr-only">Disconnect from Device</span>
					<button className="cta btn-disconnect" type="button" onClick={disconnectFromInput}>Disconnect</button>
				</label>
			)
		}

		
		{/* Injected content from the nodes */}
		<DeviceGui device={input} expanded={isFullscreen} />
		

      	{!isFullscreen && <Handle type="source" position={isVertical ? Position.Bottom : Position.Right} />}
	</div>
}


