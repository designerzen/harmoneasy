import { useChain } from "../ChainContext"
import { Handle, Position } from "@xyflow/react"
import React, { useCallback, useEffect, useState } from "react"
import { elementDescription, elementIcon } from "../element-icons"
import { ElementIcon } from "../ElementIcon"
import { NodeHeader } from "../NodeHeader"
import { TransformerDialog } from "../GraphDialogs"
import { MinimiseButton } from "../MinimiseButton"
import { DeviceGui } from "../DeviceGui"
import { CONTROL_HANDLE } from "../control-surfaces"

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
			data-midi-scope={`${chainId}:transformer:${props.data.element.midiControlId}`}
			className={`node-transformer graph-node can-remove category-${props.data.element.category.toLowerCase()} ${isFullscreen ? "is-fullscreen" : ""} ${isCompact ? "is-compact" : ""}`}
		>
			<NodeHeader
				removeLabel="Delete transformer"
				onRemove={removeNode}
				swap={
					<button
						type="button"
						className="device-swap"
						title="Swap transformer"
						aria-label="Swap transformer"
						onClick={() => setSwapping(true)}
					>
						Swap
					</button>
				}
				title={
					<>
						<ElementIcon src={icon} title={description} />
						{props.data.label}
					</>
				}
			>
				{shouldShowMoveButtons && (
					<div className="transformer-move-controls">
						<button
							type="button"
							className="btn-previous nodrag nopan"
							onClick={moveBack}
							title={isVertical ? "Move transformer up" : "Move transformer left"}
							aria-label={
								isVertical ? "Move transformer up" : "Move transformer left"
							}
						>
							<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
								<path
									d={
										isVertical
											? "M12 20V4m-6 6 6-6 6 6"
											: "M20 12H4m6-6-6 6 6 6"
									}
								/>
							</svg>
						</button>
						<button
							type="button"
							className="btn-next nodrag nopan"
							onClick={moveForwards}
							title={isVertical ? "Move transformer down" : "Move transformer right"}
							aria-label={
								isVertical ? "Move transformer down" : "Move transformer right"
							}
						>
							<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
								<path
									d={
										isVertical
											? "M12 4v16m-6-6 6 6 6-6"
											: "M4 12h16m-6-6 6 6-6 6"
									}
								/>
							</svg>
						</button>
					</div>
				)}
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
			</NodeHeader>
			{swapping && (
				<TransformerDialog
					replacing={props.data.element}
					onClose={() => setSwapping(false)}
				/>
			)}
			{isFullscreen ? (
				<header className="expanded-node-heading">
					<div className="expanded-node-emblem">
						<ElementIcon src={icon} title={description} />
					</div>
					<div>
						<span className="expanded-node-category">
							{props.data.element.category} / Transformer
						</span>
						<h2>{props.data.label}</h2>
						<p>{props.data.description}</p>
					</div>
				</header>
			) : (
				<>
					<details>
						<summary className="summary-info" title={props.data.description}>
							Info
						</summary>
						<p>{props.data.description}</p>
					</details>
				</>
			)}

			{typeof props.data.element.status === "string" && (
				<TransformerStatus element={props.data.element} />
			)}

			<DeviceGui device={props.data.element} expanded={isFullscreen} />

			{!isFullscreen && (
				<Handle type="source" position={isVertical ? Position.Bottom : Position.Right} />
			)}
			{!isFullscreen && <><span className="control-connector-label">Controls</span><Handle type="source" id={CONTROL_HANDLE} position={isVertical ? Position.Bottom : Position.Right} style={isVertical ? {left:"80%"}:{top:"80%"}} className="control-connector" aria-label={`${props.data.element.name} controls`} /></>}
			{!isFullscreen && (
				<Handle type="target" position={isVertical ? Position.Top : Position.Left} />
			)}
		</div>
	)
}
