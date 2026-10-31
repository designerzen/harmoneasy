import { DeviceGui } from "../DeviceGui"
import { elementDescription } from "../element-icons"
import { DeviceTitleBar } from "../DeviceTitleBar"
import { EVENT_CONFIGURATION_CHANGED } from "audiobus/event-constants"
import { deviceId } from "audiobus/io/device-definition"
import { useChain } from "../ChainContext"
import { Handle, Position } from "@xyflow/react"
import React, { useCallback } from "react"
import { CONTROL_HANDLE } from "../control-surfaces"

import type { IAudioOutput } from "audiobus/io/outputs/output-interface"

export function OutputNode(props: any) {
	// This is awfully inefficient
	const { chain, chainId, manager: ioManager } = useChain()
	const output: IAudioOutput = props.data?.output
	const hasConnectMethod =
		output.requiresConnectionControl !== false && typeof output.connect === "function"
	const hasDisconnectMethod =
		output.requiresConnectionControl !== false && typeof output.disconnect === "function"
	const hasControls = hasConnectMethod || hasDisconnectMethod

	const removeNode = useCallback(() => {
		chain.removeOutput(output)
	}, [output, chain])

	const connectToOutput = useCallback(async () => {
		try {
			await output.connect?.()
			chain.dispatchEvent(new Event(EVENT_CONFIGURATION_CHANGED))
		} catch (error) {
			console.error(error)
		}
	}, [output, chain])

	const disconnectFromOutput = useCallback(async () => {
		try {
			await output.disconnect?.()
			chain.dispatchEvent(new Event(EVENT_CONFIGURATION_CHANGED))
		} catch (error) {
			console.error(error)
		}
	}, [output, chain])

	const isVertical = props.data?.layoutMode === "vertical"
	const isFullscreen = props.data?.isFullscreen || false
	const isCompact = Boolean(props.data?.isCompact) && !isFullscreen
	const onFullscreen = props.data?.onFullscreen

	const handleFullscreen = useCallback(() => {
		if (onFullscreen) {
			onFullscreen(props.id)
		}
	}, [props.id, onFullscreen])

	return (
		<div
			data-midi-scope={`${chainId}:output:${deviceId(output)}`}
			className={`node-output graph-node can-remove ${hasControls ? "has-controls" : "no-controls"} ${isFullscreen ? "is-fullscreen" : ""} ${isCompact ? "is-compact" : ""}`}
			title={elementDescription("output", "", output.name, output.description)}
		>
			<DeviceTitleBar
				device={output}
				direction="output"
				expanded={isFullscreen}
				compact={isCompact}
				onMinimise={() => props.data.onMinimise?.(props.id)}
				onExpand={handleFullscreen}
				onRemove={removeNode}
			/>
			{(ioManager.devices.find((entry) => entry.device === output)?.chains.size ?? 0) > 1 && (
				<small>Shared device</small>
			)}
			<p className="sr-only">{props.data.label}</p>
			{hasConnectMethod && !output.isConnected && (
				<label className="connect-output">
					<span className="sr-only">Connect to Device</span>
					<button className="cta btn-connect" type="button" onClick={connectToOutput}>
						Connect
					</button>
				</label>
			)}
			{hasDisconnectMethod && output.isConnected && (
				<label className="disconnect-output">
					<span className="sr-only">Disconnect from Device</span>
					<button
						className="cta btn-disconnect"
						type="button"
						onClick={disconnectFromOutput}
					>
						Disconnect
					</button>
				</label>
			)}

			{/* Injected content from the nodes */}
			<DeviceGui device={output} expanded={isFullscreen} />

			{!isFullscreen && (
				<Handle type="target" position={isVertical ? Position.Top : Position.Left} />
			)}
			{!isFullscreen && (
				<>
					<span className="control-connector-label">Controls</span>
					<Handle
						type="source"
						id={CONTROL_HANDLE}
						position={isVertical ? Position.Bottom : Position.Right}
						className="control-connector"
						aria-label={`${output.name} controls`}
					/>
				</>
			)}
		</div>
	)
}