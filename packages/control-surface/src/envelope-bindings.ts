import { bindingKey, validateValue } from "./model"
import { ENVELOPE_STAGES } from "./envelope"
import { createEnvelopeControl } from "./widgets"
import type { ControlBinding } from "./types"

const words = (text: string) =>
	text
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
function stageName(binding: ControlBinding) {
	for (const candidate of [binding.descriptor.id, binding.descriptor.label]) {
		const text = words(candidate)
		const matches = [...text.matchAll(/\b(attack|decay|sustain|release)\b/g)]
		if (matches.length !== 1) {
			continue
		}
		const stage = ENVELOPE_STAGES.findIndex((name) => name.toLowerCase() === matches[0][1])
		const prefix = text
			.replace(matches[0][0], "")
			.replace(/\b(time|level|seconds|milliseconds|ms|s|percent)\b/g, "")
			.replace(/\s+/g, " ")
			.trim()
		return { stage, prefix }
	}
}

/** Discover complete, unambiguous ADSR sets on any engine, including legacy GUI
 * bindings. Keep scalar bindings so existing layouts and MIDI mappings still work.
 */
export function withEnvelopeBindings(bindings: ControlBinding[]): ControlBinding[] {
	const groups = new Map<
		string,
		{ members: (ControlBinding | undefined)[]; ambiguous: boolean; name: string }
	>()
	for (const binding of bindings) {
		const d = binding.descriptor
		if (
			!["dial", "slider", "number"].includes(d.widget) ||
			d.choices?.length ||
			d.min === undefined ||
			d.max === undefined ||
			d.min < 0 ||
			d.max <= 0
		) {
			continue
		}
		const match = stageName(binding)
		if (!match) {
			continue
		}
		const key = JSON.stringify([
			binding.sourceId ?? binding.sourceLabel,
			d.group ?? "",
			match.prefix
		])
		const group = groups.get(key) ?? {
			members: [],
			ambiguous: false,
			name: d.group || match.prefix || "Amplitude"
		}
		if (group.members[match.stage]) {
			group.ambiguous = true
		}
		group.members[match.stage] = binding
		groups.set(key, group)
	}
	const envelopes: ControlBinding[] = [],
		members = new Set<ControlBinding>()
	for (const group of groups.values()) {
		if (group.ambiguous || [0, 1, 2, 3].some((i) => !group.members[i])) {
			continue
		}
		const controls = group.members as ControlBinding[]
		// Unknown time units cannot safely be interpreted as seconds.
		if (
			controls.some(
				(b, i) =>
					i !== 2 &&
					b.descriptor.unit &&
					!["s", "sec", "seconds", "ms", "milliseconds"].includes(
						b.descriptor.unit.toLowerCase()
					)
			)
		) {
			continue
		}
		const factors = controls.map((b, i) =>
			i === 2
				? 1 / b.descriptor.max!
				: ["ms", "milliseconds"].includes(b.descriptor.unit?.toLowerCase() ?? "")
					? 0.001
					: 1
		)
		const id = `adsr:${JSON.stringify(controls.map((b) => b.descriptor.id))}`
		const first = controls[0]
		const key = bindingKey(first.sourceId ?? first.sourceLabel, id)
		if (bindings.some((binding) => binding.key === key)) {
			continue
		}
		const name = /envelope/i.test(group.name)
			? group.name
			: `${group.name[0].toUpperCase() + group.name.slice(1)} envelope`
		const descriptor = createEnvelopeControl({
			id,
			label: name,
			group: first.descriptor.group,
			priority: 0.95,
			envelope: {
				attackMax: controls[0].descriptor.max! * factors[0],
				decayMax: controls[1].descriptor.max! * factors[1],
				releaseMax: controls[3].descriptor.max! * factors[3]
			},
			defaultValue: controls.map(
				(b, i) => Number(b.descriptor.defaultValue ?? 0) * factors[i]
			),
			disabled: controls.some((b) => b.descriptor.disabled),
			readOnly: controls.some((b) => b.descriptor.readOnly)
		})
		envelopes.push({
			key,
			sourceId: first.sourceId,
			sourceLabel: first.sourceLabel,
			descriptor,
			async read() {
				const values = await Promise.all(controls.map((b) => b.read()))
				if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) {
					return undefined
				}
				return values.map((value, i) => Number(value) * factors[i])
			},
			async write(value) {
				const values = validateValue(descriptor, value) as number[]
				const next = controls.map((b, i) =>
					validateValue(b.descriptor, values[i] / factors[i])
				)
				await Promise.all(controls.map((b, i) => b.write(next[i])))
			},
			subscribe(listener) {
				const unsubscribers = controls.map((b) => b.subscribe?.(listener))
				return () => unsubscribers.forEach((unsubscribe) => unsubscribe?.())
			}
		})
		controls.forEach((b) => members.add(b))
	}
	return [
		...envelopes,
		...bindings.map((binding) =>
			members.has(binding)
				? { ...binding, descriptor: { ...binding.descriptor, priority: 0 } }
				: binding
		)
	]
}