import LZString from "lz-string"
import { validSurfaces } from "control-surface/model"
import type { SurfaceState } from "control-surface/types"
import { deviceDefinition } from "audiobus/io/device-definition"
import type IOChain from "audiobus/io/IO-chain"

export const SURFACE_FRAGMENT_KEY = "surface"
const VERSION = 1

/** Components are referenced by role, never by the sender's random device ids. */
export interface PortableComponent {
	kind: string
	name: string
}
export interface PortableSurface {
	v: typeof VERSION
	components: PortableComponent[]
	/** Surface JSON with each component id replaced by its `@index@` token. */
	surface: string
}

export function componentKind(component: object & { name?: string }): string {
	try {
		const definition = deviceDefinition(component)
		return `${definition.factory}:${definition.type ?? ""}`
	} catch {
		return `transformer:${component.name ?? ""}`
	}
}

const token = (index: number) => `@${index}@`

export function portableSurface(
	state: SurfaceState,
	components: Map<string, PortableComponent>
): PortableSurface {
	const { id: _id, ...shared } = state
	let surface = JSON.stringify(shared)
	const used: PortableComponent[] = []
	for (const [id, component] of components) {
		if (surface.includes(id)) {
			surface = surface.split(id).join(token(used.length))
			used.push(component)
		}
	}
	return { v: VERSION, components: used, surface }
}

/**
 * Bind a shared surface to the recipient's chain: same kind and name first, then same kind.
 * Controls for components the recipient does not have are dropped rather than left dead.
 */
export function resolvePortableSurface(
	portable: PortableSurface,
	components: Map<string, PortableComponent>,
	id: string = crypto.randomUUID()
): { state: SurfaceState; missing: PortableComponent[] } | undefined {
	if (
		!portable ||
		portable.v !== VERSION ||
		typeof portable.surface !== "string" ||
		!Array.isArray(portable.components) ||
		portable.components.length > 256
	) {
		return undefined
	}
	const available = [...components]
	const claimed = new Set<string>()
	const missing: PortableComponent[] = []
	let surface = portable.surface
	portable.components.forEach((wanted, index) => {
		const match =
			available.find(
				([key, c]) =>
					!claimed.has(key) && c.kind === wanted?.kind && c.name === wanted?.name
			) ?? available.find(([key, c]) => !claimed.has(key) && c.kind === wanted?.kind)
		if (match) {
			claimed.add(match[0])
			surface = surface.split(token(index)).join(match[0])
		} else {
			missing.push(wanted)
		}
	})
	let state: SurfaceState
	try {
		state = { ...JSON.parse(surface), id }
	} catch {
		return undefined
	}
	const unresolved = (value: unknown) => typeof value === "string" && /@\d+@/.test(value)
	if (state && Array.isArray(state.connections) && Array.isArray(state.widgets)) {
		state.connections = state.connections.filter((c) => !unresolved(c?.componentId))
		state.widgets = state.widgets.filter(
			(w) =>
				!unresolved(w?.key) && !unresolved(w?.yKey) && !unresolved(w?.visualiser?.sourceId)
		)
		state.panels = state.panels?.filter((panel) => !unresolved(panel))
		if (unresolved(state.background?.sourceId)) {
			state.background = undefined
		}
	}
	return validSurfaces([state]) ? { state, missing } : undefined
}

/** Roles for the chain's control components, keyed by their surface component ids. */
export function portableComponents(
	components: Map<string, object & { name: string }>
): Map<string, PortableComponent> {
	return new Map(
		[...components].map(([id, component]) => [
			id,
			{ kind: componentKind(component), name: component.name }
		])
	)
}

export function surfaceShareURL(
	state: SurfaceState,
	components: Map<string, PortableComponent>,
	location = window.location.href
): string {
	const url = new URL(location)
	const fragment = new URLSearchParams()
	fragment.set(
		SURFACE_FRAGMENT_KEY,
		LZString.compressToEncodedURIComponent(JSON.stringify(portableSurface(state, components)))
	)
	// The fragment never reaches a server, and a surface link carries no workspace state.
	url.search = ""
	url.hash = fragment.toString()
	return url.href
}

export function readSharedSurface(location = window.location.href): PortableSurface | undefined {
	const payload = new URLSearchParams(new URL(location).hash.slice(1)).get(SURFACE_FRAGMENT_KEY)
	if (!payload) {
		return undefined
	}
	try {
		return JSON.parse(LZString.decompressFromEncodedURIComponent(payload) ?? "")
	} catch {
		return undefined
	}
}

/** Add a shared surface to the chain and make it the main surface. */
export function importSharedSurface(
	chain: IOChain,
	portable: PortableSurface,
	components: Map<string, PortableComponent>
): { state: SurfaceState; missing: PortableComponent[] } | undefined {
	const surfaces = chain.options.controlSurfaces ?? []
	const resolved = surfaces.length < 32 && resolvePortableSurface(portable, components)
	if (!resolved) {
		return undefined
	}
	chain.setGraphOptions({
		controlSurfaces: [...surfaces, resolved.state],
		mainSurfaceId: resolved.state.id
	})
	return resolved
}