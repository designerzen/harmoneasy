import React from "react"

export function NodeHeader({
	title,
	removeLabel,
	onRemove,
	swap,
	children,
	enabled,
	description
}: {
	title: React.ReactNode
	removeLabel: string
	onRemove: () => void
	swap: React.ReactNode
	children: React.ReactNode
	enabled?: boolean
	description?: string
}) {
	return (
		<header className="device-node-header node-actions" data-enabled={enabled}>
			<div className="device-title-controls nodrag nopan">
				<div className="node-actions-left">
					<button
						type="button"
						className="device-remove"
						title={removeLabel}
						aria-label={removeLabel}
						onClick={onRemove}
					>
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path d="m6 6 12 12M18 6 6 18" />
						</svg>
					</button>
					{swap}
				</div>
				<div className="node-actions-right">{children}</div>
			</div>
			{description ? (
				<details className="node-title-details nodrag nopan">
					<summary>
						<h6>{title}</h6>
					</summary>
					<p>{description}</p>
				</details>
			) : (
				<h6>{title}</h6>
			)}
		</header>
	)
}