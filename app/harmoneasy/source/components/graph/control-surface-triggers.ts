import { CONTROL_CHANGE, NOTE_OFF, NOTE_ON } from "audiobus/commands/commands"
import { EVENT_ABORT, EVENT_BLUR, EVENT_KEY_DOWN, EVENT_KEY_UP } from "audiobus/events/event-constants"
import type { IAudioCommand } from "audiobus/commands/audio-command-interface"
import { componentBindings } from "audiobus/io/component-ui"
import type IOChain from "audiobus/io/IO-chain"
import type IOChainManager from "audiobus/io/IO-chain-manager"
import { TRIGGER_WIDGETS, denormalize, triggerKey } from "control-surface/model"
import type { SurfaceTrigger } from "control-surface/types"
import { controlComponents } from "./control-surfaces"

interface TriggerView {
	trigger(key: string, pressed: boolean): boolean
}
interface Match {
	chain: IOChain
	surfaceId: string
	key: string
}
type Input = Required<Pick<SurfaceTrigger, "key">> | Required<Pick<SurfaceTrigger, "midi">>

const views = new Map<string, Set<TriggerView>>()
let learner: ((trigger: SurfaceTrigger) => void) | undefined

/** Mounted surfaces play their own gadgets, so hardware gets the same flash and pressed states. */
export function registerTriggerView(surfaceId: string, view: TriggerView): () => void {
	const set = views.get(surfaceId) ?? new Set()
	views.set(surfaceId, set.add(view))
	return () => {
		set.delete(view)
		if (!set.size) {
			views.delete(surfaceId)
		}
	}
}

/** The next key press or MIDI note/CC press is captured instead of playing anything. */
export function learnSurfaceTrigger(signal: AbortSignal): Promise<SurfaceTrigger> {
	return new Promise((resolve, reject) => {
		const done = (trigger: SurfaceTrigger) => {
			learner = undefined
			resolve(trigger)
		}
		learner = done
		signal.addEventListener(
			EVENT_ABORT,
			() => {
				if (learner === done) {
					learner = undefined
				}
				reject(signal.reason)
			},
			{ once: true }
		)
	})
}

export function triggerMatches(trigger: SurfaceTrigger | undefined, input: Input): boolean {
	if (!trigger) {
		return false
	}
	if ("key" in input) {
		return trigger.key === input.key
	}
	const midi = trigger.midi
	return (
		!!midi &&
		midi.type === input.midi.type &&
		midi.number === input.midi.number &&
		(!midi.channel || midi.channel === input.midi.channel)
	)
}

function findMatches(manager: IOChainManager, input: Input): Match[] {
	const matches: Match[] = []
	for (const [, chain] of manager.entries) {
		for (const surface of chain.options.controlSurfaces ?? []) {
			for (const widget of surface.widgets) {
				if (!widget.yKey && triggerMatches(widget.trigger, input)) {
					matches.push({ chain, surfaceId: surface.id, key: widget.key })
				}
			}
		}
	}
	return matches
}

/** Without a visible surface, write straight to the component control. */
async function writeDirect({ chain, surfaceId, key }: Match, pressed: boolean): Promise<void> {
	const surface = chain.options.controlSurfaces?.find((s) => s.id === surfaceId)
	const [componentId] = JSON.parse(key) as [string, string]
	const component = controlComponents(chain).get(componentId)
	if (!surface || !component) {
		return
	}
	const binding = (await componentBindings(component, componentId)).find((b) => b.key === key)
	const widget = surface.widgets.find((w) => w.key === key)?.widget ?? binding?.descriptor.widget
	if (!binding || !widget || !TRIGGER_WIDGETS.includes(widget)) {
		return
	}
	const d = binding.descriptor
	if (widget === "pad") {
		await binding.write(denormalize(d, pressed ? 1 : 0))
	} else if (pressed) {
		await binding.write(widget === "button" ? (d.defaultValue ?? 1) : !(await binding.read()))
	}
}

function fire(matches: Match[], pressed: boolean): void {
	for (const match of matches) {
		const played = [...(views.get(match.surfaceId) ?? [])].some((view) =>
			view.trigger(match.key, pressed)
		)
		if (!played) {
			void writeDirect(match, pressed).catch((error) =>
				console.warn("Surface trigger failed", error)
			)
		}
	}
}

function typing(): boolean {
	const target = document.activeElement
	return (
		!!document.querySelector("dialog[open]") ||
		!!target?.closest(
			"textarea, select, [contenteditable]:not([contenteditable='false']), input:not([type='range'], [type='checkbox'], [type='radio'], [type='button'], [type='color'])"
		)
	)
}

/**
 * Keys and MIDI messages assigned to surface gadgets are consumed before the musical
 * keyboard, Cosmo Dots or instruments see them.
 */
export function installSurfaceTriggers(manager: IOChainManager): () => void {
	const abort = new AbortController()
	const heldKeys = new Map<string, Match[]>()
	const heldControls = new Map<string, Match[]>()
	window.addEventListener(
		EVENT_KEY_DOWN,
		(event) => {
			if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) {
				return
			}
			const key = triggerKey(event.key)
			if (learner) {
				if (key !== "Escape" && key !== "Tab") {
					event.preventDefault()
					event.stopImmediatePropagation()
					learner({ key })
				}
				return
			}
			if (typing()) {
				return
			}
			const matches = heldKeys.get(key) ?? findMatches(manager, { key })
			if (!matches.length) {
				return
			}
			event.preventDefault()
			event.stopImmediatePropagation()
			if (!event.repeat && !heldKeys.has(key)) {
				heldKeys.set(key, matches)
				fire(matches, true)
			}
		},
		{ capture: true, signal: abort.signal }
	)
	window.addEventListener(
		EVENT_KEY_UP,
		(event) => {
			const key = triggerKey(event.key)
			const matches = heldKeys.get(key)
			if (matches) {
				heldKeys.delete(key)
				event.stopImmediatePropagation()
				fire(matches, false)
			}
		},
		{ capture: true, signal: abort.signal }
	)
	window.addEventListener(
		EVENT_BLUR,
		() => {
			for (const matches of [...heldKeys.values(), ...heldControls.values()]) {
				fire(matches, false)
			}
			heldKeys.clear()
			heldControls.clear()
		},
		{ signal: abort.signal }
	)
	const previousCC = new Map<string, number>()
	manager.triggerHandler = (command: IAudioCommand) => {
		const type =
			command.type === CONTROL_CHANGE
				? "cc"
				: command.type === NOTE_ON || command.type === NOTE_OFF
					? "note"
					: undefined
		if (!type || !Number.isInteger(command.number)) {
			return false
		}
		const id = JSON.stringify([command.from, command.channel, type, command.number])
		let pressed: boolean | undefined
		if (type === "note") {
			pressed = command.type === NOTE_ON && command.velocity > 0
		} else {
			// Buttons cross 64; repeated values on the same side are not new presses.
			const previous = previousCC.get(id) ?? 0
			previousCC.set(id, command.value)
			pressed =
				command.value >= 64 && previous < 64
					? true
					: command.value < 64 && previous >= 64
						? false
						: undefined
		}
		if (learner) {
			if (pressed) {
				learner({ midi: { type, number: command.number, channel: command.channel || 0 } })
			}
			return true
		}
		const matches =
			heldControls.get(id) ??
			findMatches(manager, {
				midi: { type, number: command.number, channel: command.channel }
			})
		if (!matches.length) {
			return false
		}
		if (pressed && !heldControls.has(id)) {
			heldControls.set(id, matches)
			fire(matches, true)
		} else if (pressed === false && heldControls.delete(id)) {
			fire(matches, false)
		}
		return true
	}
	return () => {
		abort.abort()
		if (manager.triggerHandler) {
			manager.triggerHandler = undefined
		}
		learner = undefined
	}
}