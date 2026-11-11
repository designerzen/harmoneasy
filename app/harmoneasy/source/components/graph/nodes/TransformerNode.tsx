import { useChain } from "../ChainContext"
import { Handle, Position } from "@xyflow/react"
import React, { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import { EVENT_CONFIGURATION_CHANGED } from "audiobus/events/event-constants"
import { elementDescription, elementIcon } from "../element-icons"
import { ElementIcon } from "../ElementIcon"
import { NodeHeader } from "../NodeHeader"
import { TransformerDialog } from "../GraphDialogs"
import { MinimiseButton } from "../MinimiseButton"
import { DeviceGui } from "../DeviceGui"
import { CONTROL_HANDLE } from "../control-surfaces"
import { transformerActions } from "../transformer-actions"

function TransformerStatus({ element }: { element: { status: string; statusState?: string } }) {
	const readStatus = () => ({ text: element.status, state: element.statusState ?? "idle" })
	const [status, setStatus] = useState(readStatus)
	useEffect(() => {
		const interval = setInterval(
			() =>
				setStatus((previous) => {
					const next = readStatus()
					return next.text === previous.text && next.state === previous.state
						? previous
						: next
				}),
			500
		)
		return () => clearInterval(interval)
	}, [element])
	return (
		<div role="status" className="transformer-status" data-state={status.state}>
			<span className="transformer-status-dot" aria-hidden="true" />
			<p>
				{status.state === "disabled"
					? "Accompaniment is off. Your notes still pass through."
					: status.text}
			</p>
		</div>
	)
}

/**
 * TransformerNode component
 * Uses useCallback for event handlers to maintain referential equality
 * @param props - The props for the TransformerNode component
 */
export function TransformerNode(props: any) {
	const { chain, chainId } = useChain()
	const [swapping, setSwapping] = useState(false)
	const element = props.data.element
	const name = element.options.displayName || props.data.label
	const color = element.options.displayColor
	const customColor = /^#[0-9a-f]{6}$/i.test(color ?? "")
	const enabled = useSyncExternalStore(
		useCallback((callback) => element.subscribeControls(callback), [element]),
		() => Boolean(element.options.enabled)
	)
	const toggle = () => {
		const value = typeof element.options.enabled === "boolean" ? !enabled : Number(!enabled)
		element.setConfig("enabled", value)
		chain.dispatchEvent(new Event(EVENT_CONFIGURATION_CHANGED))
	}
	const icon = elementIcon("transformer", props.data.element.type ?? props.data.element.id)
	const description = elementDescription(
		"transformer",
		props.data.element.type ?? props.data.element.id,
		props.data.label,
		props.data.description
	)

	const removeNode = useCallback(() => {
		chain.transformerManager.removeTransformer(props.data.element)
	}, [props.data.element])

	const moveBack = useCallback(() => {
		chain.transformerManager.moveOneStepBefore(props.data.element)
	}, [props.data.element])

	const moveForwards = useCallback(() => {
		chain.transformerManager.moveOneStepAfter(props.data.element)
	}, [props.data.element])

	const shouldShowMoveButtons = chain.transformerQuantity > 1

	const isVertical = props.data.layoutMode === "vertical"
	const isFullscreen = props.data.isFullscreen || false
	const isCompact = Boolean(props.data.isCompact) && !isFullscreen
	const onFullscreen = props.data.onFullscreen

	const handleFullscreen = useCallback(() => {
		if (onFullscreen) {
			onFullscreen(props.id)
		}
	}, [props.id, onFullscreen])

	return (
		<div
			title={description}
			data-layout={isVertical ? "vertical" : "horizontal"}
			style={customColor ? ({ "--node-accent": color } as React.CSSProperties) : undefined}
			data-midi-scope={`${chainId}:transformer:${props.data.element.midiControlId}`}
			className={`node-transformer graph-node can-remove category-${props.data.element.category.toLowerCase()} ${isFullscreen ? "is-fullscreen" : ""} ${isCompact ? "is-compact" : ""}`}
		>
			<NodeHeader
				enabled={enabled}
				actions={transformerActions(chain, element)}
				description={props.data.description || description}
				removeLabel="Delete transformer"
				onRemove={removeNode}
				onSwap={() => setSwapping(true)}
				title={
					<>
						<ElementIcon src={icon} title={description} />
						{name}
					</>
				}
			>
				<MinimiseButton
					compact={isCompact}
					direction="transformer"
					onClick={() => props.data.onMinimise?.(props.id)}
				/>
				<button
					type="button"
					className="device-expand"
					onClick={handleFullscreen}
					autoFocus={isFullscreen}
					aria-expanded={isFullscreen}
					title={isFullscreen ? "Exit fullscreen transformer" : "Expand transformer"}
					aria-label={isFullscreen ? "Exit fullscreen transformer" : "Expand transformer"}
				>
					<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
						<path
							d={
								isFullscreen
									? "M3 9h6V3m6 0v6h6M3 15h6v6m6 0v-6h6"
									: "M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6"
							}
						/>
					</svg>
				</button>
				<button
					type="button"
					className="device-toggle"
					aria-pressed={enabled}
					onClick={toggle}
					title={`${enabled ? "Disable" : "Enable"} transformer in this chain`}
					aria-label={`${enabled ? "Disable" : "Enable"} transformer`}
				>
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<path d="M12 3v9m-5-7a8 8 0 1 0 10 0" />
					</svg>
					<span>{enabled ? "On" : "Off"}</span>
				</button>
			</NodeHeader>
			{swapping && (
				<TransformerDialog
					replacing={props.data.element}
					onClose={() => setSwapping(false)}
				/>
			)}

			{typeof props.data.element.status === "string" && (
				<TransformerStatus element={props.data.element} />
			)}

			<DeviceGui device={props.data.element} expanded={isFullscreen} />

			{shouldShowMoveButtons && !isFullscreen && (
				<div
					className={`transformer-move-controls ${isVertical ? "is-vertical" : "is-horizontal"}`}
				>
					<button
						type="button"
						className="btn-previous nodrag nopan"
						onClick={moveBack}
						title={isVertical ? "Move transformer up" : "Move transformer left"}
						aria-label={isVertical ? "Move transformer up" : "Move transformer left"}
					>
						<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
							<path
								d={isVertical ? "M12 20V4m-6 6 6-6 6 6" : "M20 12H4m6-6-6 6 6 6"}
							/>
						</svg>
					</button>
					<button
						type="button"
						className="btn-next nodrag nopan"
						onClick={moveForwards}
						title={isVertical ? "Move transformer down" : "Move transformer right"}
						aria-label={isVertical ? "Move transformer down" : "Move transformer right"}
					>
						<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
							<path
								d={isVertical ? "M12 4v16m-6-6 6 6 6-6" : "M4 12h16m-6-6 6 6-6 6"}
							/>
						</svg>
					</button>
				</div>
			)}

			{!isFullscreen && (
				<Handle type="source" position={isVertical ? Position.Bottom : Position.Right} />
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
						aria-label={`${props.data.element.name} controls`}
					/>
				</>
			)}
			{!isFullscreen && (
				<Handle type="target" position={isVertical ? Position.Top : Position.Left} />
			)}
		</div>
	)
}