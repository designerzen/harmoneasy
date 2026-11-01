import type { ControlValue, RelativeKeysOptions } from "./types"

export interface RelativeContact {
	id: number
	note: number
	pressure: number
	x: number
	y: number
	column: number
	row: number
	triggered: number
}
export function relativeOptions(options: RelativeKeysOptions = {}): Required<RelativeKeysOptions> {
	const result = {
		rootNote: 60,
		horizontalInterval: 1,
		verticalInterval: 5,
		keySize: 55,
		...options
	}
	if (
		!Number.isInteger(result.rootNote) ||
		result.rootNote < 0 ||
		result.rootNote > 127 ||
		![result.horizontalInterval, result.verticalInterval].every(
			(n) => Number.isInteger(n) && Math.abs(n) <= 24
		) ||
		!Number.isFinite(result.keySize) ||
		result.keySize < 24 ||
		result.keySize > 128
	) {
		throw new RangeError("Invalid relative key options")
	}
	return result
}

/** Binding value: [] when released, otherwise [anchorX, anchorY, ...[id, MIDI note, pressure, x, y]]. Positions are normalized. */
export class RelativeKeys {
	readonly contacts = new Map<number, RelativeContact>()
	anchor = { x: 0.5, y: 0.5 }
	minimumKeySize = 55
	get keySize(): number {
		return Math.max(this.minimumKeySize, this.options.keySize)
	}
	width = 240
	height = 240
	readonly options: Required<RelativeKeysOptions>
	constructor(
		options: RelativeKeysOptions | undefined,
		private apply: (value: ControlValue, edge: boolean) => void
	) {
		this.options = relativeOptions(options)
	}
	down(id: number, x: number, y: number, pressure: number): void {
		if (this.contacts.has(id) || this.contacts.size >= 16) {
			return
		}
		if (!this.contacts.size) {
			this.anchor = { x, y }
		}
		this.contacts.set(id, {
			id,
			x,
			y,
			pressure,
			note: this.options.rootNote,
			column: 0,
			row: 0,
			triggered: 0
		})
		this.move(id, x, y, pressure, true)
	}
	keyboardDown(id: number, note: number): void {
		if (this.contacts.has(id) || this.contacts.size >= 16) {
			return
		}
		if (!this.contacts.size) {
			this.anchor = { x: 0.5, y: 0.5 }
		}
		this.contacts.set(id, {
			id,
			note,
			x: Math.max(0, Math.min(1, this.anchor.x + (note - this.options.rootNote) * 0.04)),
			y: this.anchor.y,
			pressure: 1,
			column: note - this.options.rootNote,
			row: 0,
			triggered: performance.now() / 1000
		})
		this.publish(true)
	}
	move(id: number, x: number, y: number, pressure: number, first = false): void {
		const contact = this.contacts.get(id)
		if (!contact) {
			return
		}
		const dx = ((x - this.anchor.x) * this.width) / this.keySize
		const dy = ((this.anchor.y - y) * this.height) / this.keySize
		if (first || Math.abs(dx - contact.column) > 0.6) {
			contact.column = Math.round(dx)
		}
		if (first || Math.abs(dy - contact.row) > 0.6) {
			contact.row = Math.round(dy)
		}
		const note = Math.max(
			0,
			Math.min(
				127,
				this.options.rootNote +
					contact.column * this.options.horizontalInterval +
					contact.row * this.options.verticalInterval
			)
		)
		const edge = first || note !== contact.note
		Object.assign(contact, { x, y, note, pressure: Math.max(0.01, Math.min(1, pressure)) })
		if (edge) {
			contact.triggered = performance.now() / 1000
		}
		this.publish(edge)
	}
	up(id: number): void {
		if (this.contacts.delete(id)) {
			this.publish(true)
		}
	}
	release(): void {
		if (this.contacts.size) {
			this.contacts.clear()
			this.publish(true)
		}
	}
	private publish(edge: boolean): void {
		this.apply(
			this.contacts.size
				? [
						this.anchor.x,
						this.anchor.y,
						...Array.from(this.contacts.values()).flatMap((c) => [
							c.id,
							c.note,
							c.pressure,
							c.x,
							c.y
						])
					]
				: [],
			edge
		)
	}
}

export function relativeRect(width: number, height: number) {
	return { x: 12, y: 32, width: Math.max(1, width - 24), height: Math.max(1, height - 44) }
}