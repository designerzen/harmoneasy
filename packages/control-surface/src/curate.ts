import { controlWords } from "./icons"
import type { ControlBinding, ControlDescriptor } from "./types"

const PERFORMANCE = ["relative-keys", "strum", "piano-roll", "guitar-tab"]
const EXPRESSIVE =
	/\b(volume|gain|level|cutoff|filter|resonance|tempo|bpm|mix|wet|drive|pan|octave|transpose|play|stop|record|mute|wave(form)?|attack|release|scale|key|chord|preset|random|swing|density|intensity|spread)\b/
const PLUMBING =
	/\b(channel|port|device|midi|url|file|path|name|id|address|host|api|token|seed|debug|latency|buffer|sample ?rate|polyphony|operating mode|routing)\b/

/** 0..1 interest for live performance. Author priority wins; heuristics rank everything else. */
export function controlImportance(d: ControlDescriptor, index = 0): number {
	if (d.hidden || d.disabled) {
		return 0
	}
	if (d.priority !== undefined) {
		return Math.max(0, Math.min(1, d.priority))
	}
	const text = controlWords(d)
	let score =
		{
			"relative-keys": 0.8,
			strum: 0.72,
			pad: 0.7,
			xy: 0.68,
			dial: 0.55,
			slider: 0.55,
			radio: 0.52,
			toggle: 0.5,
			button: 0.48,
			select: 0.42,
			range: 0.45,
			rotation: 0.45,
			"piano-roll": 0.5,
			"guitar-tab": 0.4,
			meter: 0.3,
			display: 0.2,
			number: 0.35,
			visualiser: 0.3,
			text: 0.05,
			color: 0.05
		}[d.widget] ?? 0.3
	if (EXPRESSIVE.test(text)) {
		score += 0.25
	}
	if (PLUMBING.test(text)) {
		score -= 0.35
	}
	if (d.readOnly) {
		score -= 0.15
	}
	// Authors tend to list their headline controls first.
	return Math.max(0, Math.min(1, score - Math.min(0.15, index * 0.01)))
}

/**
 * Pick the most playable controls across every component: one large performance gadget
 * so the surface is instantly playable, then a fair share of parameters per source.
 */
export function featuredBindings(bindings: ControlBinding[], limit = 12): ControlBinding[] {
	const sources = new Map<string, { binding: ControlBinding; score: number }[]>()
	const performance: { binding: ControlBinding; score: number }[] = []
	for (const binding of bindings) {
		if (PERFORMANCE.includes(binding.descriptor.widget)) {
			performance.push({ binding, score: controlImportance(binding.descriptor) })
			continue
		}
		const id = binding.sourceId ?? binding.sourceLabel
		const ranked = sources.get(id) ?? []
		ranked.push({ binding, score: controlImportance(binding.descriptor, ranked.length) })
		sources.set(id, ranked)
	}
	const gadget = performance
		.filter((item) => item.score >= 0.3)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit >= 4 ? 1 : 0)
	const remaining = limit - gadget.length
	const share = Math.max(2, Math.ceil(remaining / Math.max(1, sources.size)))
	// Each source's fair share goes first; spare places go to the best of the rest.
	const parameters = [...sources.values()]
		.flatMap((ranked) =>
			ranked
				.filter((item) => item.score >= 0.3)
				.sort((a, b) => b.score - a.score)
				.map((item, rank) => ({ ...item, spare: rank >= share }))
		)
		.sort((a, b) => Number(a.spare) - Number(b.spare) || b.score - a.score)
		.slice(0, Math.max(0, remaining))
	// Author order keeps related controls together; packing places the large gadget.
	return [...gadget, ...parameters]
		.sort((a, b) => bindings.indexOf(a.binding) - bindings.indexOf(b.binding))
		.map(({ binding }) => binding)
}