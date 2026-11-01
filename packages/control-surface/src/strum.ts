import type { ControlValue, StrumOptions } from "./types"

export function strumOptions(options: StrumOptions = {}) {
	const tuning = options.tuning ?? [64, 59, 55, 50, 45, 40]
	const frets = options.frets ?? tuning.map(() => 0)
	const duration = options.duration ?? 800
	if (
		!tuning.length ||
		tuning.length > 12 ||
		!tuning.every((n) => Number.isInteger(n) && n >= 0 && n <= 127) ||
		frets.length !== tuning.length ||
		!frets.every((n) => Number.isInteger(n) && n >= -1 && n <= 36) ||
		!Number.isFinite(duration) ||
		duration < 50 ||
		duration > 10000
	) {
		throw new RangeError("Invalid strum tuning, frets or duration")
	}
	return { tuning, frets, duration }
}

/** One pluck per crossed string, including intermediate strings in a fast swipe. */
export class Strum {
	readonly options: ReturnType<typeof strumOptions>
	readonly contacts = new Map<number, { x: number; y: number; row: number; pressure: number }>()
	readonly triggered: number[]
	revision = 0
	lastTriggered = -Infinity
	private sequence = 0
	constructor(
		options: StrumOptions | undefined,
		private apply: (value: ControlValue, edge: boolean) => void
	) {
		this.options = strumOptions(options)
		this.triggered = this.options.tuning.map(() => -Infinity)
	}
	pluck(row: number, pressure = 1): void {
		if (row < 0 || row >= this.options.tuning.length || this.options.frets[row] < 0) {
			return
		}
		this.lastTriggered = this.triggered[row] = performance.now() / 1000
		this.revision++
		this.apply(
			[
				++this.sequence,
				row,
				Math.min(127, this.options.tuning[row] + this.options.frets[row]),
				Math.max(0.01, Math.min(1, pressure))
			],
			true
		)
	}
	down(id: number, x: number, y: number, pressure: number): void {
		if (this.contacts.has(id) || this.contacts.size >= 16) {
			return
		}
		const row = Math.min(
			this.options.tuning.length - 1,
			Math.floor(y * this.options.tuning.length)
		)
		this.contacts.set(id, { x, y, row, pressure })
		this.pluck(row, pressure)
	}
	move(id: number, x: number, y: number, pressure: number): void {
		const contact = this.contacts.get(id)
		if (!contact) {
			return
		}
		const row = Math.min(
			this.options.tuning.length - 1,
			Math.floor(y * this.options.tuning.length)
		)
		const direction = Math.sign(row - contact.row)
		if (direction) {
			for (
				let crossed = contact.row + direction;
				direction > 0 ? crossed <= row : crossed >= row;
				crossed += direction
			) {
				this.pluck(crossed, pressure)
			}
		}
		Object.assign(contact, { x, y, row, pressure })
		this.revision++
	}
	up(id: number): void {
		if (this.contacts.delete(id)) {
			this.revision++
		}
	}
	release(): void {
		this.contacts.clear()
		this.revision++
		this.apply([], true)
	}
}