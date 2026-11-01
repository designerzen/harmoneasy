export interface SourceTheme {
	accent: number[]
	pattern: number
	cssAccent: string
}

/** Stable across surfaces, reordering, renaming and reloads when given a component ID. */
export function sourceTheme(sourceId: string): SourceTheme {
	let hash = 2166136261
	for (let i = 0; i < sourceId.length; i++) {
		hash = Math.imul(hash ^ sourceId.charCodeAt(i), 16777619) >>> 0
	}
	// Avalanche nearby IDs before selecting well-separated hue families.
	hash ^= hash >>> 16
	hash = Math.imul(hash, 0x85ebca6b)
	hash ^= hash >>> 13
	hash = Math.imul(hash, 0xc2b2ae35)
	hash = (hash ^ (hash >>> 16)) >>> 0
	const hue = (hash % 12) / 2
	const x = 1 - Math.abs((hue % 2) - 1)
	const rgb = [
		[1, x, 0],
		[x, 1, 0],
		[0, 1, x],
		[0, x, 1],
		[x, 0, 1],
		[1, 0, x]
	][Math.floor(hue)]
	const accent = rgb.map((channel) => 0.24 + channel * 0.76)
	return {
		accent,
		pattern: Math.floor(hash / 360) % 3,
		cssAccent: `rgb(${accent.map((channel) => Math.round(channel * 255)).join(" ")})`
	}
}