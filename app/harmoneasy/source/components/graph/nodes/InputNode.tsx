import { DeviceGui } from '../DeviceGui'
import { elementDescription } from '../element-icons'
import { DeviceTitleBar } from '../DeviceTitleBar'
import { EVENT_CONFIGURATION_CHANGED } from 'audiobus/event-constants'
import { deviceId } from 'audiobus/io/device-definition'
import { useChain } from '../ChainContext'
import { Handle, Position } from "@xyflow/react"
import React, { useCallback } from "react"

import type AbstractInput from 'audiobus/io/inputs/abstract-input'
import type { IAudioInput } from 'audiobus/io/inputs/input-interface'

export function InputNode(props: any) {
	const { chain, chainId, manager: ioManager } = useChain()
	const input: AbstractInput & IAudioInput = props.data?.input
	const hasConnectMethod = input.requiresConnectionControl !== false && typeof input.connect === 'function'
	const hasDisconnectMethod = input.requiresConnectionControl !== false && typeof input.disconnect === 'function'
	const hasControls = hasConnectMethod || hasDisconnectMethod

	const removeNode = useCallback(() => {
        chain.removeInput(input)
	}, [input, chain])

	const connectToInput = useCallback(async () => {
		try{
			await input.connect?.()
            chain.dispatchEvent(new Event(EVENT_CONFIGURATION_CHANGED))
		}catch(error){
			console.error(error)
		}
	}, [input, chain])

	const disconnectFromInput = useCallback(async () => {
		try{
			await input.disconnect?.()
            chain.dispatchEvent(new Event(EVENT_CONFIGURATION_CHANGED))
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

	return <div data-midi-scope={`${chainId}:input:${deviceId(input)}`} className={`node-input graph-node can-remove ${hasControls ? 'has-controls' : 'no-controls'} ${isFullscreen ? 'is-fullscreen' : ''}`} title={elementDescription('input', '', input.name, input.description)}>
        <DeviceTitleBar device={input} direction="input" expanded={isFullscreen} onExpand={handleFullscreen} onRemove={removeNode} />
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


