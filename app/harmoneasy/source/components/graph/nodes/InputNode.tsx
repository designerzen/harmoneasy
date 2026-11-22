import { DeviceGui } from "../DeviceGui"
import { deviceDescription } from "../element-icons"
import { DeviceTitleBar } from "../DeviceTitleBar"
import { EVENT_CONFIGURATION_CHANGED } from "audiobus/events/event-constants"
import { deviceId } from "audiobus/io/device-definition"
import { useChain } from "../ChainContext"
import { Handle, Position } from "@xyflow/react"
import React, { useCallback } from "react"
import { CONTROL_HANDLE } from "../control-surfaces"
import { announceLive } from "../../../libs/dialog-utils"

import type AbstractInput from "audiobus/io/inputs/abstract-input"
import type { IAudioInput } from "audiobus/io/inputs/input-interface"

export function InputNode(props: any) {
	const { chain, chainId, manager: ioManager } = useChain()
	const input: AbstractInput & IAudioInput = props.data?.input
	const hasConnectMethod =
		input.requiresConnectionControl !== false && typeof input.connect === "function"
	const hasDisconnectMethod =
		input.requiresConnectionControl !== false && typeof input.disconnect === "function"
	const hasControls = hasConnectMethod || hasDisconnectMethod

	const removeNode = useCallback(() => {
		chain.removeInput(input)
	}, [input, chain])

	const connectToInput = useCallback(async () => {
		try {
			await input.connect?.()
			chain.dispatchEvent(new Event(EVENT_CONFIGURATION_CHANGED))
			announceLive(`${input.name} connected.`)
		} catch (error) {
			console.error(error)
			announceLive(
				`Could not connect ${input.name}: ${error instanceof Error ? error.message : String(error)}`,
				"assertive"
			)
		}
	}, [input, chain])

	const disconnectFromInput = useCallback(async () => {
		try {
			await input.disconnect?.()
			chain.dispatchEvent(new Event(EVENT_CONFIGURATION_CHANGED))
			announceLive(`${input.name} disconnected.`)
		} catch (error) {
			console.error(error)
			announceLive(
				`Could not disconnect ${input.name}: ${error instanceof Error ? error.message : String(error)}`,
				"assertive"
			)
		}
	}, [input, chain])

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
			data-midi-scope={`${chainId}:input:${deviceId(input)}`}
			className={`node-input graph-node can-remove ${hasControls ? "has-controls" : "no-controls"} ${isFullscreen ? "is-fullscreen" : ""} ${isCompact ? "is-compact" : ""} ${isMoving ? "is-moving-node" : ""}`}
			title={deviceDescription(input, "input")}
		>
			<DeviceTitleBar
				device={input}
				direction="input"
				expanded={isFullscreen}
				compact={isCompact}
				isMoving={isMoving}
				onMove={onMoveNode ? () => onMoveNode(props.id) : undefined}
				onMinimise={() => props.data.onMinimise?.(props.id)}
				onExpand={handleFullscreen}
				onRemove={removeNode}
			/>
			{(ioManager.devices.find((entry) => entry.device === input)?.chains.size ?? 0) > 1 && (
				<small>Shared device</small>
			)}
			<p className="sr-only">{props.data.label}</p>
			{hasConnectMethod && !input.isConnected && (
				<div className="connect-input">
					<button
						className="cta btn-connect"
						type="button"
						onClick={connectToInput}
						aria-label={`Connect ${input.name}`}
					>
						Connect
					</button>
				</div>
			)}
			{hasDisconnectMethod && input.isConnected && (
				<div className="disconnect-input">
					<button
						className="cta btn-disconnect"
						type="button"
						onClick={disconnectFromInput}
						aria-label={`Disconnect ${input.name}`}
					>
						Disconnect
					</button>
				</div>
			)}

			{/* Injected content from the nodes */}
			<DeviceGui device={input} expanded={isFullscreen} />

			{!isFullscreen && (
				<Handle
					type="source"
					position={isVertical ? Position.Bottom : Position.Right}
					tabIndex={0}
					role="button"
					aria-label={`${input.name} output`}
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
						aria-label={`${input.name} controls`}
					/>
				</>
			)}
		</div>
	)
}