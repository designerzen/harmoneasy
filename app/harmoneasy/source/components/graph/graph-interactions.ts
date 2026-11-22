import { CONTROL_HANDLE, SURFACE_HANDLE } from "./control-surfaces"
import { AUDIO_HANDLE } from "./layout"

export type ConnectionIntent = "controls" | "audio" | "signal"

export interface HandleDescriptor {
	nodeId: string
	handleId: string | null
	handleType: "source" | "target"
}

export interface PendingConnection extends HandleDescriptor {
	nodeLabel: string
	portLabel: string
	intent: ConnectionIntent
}

export interface PendingNodeMove {
	nodeId: string
	positionKey: string
	label: string
	origin: { x: number; y: number }
	width: number
	height: number
}

export interface NormalizedConnection {
	source: string
	target: string
	sourceHandle: string | null
	targetHandle: string | null
}

/** Identify what kind of wire a handle represents for visual storytelling copy. */
export function inferConnectionIntent(handleId: string | null): ConnectionIntent {
	if (handleId === CONTROL_HANDLE || handleId === SURFACE_HANDLE) {
		return "controls"
	}
	if (handleId === AUDIO_HANDLE || handleId === "audio-in") {
		return "audio"
	}
	return "signal"
}

/** Combine an armed handle and a clicked destination handle into a directional connection. */
export function buildConnectionCandidate(
	armed: HandleDescriptor,
	destination: HandleDescriptor
): NormalizedConnection | null {
	if (armed.nodeId === destination.nodeId) {
		return null
	}
	if (armed.handleType === destination.handleType) {
		return null
	}
	if (armed.handleType === "source") {
		return {
			source: armed.nodeId,
			target: destination.nodeId,
			sourceHandle: armed.handleId,
			targetHandle: destination.handleId
		}
	}
	return {
		source: destination.nodeId,
		target: armed.nodeId,
		sourceHandle: destination.handleId,
		targetHandle: armed.handleId
	}
}

/** Stable DOM lookup key for a node handle. */
export function handleKey(handle: HandleDescriptor): string {
	return `${handle.nodeId}::${handle.handleType}::${handle.handleId ?? ""}`
}

/** Human-friendly prompt explaining Step 2 while a wire is picked up. */
export function describeConnectionStory(pending: PendingConnection): string {
	if (pending.intent === "controls") {
		return pending.handleType === "source"
			? `Connecting ${pending.nodeLabel} controls — click a highlighted Control Surface port to plug in, or press Escape to cancel.`
			: `Picking controls for ${pending.nodeLabel} — click a highlighted Controls port on any device, or press Escape to cancel.`
	}
	if (pending.intent === "audio") {
		return pending.handleType === "source"
			? `Routing audio from ${pending.nodeLabel} — click a highlighted effect input port, or press Escape to cancel.`
			: `Routing audio into ${pending.nodeLabel} — click a highlighted audio output port, or press Escape to cancel.`
	}
	return `Connecting ${pending.nodeLabel} — click a highlighted port to plug in, or press Escape to cancel.`
}

/** Compact action badge placed on valid destination ports during 2-click wiring. */
export function describeHandleAction(pending: PendingConnection): string {
	if (pending.intent === "controls") {
		return pending.handleType === "source" ? "Plug controls" : "Connect controls"
	}
	if (pending.intent === "audio") {
		return "Route audio"
	}
	return "Connect here"
}

/** Smooth cubic Bezier path for the floating preview wire between two viewport points. */
export function bezierPreviewPath(
	from: { x: number; y: number },
	to: { x: number; y: number }
): string {
	const dx = to.x - from.x
	const dy = to.y - from.y
	if (Math.abs(dx) >= Math.abs(dy)) {
		const bend = Math.max(40, Math.abs(dx) * 0.45)
		const sign = dx >= 0 ? 1 : -1
		return `M ${from.x} ${from.y} C ${from.x + bend * sign} ${from.y}, ${to.x - bend * sign} ${to.y}, ${to.x} ${to.y}`
	}
	const bend = Math.max(40, Math.abs(dy) * 0.45)
	const sign = dy >= 0 ? 1 : -1
	return `M ${from.x} ${from.y} C ${from.x} ${from.y + bend * sign}, ${to.x} ${to.y - bend * sign}, ${to.x} ${to.y}`
}

/** Nudge a node position with keyboard arrow keys during 2-click node placement. */
export function nudgePosition(
	pos: { x: number; y: number },
	key: string,
	shiftKey: boolean
): { x: number; y: number } | null {
	const step = shiftKey ? 64 : 24
	switch (key) {
		case "ArrowUp":
			return { x: pos.x, y: pos.y - step }
		case "ArrowDown":
			return { x: pos.x, y: pos.y + step }
		case "ArrowLeft":
			return { x: pos.x - step, y: pos.y }
		case "ArrowRight":
			return { x: pos.x + step, y: pos.y }
		default:
			return null
	}
}
