import { DeviceGui } from "../DeviceGui"
import { deviceDescription } from "../element-icons"
import { DeviceTitleBar } from "../DeviceTitleBar"
import { EVENT_CONFIGURATION_CHANGED } from "audiobus/events/event-constants"
import { deviceId } from "audiobus/io/device-definition"
import { useChain } from "../ChainContext"
import { Handle, Position } from "@xyflow/react"
import React, { useCallback } from "react"
import { CONTROL_HANDLE } from "../control-surfaces"
import { hasAudibleOutput } from "../audio-levels"
import { AUDIO_HANDLE } from "../layout"
import { announceLive } from "../../../libs/dialog-utils"

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
			announceLive(`${output.name} connected.`)
		} catch (error) {
			console.error(error)
			announceLive(
				`Could not connect ${output.name}: ${error instanceof Error ? error.message : String(error)}`,
				"assertive"
			)
		}
	}, [output, chain])

	const disconnectFromOutput = useCallback(async () => {
		try {
			await output.disconnect?.()
			chain.dispatchEvent(new Event(EVENT_CONFIGURATION_CHANGED))
			announceLive(`${output.name} disconnected.`)
		} catch (error) {
			console.error(error)
			announceLive(
				`Could not disconnect ${output.name}: ${error instanceof Error ? error.message : String(error)}`,
				"assertive"
			)
		}
	}, [output, chain])

	const isVertical = props.data?.layoutMode === "vertical"
	const isFullscreen = props.data?.isFullscreen || false
	const isCompact = Boolean(props.data?.isCompact) && !isFullscreen
	const isMoving = Boolean(props.data?.isMoving) && !isFullscreen
	const onFullscreen = props.data?.onFullscreen
	const onMoveNode = props.data?.onMoveNode

	const handleFullscreen = useCallback(() => {
		if (onFullscreen) {
			onFullscreen(props.id)
		}
	}, [props.id, onFullscreen])

	return (
		<div
			data-midi-scope={`${chainId}:output:${deviceId(output)}`}
			className={`node-output graph-node can-remove ${output.audioInput ? "is-effect" : ""} ${hasControls ? "has-controls" : "no-controls"} ${isFullscreen ? "is-fullscreen" : ""} ${isCompact ? "is-compact" : ""} ${isMoving ? "is-moving-node" : ""}`}
			title={deviceDescription(output, "output")}
		>
			<DeviceTitleBar
				device={output}
				direction="output"
				expanded={isFullscreen}
				compact={isCompact}
				isMoving={isMoving}
				onMove={onMoveNode ? () => onMoveNode(props.id) : undefined}
				onMinimise={() => props.data.onMinimise?.(props.id)}
				onExpand={handleFullscreen}
				onRemove={removeNode}
			/>
			{(ioManager.devices.find((entry) => entry.device === output)?.chains.size ?? 0) > 1 && (
				<small>Shared device</small>
			)}
			<p className="sr-only">{props.data.label}</p>
			{hasConnectMethod && !output.isConnected && (
				<div className="connect-output">
					<button
						className="cta btn-connect"
						type="button"
						onClick={connectToOutput}
						aria-label={`Connect ${output.name}`}
					>
						Connect
					</button>
				</div>
			)}
			{hasDisconnectMethod && output.isConnected && (
				<div className="disconnect-output">
					<button
						className="cta btn-disconnect"
						type="button"
						onClick={disconnectFromOutput}
						aria-label={`Disconnect ${output.name}`}
					>
						Disconnect
					</button>
				</div>
			)}

			{/* Injected content from the nodes */}
			<DeviceGui device={output} expanded={isFullscreen} />

			{!isFullscreen && (
				<Handle
					type="target"
					id={output.audioInput ? "audio-in" : undefined}
					position={isVertical ? Position.Top : Position.Left}
					tabIndex={0}
					role="button"
					aria-label={output.audioInput ? `${output.name} audio in` : `${output.name} input`}
				/>
			)}
			{!isFullscreen && (
				<Handle
					type="source"
					id={AUDIO_HANDLE}
					position={isVertical ? Position.Bottom : Position.Right}
					isConnectable={true}
					// Always mounted so the speaker edge finds it if an engine gains audio later.
					style={{ visibility: hasAudibleOutput(output) ? undefined : "hidden" }}
					tabIndex={hasAudibleOutput(output) ? 0 : -1}
					role="button"
					aria-label={`${output.name} audio out`}
				/>
			)}
			{!isFullscreen && (
				<>
					<span
						className={`control-connector-label ${isVertical ? "" : "control-connector-label-bottom"}`}
					>
						Controls
					</span>
					<Handle
						type="source"
						id={CONTROL_HANDLE}
						position={isVertical ? Position.Right : Position.Bottom}
						style={isVertical ? { top: "80%" } : { left: "80%" }}
						className="control-connector"
						tabIndex={0}
						role="button"
						aria-label={`${output.name} controls`}
					/>
				</>
			)}
		</div>
	)
}