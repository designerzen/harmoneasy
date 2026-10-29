import type { IAudioCommand } from "audiobus/audio-command-interface"
import { CONTROL_CHANGE } from "audiobus/commands"

export interface MidiTarget {
	id: string
	label: string
	kind: "value" | "action"
	apply(value: number): void
}
export interface MidiBinding {
	target: string
	cc: number
	channel: number // 0 means all channels; MIDI channels are 1–16.
	source: string // Empty means any input device.
}
export const DEFAULT_MIDI_BINDINGS: MidiBinding[] = [
	["app:volume", 7],
	["app:tempo", 20],
	["app:btn-metronome", 21],
	["app:btn-transport-start", 22],
	["app:btn-transport-stop", 23],
	["app:btn-transport-reset", 24],
	["app:btn-kill-switch", 123]
].map(([target, cc]) => ({ target: String(target), cc: Number(cc), channel: 16, source: "" }))

export function validBinding(value: unknown): value is MidiBinding {
	const b = value as MidiBinding | null
	return (
		!!b &&
		typeof b.target === "string" &&
		b.target.length > 0 &&
		typeof b.source === "string" &&
		Number.isInteger(b.cc) &&
		b.cc >= 0 &&
		b.cc <= 127 &&
		Number.isInteger(b.channel) &&
		b.channel >= 0 &&
		b.channel <= 16
	)
}

export class MidiControls {
	enabled = true
	learning: string | null = null
	bindings: MidiBinding[]
	private previous = new Map<string, number>()
	constructor(
		private targets: () => MidiTarget[],
		bindings: unknown = DEFAULT_MIDI_BINDINGS,
		private changed: () => void = () => {}
	) {
		this.bindings = Array.isArray(bindings)
			? bindings.filter(validBinding).map((b) => ({ ...b }))
			: []
	}
	assign(binding: MidiBinding): void {
		if (!validBinding(binding)) {
			throw new Error("Choose CC 0–127 and channel 1–16 (or All).")
		}
		this.bindings = this.bindings.filter((b) => b.target !== binding.target)
		this.bindings.push({ ...binding })
		this.previous.clear()
		this.changed()
	}
	remove(target: string): void {
		this.bindings = this.bindings.filter((b) => b.target !== target)
		this.changed()
	}
	handle = (command: IAudioCommand): boolean => {
		if (
			command.type !== CONTROL_CHANGE ||
			!Number.isInteger(command.number) ||
			command.number < 0 ||
			command.number > 127 ||
			!Number.isInteger(command.value) ||
			command.value < 0 ||
			command.value > 127 ||
			!Number.isInteger(command.channel) ||
			command.channel < 1 ||
			command.channel > 16
		) {
			return false
		}
		const key = JSON.stringify([command.from, command.channel, command.number])
		const previous = this.previous.get(key) ?? 0
		this.previous.set(key, command.value)
		if (this.learning) {
			const target = this.learning
			this.learning = null
			this.assign({
				target,
				cc: command.number,
				channel: command.channel,
				source: command.from ?? ""
			})
			// Learning must not fire the newly assigned action until a fresh press.
			this.previous.set(key, command.value)
			return true
		}
		if (!this.enabled) {
			return false
		}
		const matches = this.bindings.filter(
			(b) =>
				b.cc === command.number &&
				(!b.channel || b.channel === command.channel) &&
				(!b.source || b.source === command.from)
		)
		if (!matches.length) {
			return false
		}
		const targets = this.targets()
		for (const binding of matches) {
			const target = targets.find((t) => t.id === binding.target)
			if (target && (target.kind === "value" || (command.value >= 64 && previous < 64))) {
				target.apply(command.value)
			}
		}
		return true
	}
}

export function scaleMidiValue(value: number, min: number, max: number, step = 1): number {
	const scaled = min + ((max - min) * value) / 127
	const rounded = step > 0 ? min + Math.round((scaled - min) / step) * step : scaled
	return Math.max(min, Math.min(max, Number(rounded.toFixed(10))))
}