import { DeviceGui } from '../DeviceGui'
import { useChain } from '../ChainContext'
import { Handle, Position } from "@xyflow/react"
import React, { useCallback } from "react"

import type { IAudioOutput } from 'audiobus/io/outputs/output-interface'

export function OutputNode(props: any) {
	// This is awfully inefficient
	const { chain, manager: ioManager } = useChain()
	const output:IAudioOutput = props.data?.output
	const hasConnectMethod = typeof output.connect === 'function'
	const hasDisconnectMethod = typeof output.disconnect === 'function'
	const hasControls = hasConnectMethod || hasDisconnectMethod

	const removeNode = useCallback(() => {
        chain.removeOutput(output)
	}, [output, chain])

	const connectToOutput = useCallback(async () => {
		try{
			await output.connect?.()
            chain.dispatchEvent(new Event('configurationChanged'))
		}catch(error){
			console.error(error)
		}
	}, [output, chain])

	const disconnectFromOutput = useCallback(async () => {
		try{
			await output.disconnect?.()
            chain.dispatchEvent(new Event('configurationChanged'))
		}catch(error){
			console.error(error)
		}
	}, [output, chain])

	const isVertical = props.data?.layoutMode === 'vertical'
	const isFullscreen = props.data?.isFullscreen || false
	const onFullscreen = props.data?.onFullscreen

	const handleFullscreen = useCallback(() => {
		if (onFullscreen) {
			onFullscreen(props.id)
		}
	}, [props.id, onFullscreen])

	return <div className={`node-output graph-node can-remove ${hasControls ? 'has-controls' : 'no-controls'} ${isFullscreen ? 'is-fullscreen' : ''}`} title={output.description}>
		<div className="device-node-header node-actions">
			<button type="button" className="btn-remove nodrag nopan" title="Remove output" aria-label="Remove output" onClick={removeNode}>Remove</button>
            <h6>{output.name}</h6>
            <button type="button" className="btn-fullscreen nodrag nopan" onClick={handleFullscreen}
                autoFocus={isFullscreen} aria-expanded={isFullscreen}
                title={isFullscreen ? 'Minimise output' : 'Expand output'}
                aria-label={isFullscreen ? 'Minimise output' : 'Expand output'}>
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d={isFullscreen ? 'M3 9h6V3m6 0v6h6M3 15h6v6m6 0v-6h6' : 'M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6'} />
                </svg>
            </button>
		</div>
        {(ioManager.devices.find(entry => entry.device === output)?.chains.size ?? 0) > 1 && <small>Shared device</small>}
		<p className="sr-only">{props.data.label }</p>
		{
			hasConnectMethod && !output.isConnected && (
				<label className="connect-output">
					<span className="sr-only">Connect to Device</span>
					<button className="cta btn-connect" type="button" onClick={connectToOutput}>
						Connect
					</button>
				</label>
			)
		}
		{
			hasDisconnectMethod && output.isConnected && (
				<label className="disconnect-output">
					<span className="sr-only">Disconnect from Device</span>
					<button className="cta btn-disconnect" type="button" onClick={disconnectFromOutput}>Disconnect</button>
				</label>
			)
		}

		
		{/* Injected content from the nodes */}
		<DeviceGui device={output} expanded={isFullscreen} />
		

      	{!isFullscreen && <Handle type="target" position={isVertical ? Position.Top : Position.Left} />}
	</div>
}


