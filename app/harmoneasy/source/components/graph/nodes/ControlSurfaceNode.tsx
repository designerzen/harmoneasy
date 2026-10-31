import React, { useEffect, useRef } from "react"
import { Handle, Position } from "@xyflow/react"
import { useChain } from "../ChainContext"
import { mountControlSurface, removeSurface, SURFACE_HANDLE } from "../control-surfaces"

export function ControlSurfaceNode({data}:any) {
	const {chain}=useChain(),host=useRef<HTMLDivElement>(null)
	useEffect(()=>{
		if(!host.current)return
		const view=mountControlSurface(host.current,chain,data.surface.id)
		return()=>view.destroy()
	},[chain,data.surface.id])
	return <div className="node-control-surface graph-node">
		<header><strong>{data.surface.name}</strong><button type="button" onClick={()=>removeSurface(chain,data.surface.id)}>Remove surface</button></header>
		<Handle type="target" id={SURFACE_HANDLE} position={data.layoutMode==="vertical"?Position.Top:Position.Left} className="control-connector" aria-label="Connect component controls" />
		<div ref={host} className="nodrag nopan nowheel" />
	</div>
}
