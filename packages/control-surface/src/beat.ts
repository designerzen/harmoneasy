/** A restrained beat envelope; labels remain steady and reduced motion disables the cue. */
export function beatPulse(position: number | undefined, motion = true): number {
	if (!motion || position === undefined || !Number.isFinite(position) || position < 0) {
		return 0
	}
	const phase = position - Math.floor(position)
	return Math.exp(-phase * 12) * 0.3
}