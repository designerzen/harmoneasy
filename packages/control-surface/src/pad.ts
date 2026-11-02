/** Matches the app's twelve pitch-class hues (HSL 80% saturation, 40% lightness). */
export function noteColor(note = 60): number[] {
	const hue = (((Math.round(note) % 12) + 12) % 12) / 2
	const x = 0.64 * (1 - Math.abs((hue % 2) - 1))
	const rgb =
		hue < 1
			? [0.64, x, 0]
			: hue < 2
				? [x, 0.64, 0]
				: hue < 3
					? [0, 0.64, x]
					: hue < 4
						? [0, x, 0.64]
						: hue < 5
							? [x, 0, 0.64]
							: [0.64, 0, x]
	return rgb.map((value) => value + 0.08)
}
export class PadLight {
	velocity = 0
	held = false
	releasedAt = -1
	revision = 0
	get duration(): number {
		return 0.12 + this.velocity * 0.68
	}
	set(velocity: number, now = performance.now() / 1000): void {
		const next = Math.max(0, Math.min(1, velocity))
		if (next > 0) {
			if (!this.held || next !== this.velocity) {
				this.revision++
			}
			this.velocity = next
			this.held = true
			this.releasedAt = -1
		} else if (this.held) {
			this.held = false
			this.releasedAt = now
			this.revision++
		}
	}
	intensity(now: number, motion = true): number {
		if (this.held) {
			return this.velocity
		}
		if (!motion || this.releasedAt < 0) {
			return 0
		}
		return this.velocity * Math.max(0, 1 - (now - this.releasedAt) / this.duration) ** 2
	}
}