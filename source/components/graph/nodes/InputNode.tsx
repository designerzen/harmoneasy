import { Handle, Position } from "@xyflow/react"
import React, { useCallback, useEffect, useRef } from "react"

import type AbstractInput from "../../../libs/audiobus/io/inputs/abstract-input"
import type IOChain from "../../../libs/audiobus/io/IO-chain"
import type { IAudioInput } from "../../../libs/audiobus/io/inputs/input-interface"

export function InputNode(props: { data: { input: AbstractInput; label: any } }) {

	const chain = (window as any).chain as IOChain
	const input:IAudioInput = props.data?.input
	const hasConnectMethod:boolean = input.connect ?? false
	const hasDisconnectMethod:boolean = input.disconnect ?? false
	const hasControls = hasConnectMethod || hasDisconnectMethod
	const GUIContainerRef = useRef<HTMLDivElement>(null)

	useEffect(() => {

		let gui
		const t = async()=>{

			if (GUIContainerRef.current && input && input.createGui && input.destroyGui) {
				gui = await input.createGui()
				GUIContainerRef.current.appendChild(gui)

				console.error("InputNode useEffect", {ref:GUIContainerRef.current, createGUI:input?.createGui, destroyGUI:input?.destroyGui} )
		
				//alert("injecting DOM")
			}else{
				console.error("InputNode IGNORED", {ref:GUIContainerRef.current, createGUI:input?.createGui, destroyGUI:input?.destroyGui} )
		
			}
		}

		t()
		
		return () =>{
			if (gui)
			{
				gui.remove()
				input.destroyGui()				
			}
		} 
	}, [input])


	/**
	 * 
	 */
	const connectToInput = useCallback(async () => {
		try{
			return await input.connect()
		}catch(error){
			console.error(error)
		}
	}, [input.isConnected])
	
	/**
	 * 
	 */
	const disconnectFromInput = useCallback(async () => {
		try{
			return await input.disconnect()
		}catch(error){
			console.error(error)
		}
	}, [input.isConnected])
		
	/**
	 * 
	 */	
	const removeNode = useCallback(() => {
		if (input.isConnected)
		{
			disconnectFromInput()
		}
		chain.removeInput(input)
	}, [input])

	/**
	 * 
	 */
	const isVertical = props.data.layoutMode === 'vertical'

	return <div className={`node-input graph-node can-remove ${hasControls ? 'has-controls' : 'no-controls'} `} title={input.description}>
		<h6>{input?.name }</h6>
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
					<button className="cta btn-disconnect" type="button" onClick={disconnectFromInput}>
						Disonnect
					</button>
				</label>
			)
		}

		{/* Injected content from the nodes */}
		<div ref={GUIContainerRef} />
		 
		<button type="button" className="btn-remove" onClick={removeNode}>Remove</button>
		<Handle type="source" position={isVertical ? Position.Bottom : Position.Right} />
	</div>
}