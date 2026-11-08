import type { ControlDescriptor, ControlValue } from "./types"

export const ENVELOPE_STAGES = ["Attack", "Decay", "Sustain", "Release"] as const
export function envelopeMaxima(d: ControlDescriptor): number[] {
	return [d.envelope?.attackMax ?? 4, d.envelope?.decayMax ?? 4, 1, d.envelope?.releaseMax ?? 8]
}
export function validEnvelope(options: ControlDescriptor["envelope"]): boolean {
	return (
		options === undefined ||
		(!!options &&
			typeof options === "object" &&
			[options.attackMax, options.decayMax, options.releaseMax].every(
				(value) => value === undefined || (Number.isFinite(value) && value > 0)
			))
	)
}
/** Envelope vectors contain attack/decay/release seconds and a 0..1 sustain level. */
export function envelopeValues(d: ControlDescriptor, value: ControlValue | undefined): number[] {
	const values = Array.isArray(value) && value.length === 4 ? value : [0.01, 0.2, 0.65, 0.15]
	return envelopeMaxima(d).map((max, index) => {
		const n = Number.isFinite(values[index]) ? values[index] : 0
		return Math.min(max, Math.round(Math.max(0, Math.min(max, n)) * 1e6) / 1e6)
	})
}
export function envelopeGeometry(
	d: ControlDescriptor,
	value: ControlValue | undefined,
	width: number,
	height: number
) {
	const values = envelopeValues(d, value),
		maxima = envelopeMaxima(d)
	const rect = { x: 22, y: 48, width: Math.max(1, width - 44), height: Math.max(1, height - 172) }
	const segment = (index: number) =>
		((40 + 106 * Math.sqrt(values[index] / maxima[index])) / 512) * rect.width
	const a = rect.x + segment(0),
		b = a + segment(1),
		c = b + (72 / 512) * rect.width
	const bottom = rect.y + rect.height,
		level = bottom - values[2] * rect.height
	const points = [
		[rect.x, bottom],
		[a, rect.y],
		[b, level],
		[c, level],
		[c + segment(3), bottom]
	]
	const column = (width - 24) / 4
	const knobs = values.map((_, index) => ({
		x: 12 + column * (index + 0.5),
		y: height - 74,
		radius: Math.min(28, column * 0.32)
	}))
	return { rect, points, values, maxima, knobs }
}
export function moveEnvelope(
	d: ControlDescriptor,
	value: number[],
	axis: number,
	dx: number,
	dy: number,
	width: number,
	height: number
): number[] {
	const { rect, maxima } = envelopeGeometry(d, value, width, height)
	const next = [...value]
	if (axis !== 2) {
		next[axis] =
			maxima[axis] *
			Math.max(0, Math.sqrt(value[axis] / maxima[axis]) + dx / ((106 / 512) * rect.width)) **
				2
	}
	if (axis === 1 || axis === 2) {
		next[2] = value[2] - dy / rect.height
	}
	return envelopeValues(d, next)
}
export function envelopeText(value: number, index: number): string {
	return index === 2
		? `${Math.round(value * 100)}%`
		: value > 0 && value < 0.01
			? `${Number((value * 1000).toFixed(2))} ms`
			: `${value.toFixed(2)} s`
}
/** Cubic decay/release segments share the SVG editor's fast fall and gentle tail. */
export function envelopeCurve(points: number[][]): number[][] {
	const result = [points[0], points[1]]
	for (let stage = 2; stage <= 4; stage++) {
		const a = points[stage - 1],
			b = points[stage]
		if (stage === 3) {
			result.push(b)
			continue
		}
		for (let step = 1; step <= 20; step++) {
			const t = step / 20,
				u = 1 - t,
				dx = b[0] - a[0]
			result.push([
				u * u * u * a[0] +
					3 * u * u * t * (a[0] + dx * 0.18) +
					3 * u * t * t * (a[0] + dx * 0.45) +
					t * t * t * b[0],
				u * u * u * a[1] + (1 - u * u * u) * b[1]
			])
		}
	}
	return result
}