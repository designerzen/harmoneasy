import React from "react"

export function MinimiseButton({
	compact,
	direction,
	onClick
}: {
	compact: boolean
	direction: "input" | "output" | "transformer"
	onClick: () => void
}) {
	const label = `${compact ? "Restore" : "Minimise"} ${direction}`
	return (
		<button
			type="button"
			className="device-minimise nodrag nopan"
			onClick={onClick}
			aria-expanded={!compact}
			title={label}
			aria-label={label}
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path d={compact ? "M5 5h14v14H5zM5 9h14" : "M5 12h14"} />
			</svg>
		</button>
	)
}