import {
	EVENT_CONTROL_SURFACE_NOTES,
	EVENT_OUTPUTS_UPDATED,
	OUTPUT_EVENT
} from "audiobus/events/event-constants"
import { NOTE_ON, NOTE_OFF, CONTROL_CHANGE } from "audiobus/commands/commands"
import type IOChain from "audiobus/io/IO-chain"
import type { VisualiserSource } from "control-surface/types"
import { PadLight } from "control-surface"

/** Observe processed notes and direct surface playing without changing audio routing. */
export function surfaceNoteSource(chain: IOChain) {
	const lights = Array.from({ length: 128 }, () => new PadLight()),
		samples = new Float32Array(128)
	const held = new Map<string, { note: number; velocity: number }>(),
		removers: (() => void)[] = []
	const refresh = () => {
		const levels = new Float32Array(128)
		for (const voice of held.values()) {
			levels[voice.note] = Math.max(levels[voice.note], voice.velocity)
		}
		lights.forEach((light, note) => light.set(levels[note]))
	}
	const targets = [chain, chain.outputManager, ...chain.outputs] as Partial<EventTarget>[]
	const subscribe = (target: Partial<EventTarget>, index: number) => {
		if (!target?.addEventListener) {
			return
		}
		const receive = (event: Event) => {
			const data = (event as CustomEvent).detail
			if (data?.reset) {
				for (const key of held.keys()) {
					if (key.startsWith("0:") || key.startsWith("1:")) {
						held.delete(key)
					}
				}
				refresh()
				return
			}
			for (const command of Array.isArray(data) ? data : [data]) {
				if (!command) {
					continue
				}
				const channel = command.channel ?? 0,
					note = command.number,
					key = `${index}:${channel}:${note}`
				if (command.type === CONTROL_CHANGE && [120, 123].includes(note)) {
					for (const id of held.keys()) {
						if (id.startsWith(`${index}:${channel}:`)) {
							held.delete(id)
						}
					}
					continue
				}
				if (!Number.isInteger(note) || note < 0 || note > 127) {
					continue
				}
				if (
					command.type === NOTE_OFF ||
					(command.type === NOTE_ON && command.velocity === 0)
				) {
					held.delete(key)
				} else if (command.type === NOTE_ON) {
					held.set(key, {
						note,
						velocity: Math.max(0, Math.min(1, (command.velocity ?? 127) / 127))
					})
				}
			}
			refresh()
		}
		for (const name of index === 0
			? [EVENT_CONTROL_SURFACE_NOTES, OUTPUT_EVENT]
			: [EVENT_CONTROL_SURFACE_NOTES]) {
			target.addEventListener!(name, receive)
			removers.push(() => target.removeEventListener?.(name, receive))
		}
	}
	targets.forEach(subscribe)
	const syncOutputs = () => {
		for (const output of chain.outputs) {
			if (!targets.includes(output as Partial<EventTarget>)) {
				targets.push(output as Partial<EventTarget>)
				subscribe(output as Partial<EventTarget>, targets.length - 1)
			}
		}
		targets.forEach((target, index) => {
			if (index >= 2 && !chain.outputs.includes(target as (typeof chain.outputs)[number])) {
				for (const key of held.keys()) {
					if (key.startsWith(`${index}:`)) {
						held.delete(key)
					}
				}
			}
		})
		refresh()
	}
	chain.addEventListener(EVENT_OUTPUTS_UPDATED, syncOutputs)
	removers.push(() => chain.removeEventListener(EVENT_OUTPUTS_UPDATED, syncOutputs))
	const source: VisualiserSource = {
		id: "notes:chain",
		label: "Note data",
		kinds: ["notes"],
		read() {
			let level = 0
			const now = performance.now() / 1000
			lights.forEach((light, note) => {
				samples[note] = light.intensity(now)
				level = Math.max(level, samples[note])
			})
			return { samples, level }
		}
	}
	return {
		source,
		destroy() {
			removers.forEach((remove) => remove())
			held.clear()
		}
	}
}