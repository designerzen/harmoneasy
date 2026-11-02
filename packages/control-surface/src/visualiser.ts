import type { ControlBinding, SurfaceVisualiser, VisualiserKind, VisualiserSource } from "./types"

export const VISUALISER_KINDS: VisualiserKind[] = [
	"notes",
	"waveform",
	"spectrum",
	"level",
	"history"
]
export function validVisualiser(value: unknown): value is SurfaceVisualiser {
	if (!value || typeof value !== "object") {
		return false
	}
	const item = value as SurfaceVisualiser
	return (
		typeof item.sourceId === "string" &&
		item.sourceId.length > 0 &&
		item.sourceId.length <= 1024 &&
		VISUALISER_KINDS.includes(item.kind) &&
		(item.opacity === undefined ||
			(Number.isFinite(item.opacity) && item.opacity >= 0.05 && item.opacity <= 1))
	)
}
/** Bounded shared CPU snapshot. Only changed samples invalidate the GPU geometry. */
export class VisualiserFrame {
	readonly samples = new Float32Array(128)
	level = 0
	revision = 0
	available = false
	update(data: ReturnType<VisualiserSource["read"]>, kind: VisualiserKind): void {
		let changed = this.available !== !!data
		this.available = !!data
		const level = data && Number.isFinite(data.level) ? Math.max(0, Math.min(1, data.level)) : 0
		changed ||= level !== this.level
		this.level = level
		for (let i = 0; i < this.samples.length; i++) {
			const sample = data?.samples.length
				? data.samples[
						Math.min(
							data.samples.length - 1,
							Math.floor((i * data.samples.length) / this.samples.length)
						)
					]
				: 0
			const value = Number.isFinite(sample)
				? Math.max(kind === "waveform" ? -1 : 0, Math.min(1, sample))
				: 0
			if (this.samples[i] !== Math.fround(value)) {
				changed = true
				this.samples[i] = value
			}
		}
		if (changed) {
			this.revision++
		}
	}
}
/** Parameter histories work with asynchronous engines without overlapping reads or writes. */
export function historySource(binding: ControlBinding): VisualiserSource {
	const samples = new Float32Array(128)
	let level = 0,
		nextRead = 0,
		reading = false,
		available = false
	return {
		id: `control:${binding.key}`,
		sourceId: binding.sourceId ?? binding.sourceLabel,
		label: `${binding.sourceLabel}: ${binding.descriptor.label}`,
		kinds: ["history", "level"],
		read() {
			if (!reading && performance.now() >= nextRead) {
				reading = true
				nextRead = performance.now() + 1000 / 30
				const accept = (value: unknown) => {
					available = typeof value === "number" && Number.isFinite(value)
					if (available) {
						const min = binding.descriptor.min ?? 0,
							max = binding.descriptor.max ?? 1
						level = Math.max(0, Math.min(1, (Number(value) - min) / (max - min || 1)))
						samples.copyWithin(0, 1)
						samples[samples.length - 1] = level
					}
				}
				try {
					const value = binding.read()
					if (value instanceof Promise) {
						void value
							.then(accept, () => {
								available = false
							})
							.finally(() => {
								reading = false
							})
					} else {
						accept(value)
						reading = false
					}
				} catch {
					available = false
					reading = false
				}
			}
			return available ? { samples, level } : undefined
		}
	}
}