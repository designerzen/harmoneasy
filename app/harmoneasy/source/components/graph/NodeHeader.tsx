import React, { useEffect, useRef } from "react"
import { createNodeMenu, type NodeMenuAction } from "./node-menu"

export function NodeHeader({
	title,
	removeLabel,
	onRemove,
	onSwap,
	actions = [],
	children,
	enabled,
	description
}: {
	title: React.ReactNode
	removeLabel: string
	onRemove: () => void
	onSwap?: () => void
	actions?: NodeMenuAction[]
	children: React.ReactNode
	enabled?: boolean
	description?: string
}) {
	const menuHost = useRef<HTMLDivElement>(null)
	const menuView = useRef<ReturnType<typeof createNodeMenu> | null>(null)
	const controls = React.Children.toArray(children)
	const controlClass = (child: React.ReactNode) =>
		React.isValidElement<{ className?: string }>(child) ? child.props.className : undefined
	useEffect(() => {
		const menu = createNodeMenu([])
		menuView.current = menu
		menuHost.current?.append(menu.element)
		return () => {
			menu.destroy()
			menuView.current = null
		}
	}, [])
	useEffect(() => {
		menuView.current?.setActions([
			...(onSwap ? [{ label: "Swap", className: "device-swap", run: onSwap }] : []),
			...actions,
			{ label: removeLabel, className: "device-remove", run: onRemove }
		])
	}, [onSwap, onRemove, removeLabel, actions])
	return (
		<header className="device-node-header node-actions" data-enabled={enabled}>
			<div className="device-title-controls nodrag nopan">
				<div className="node-actions-left">
					{controls.filter((child) => controlClass(child) === "device-toggle")}
				</div>
				<div className="node-actions-right">
					{controls.filter(
						(child) =>
							!["device-toggle", "device-expand"].includes(controlClass(child) ?? "")
					)}
					<div ref={menuHost} className="node-menu-host" />
					{controls.filter((child) => controlClass(child) === "device-expand")}
				</div>
			</div>
			{description ? (
				<details className="node-title-details nodrag nopan">
					<summary title="Show device information">
						<h6>{title}</h6>
						<svg className="node-info-icon" viewBox="0 0 24 24" aria-hidden="true">
							<circle cx="12" cy="12" r="9" />
							<path d="M12 11v6" />
							<circle cx="12" cy="7" r="1" fill="currentColor" stroke="none" />
						</svg>
					</summary>
					<p>{description}</p>
				</details>
			) : (
				<h6>{title}</h6>
			)}
		</header>
	)
}