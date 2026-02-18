import { Handle, Position } from "@xyflow/react"
import React, { useCallback, useEffect, useRef } from "react"

import type AbstractInput from 'audiobus/io/inputs/abstract-input'
import type { IAudioOutput } from 'audiobus/io/outputs/output-interface'
import type IOChain from 'audiobus/io/IO-chain'

export function OutputNode(props) {
	// This is awfully inefficient
	const chain = (window as any).chain as IOChain
	const output:IAudioOutput = props.data?.output
	const hasConnectMethod:boolean = output.connect ?? false
	const hasDisconnectMethod:boolean = output.disconnect ?? false
	const hasControls = hasConnectMethod || hasDisconnectMethod
	const GUIContainerRef = useRef<HTMLDivElement>(null)

	useEffect(() => {

		let gui
		const t = async()=>{
			if (GUIContainerRef.current && output?.createGui && output?.destroyGui) {
				gui = await output.createGui()
				GUIContainerRef.current.appendChild(gui)
			}
		}
		t()
		return () =>{
			if (gui)
			{
				gui.remove()
				output.destroyGui()				
			}
		} 
	}, [output])
	

	const removeNode = useCallback(() => {
		chain.removeOutput(output)
	}, [output])

	const connectToOutput = useCallback(async () => {
		try{
			return await output.connect()
		}catch(error){
			console.error(error)
		}
	}, [output])

	const disconnectFromOutput = useCallback(async () => {
		try{
			return await output.disconnect()
		}catch(error){
			console.error(error)
		}
	}, [output])

	const isVertical = props.data?.layoutMode === 'vertical'

	return <div className={`node-output graph-node can-remove ${hasControls ? 'has-controls' : 'no-controls'} `} title={output.description}>
		<h6>{output.name}</h6>
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
		<div ref={GUIContainerRef} />
		
		<button type="button" className="btn-remove" onClick={removeNode}>Remove</button>
      	<Handle type="target" position={isVertical ? Position.Top : Position.Left} />
	</div>
}


