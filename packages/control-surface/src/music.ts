import type { ControlDescriptor, ControlValue, MusicGridOptions } from "./types"

export const isMusicGrid = (widget: string) => widget === "guitar-tab" || widget === "piano-roll"
export function musicOptions(widget: string, options: MusicGridOptions = {}) {
	const steps = options.steps ?? 8
	const pitches =
		widget === "guitar-tab"
			? (options.tuning ?? [64, 59, 55, 50, 45, 40])
			: (options.notes ?? Array.from({ length: 12 }, (_, i) => 71 - i))
	const frets = options.frets ?? 24
	if (
		!Number.isInteger(steps) ||
		steps < 1 ||
		steps > 32 ||
		!pitches.length ||
		pitches.length > 24 ||
		!pitches.every((pitch) => Number.isInteger(pitch) && pitch >= 0 && pitch <= 127) ||
		!Number.isInteger(frets) ||
		frets < 1 ||
		frets > 36
	) {
		throw new RangeError("Invalid musical grid dimensions, MIDI pitches or fret count")
	}
	return { steps, pitches, frets }
}
export function musicValues(d: ControlDescriptor, value?: ControlValue): number[] {
	const { steps, pitches, frets } = musicOptions(d.widget, d.music)
	const tab = d.widget === "guitar-tab"
	return Array.from({ length: steps * pitches.length }, (_, i) => {
		const n = Array.isArray(value) ? value[i] : undefined
		return typeof n === "number" && Number.isFinite(n)
			? tab
				? Math.max(-1, Math.min(frets, Math.round(n)))
				: Math.max(0, Math.min(1, n))
			: tab
				? -1
				: 0
	})
}
export function noteName(pitch: number): string {
	return `${["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][pitch % 12]}${Math.floor(pitch / 12) - 1}`
}
/** Shared geometry keeps GPU cells, native hit targets and XR rays aligned. */
export function musicRect(width: number, height: number) {
	return { x: 38, y: 32, width: Math.max(1, width - 50), height: Math.max(1, height - 46) }
}