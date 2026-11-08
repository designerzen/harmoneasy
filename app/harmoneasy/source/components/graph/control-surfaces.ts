import { surfaceNoteSource } from "./control-surface-notes"
import { surfaceAudioSources } from "./control-surface-audio"
import { ControlSurface, featuredBindings } from "control-surface"
import { portableComponents, surfaceShareURL, takeSurfaceNotice } from "./control-surface-share"
import { learnSurfaceTrigger, registerTriggerView } from "./control-surface-triggers"
import "control-surface/style.css"
import { bindingKey } from "control-surface/model"
import type {
	ComponentUi,
	ControlBinding,
	SurfaceState,
	SurfaceMenuAction
} from "control-surface/types"
import { componentBindings, subscribeControlSchema } from "audiobus/io/component-ui"
import { deviceId } from "audiobus/io/device-definition"
import {
	EVENT_ABORT,
	EVENT_CLICK,
	EVENT_CLOSE,
	EVENT_CONFIGURATION_CHANGED,
	EVENT_CONTROL_SCHEMA_CHANGED,
	EVENT_INPUTS_UPDATED,
	EVENT_OUTPUTS_UPDATED,
	EVENT_TRANSFORMERS_UPDATED,
	EVENT_KEY_DOWN,
	EVENT_SUBMIT
} from "audiobus/event-constants"
import type IOChain from "audiobus/io/IO-chain"

/** Interpolate only up to the next transport tick, so delayed ticks cannot create a free-running cue. */
export function surfaceBeat(
	timer: Pick<
		IOChain["timer"],
		| "isRunning"
		| "BPM"
		| "barsElapsed"
		| "totalBars"
		| "bar"
		| "beatProgress"
		| "totalDivisions"
		| "timeElapsed"
		| "clockUnitsToSecondsScale"
		| "lastRecordedTime"
	>
): number | undefined {
	if (
		!timer.isRunning ||
		!Number.isFinite(timer.BPM) ||
		timer.BPM <= 0 ||
		timer.totalDivisions <= 0
	) {
		return undefined
	}
	const elapsed = timer.timeElapsed * timer.clockUnitsToSecondsScale - timer.lastRecordedTime
	const fraction = Math.max(0, Math.min(1 / timer.totalDivisions, (elapsed * timer.BPM) / 60))
	return timer.barsElapsed * timer.totalBars + timer.bar + timer.beatProgress + fraction
}

export const CONTROL_HANDLE = "component-controls"
export const SURFACE_HANDLE = "surface-controls"
export function controlComponentId(component: object & { midiControlId?: string }): string {
	return component.midiControlId ? `transformer:${component.midiControlId}` : deviceId(component)
}
export function controlComponents(chain: IOChain): Map<string, ComponentUi & { name: string }> {
	return new Map(
		[...chain.inputs, ...chain.outputs, ...chain.transformers].map((component) => [
			controlComponentId(component),
			component
		])
	)
}
/** New surfaces start with the chain's key controls so they are playable immediately. */
export function createSurface(chain: IOChain): Promise<void> {
	const surfaces = chain.options.controlSurfaces ?? []
	const id = crypto.randomUUID()
	chain.setGraphOptions({
		controlSurfaces: [
			...surfaces,
			{
				id,
				name: `Control Surface ${surfaces.length + 1}`,
				connections: [],
				widgets: [],
				theme: "neon"
			}
		]
	})
	return fillSurface(chain, id)
}

/** Add the most important controls from every chain component, keeping existing widgets. */
export async function fillSurface(chain: IOChain, surfaceId: string, limit = 12): Promise<void> {
	const available: ControlBinding[] = []
	for (const [id, component] of controlComponents(chain)) {
		try {
			available.push(...(await componentBindings(component, id)))
		} catch {
			/* A component without a running engine contributes nothing yet. */
		}
	}
	const current = chain.options.controlSurfaces?.find((s) => s.id === surfaceId)
	if (!current) {
		return
	}
	const state = structuredClone(current)
	const present = new Set(state.widgets.flatMap((w) => [w.key, w.yKey]))
	for (const binding of featuredBindings(
		available.filter((b) => !present.has(b.key)),
		Math.max(0, limit - state.widgets.length)
	)) {
		const componentId = binding.sourceId!
		let connection = state.connections.find((c) => c.componentId === componentId)
		if (!connection) {
			state.connections.push((connection = { componentId, controlIds: [] }))
		}
		if (!connection.controlIds.includes(binding.descriptor.id)) {
			connection.controlIds.push(binding.descriptor.id)
		}
		state.widgets.push({ key: binding.key })
	}
	updateSurface(chain, state)
}
export function updateSurface(chain: IOChain, state: SurfaceState): void {
	chain.setGraphOptions({
		controlSurfaces: (chain.options.controlSurfaces ?? []).map((s) =>
			s.id === state.id ? state : s
		)
	})
}
export function removeSurface(chain: IOChain, id: string): void {
	chain.setGraphOptions({
		...(chain.options.mainSurfaceId === id ? { mainSurfaceId: undefined } : {}),
		controlSurfaces: (chain.options.controlSurfaces ?? []).filter((s) => s.id !== id)
	})
}
export function disconnectSurface(chain: IOChain, surfaceId: string, componentId: string): void {
	const original = chain.options.controlSurfaces?.find((s) => s.id === surfaceId)
	if (!original) {
		return
	}
	const state = structuredClone(original),
		keys = new Set(
			state.connections
				.find((c) => c.componentId === componentId)
				?.controlIds.map((id) => bindingKey(componentId, id))
		)
	state.connections = state.connections.filter((c) => c.componentId !== componentId)
	state.widgets = state.widgets.filter((w) => !keys.has(w.key) && !keys.has(w.yKey ?? ""))
	updateSurface(chain, state)
}

/** Native dialog: connecting an edge only commits bindings when Apply is pressed. */
export function selectSurfaceControls(
	chain: IOChain,
	surfaceId: string,
	componentId: string
): { destroy(): void } {
	const component = controlComponents(chain).get(componentId)
	if (!component) {
		return { destroy() {} }
	}
	const dialog = document.createElement("dialog"),
		form = document.createElement("form"),
		heading = document.createElement("h2"),
		status = document.createElement("p"),
		groups = document.createElement("div"),
		actions = document.createElement("div")
	dialog.className = "control-selection-dialog nodrag nopan nowheel"
	dialog.setAttribute("aria-label", `Add ${component.name} controls`)
	heading.textContent = `${component.name} → Control Surface`
	status.textContent = "Loading available controls…"
	status.setAttribute("role", "status")
	const apply = document.createElement("button"),
		cancel = document.createElement("button")
	apply.type = "submit"
	apply.textContent = "Apply controls"
	apply.disabled = true
	cancel.type = "button"
	cancel.textContent = "Cancel"
	cancel.addEventListener(EVENT_CLICK, () => dialog.close())
	actions.append(apply, cancel)
	form.append(heading, status, groups, actions)
	dialog.append(form)
	const choices = new Map<string, HTMLInputElement>()
	let disposed = false
	form.addEventListener(EVENT_SUBMIT, (event) => {
		event.preventDefault()
		const current = chain.options.controlSurfaces?.find((s) => s.id === surfaceId)
		if (!current) {
			return
		}
		const state = structuredClone(current),
			selected = [...choices].filter(([, input]) => input.checked).map(([id]) => id)
		const previous =
			state.connections.find((c) => c.componentId === componentId)?.controlIds ?? []
		const removed = new Set(
			previous.filter((id) => !selected.includes(id)).map((id) => bindingKey(componentId, id))
		)
		state.connections = state.connections.filter((c) => c.componentId !== componentId)
		if (selected.length) {
			state.connections.push({ componentId, controlIds: selected })
		}
		state.widgets = state.widgets.filter(
			(w) => !removed.has(w.key) && !removed.has(w.yKey ?? "")
		)
		for (const id of selected) {
			const key = bindingKey(componentId, id)
			if (!state.widgets.some((w) => w.key === key && !w.yKey)) {
				state.widgets.push({ key })
			}
		}
		updateSurface(chain, state)
		dialog.close()
	})
	dialog.addEventListener(EVENT_KEY_DOWN, (event) => event.stopPropagation())
	const destroy = () => {
		disposed = true
		dialog.remove()
	}
	dialog.addEventListener(EVENT_CLOSE, destroy, { once: true })
	document.body.append(dialog)
	dialog.showModal()
	void componentBindings(component, componentId)
		.then((available) => {
			if (disposed) {
				return
			}
			const selected =
				chain.options.controlSurfaces
					?.find((s) => s.id === surfaceId)
					?.connections.find((c) => c.componentId === componentId)?.controlIds ?? []
			const grouped = new Map<string, HTMLFieldSetElement>()
			for (const binding of available) {
				const d = binding.descriptor,
					group = d.group ?? "Controls"
				if (!grouped.has(group)) {
					const fieldset = document.createElement("fieldset"),
						legend = document.createElement("legend")
					legend.textContent = group
					fieldset.append(legend)
					grouped.set(group, fieldset)
					groups.append(fieldset)
				}
				const label = document.createElement("label"),
					input = document.createElement("input"),
					text = document.createElement("span")
				input.type = "checkbox"
				input.checked = selected.includes(d.id)
				choices.set(d.id, input)
				text.textContent = `${d.label} · ${d.widget}${d.unit ? ` (${d.unit})` : ""}`
				if (d.help) {
					const help = document.createElement("small")
					help.textContent = d.help
					text.append(help)
				}
				label.append(input, text)
				grouped.get(group)!.append(label)
			}
			// Keep missing controls selectable for removal rather than silently deleting saved bindings.
			for (const id of selected.filter((id) => !choices.has(id))) {
				const label = document.createElement("label"),
					input = document.createElement("input")
				input.type = "checkbox"
				input.checked = true
				choices.set(id, input)
				label.append(input, `${id} (unavailable)`)
				groups.append(label)
			}
			status.textContent = available.length
				? "Choose the controls to add. Existing selections remain connected."
				: "This component exposes no controls yet."
			apply.disabled = !choices.size
		})
		.catch((error) => {
			if (!disposed) {
				status.textContent = String(error)
			}
		})
	return { destroy }
}

/** Native surface host; React is only responsible for placing its graph node. */
export function mountControlSurface(
	host: HTMLElement,
	chain: IOChain,
	surfaceId: string,
	toolbarHost?: HTMLElement,
	menuActions?: () => SurfaceMenuAction[],
	/** False inside the zoomable graph; the expanded view fills the window. */
	fitHeight = true
): { destroy(): void } {
	const noteSource = surfaceNoteSource(chain)
	let audioSources: ReturnType<typeof surfaceAudioSources> | undefined
	let surface: ControlSurface | undefined,
		disposed = false,
		generation = 0,
		signature = ""
	let saveTimer: ReturnType<typeof setTimeout> | undefined
	let panelViews: { element: HTMLElement; destroy(): void }[] = []
	const controlDialogs: { destroy(): void }[] = []
	let schemaAbort = new AbortController()
	const abort = new AbortController()
	// Shown until the performer edits the surface.
	let notice = takeSurfaceNotice(surfaceId)
	const unregisterTriggers = registerTriggerView(surfaceId, {
		trigger: (key, pressed) => surface?.trigger(key, pressed) ?? false
	})
	const refresh = async () => {
		const state = chain.options.controlSurfaces?.find((s) => s.id === surfaceId)
		if (!state) {
			return
		}
		const components = controlComponents(chain)
		const next = JSON.stringify([state, [...components.keys()]])
		if (next === signature) {
			return
		}
		signature = next
		const version = ++generation
		schemaAbort.abort()
		schemaAbort = new AbortController()
		for (const component of components.values()) {
			const unsubscribeSchema = subscribeControlSchema(component, () => {
				signature = ""
				void refresh()
			})
			schemaAbort.signal.addEventListener(EVENT_ABORT, unsubscribeSchema, { once: true })
			const target = component as ComponentUi & Partial<EventTarget>
			target.addEventListener?.(
				EVENT_CONTROL_SCHEMA_CHANGED,
				() => {
					signature = ""
					void refresh()
				},
				{ signal: schemaAbort.signal }
			)
		}
		const bindings: ControlBinding[] = []
		for (const connection of state.connections) {
			const component = components.get(connection.componentId)
			if (!component) {
				continue
			}
			try {
				bindings.push(
					...(await componentBindings(component, connection.componentId)).filter((b) =>
						connection.controlIds.includes(b.descriptor.id)
					)
				)
			} catch {
				/* Missing engines keep their saved widgets. */
			}
		}
		if (disposed || version !== generation) {
			return
		}
		const editing = surface?.isEditing ?? false
		surface?.destroy()
		audioSources?.destroy()
		audioSources = surfaceAudioSources(chain.outputs)
		panelViews.forEach((view) => view.destroy())
		panelViews = (state.panels ?? []).flatMap((id) => {
			const view = components.get(id)?.createSurfaceView?.()
			return view ? [view] : []
		})
		surface = new ControlSurface({
			visualiserSources: [noteSource.source, ...audioSources.sources],
			beatPosition: () => surfaceBeat(chain.timer),
			state: structuredClone(state),
			bindings,
			toolbarHost,
			editing,
			menuActions,
			notice,
			fitHeight,
			learnTrigger: learnSurfaceTrigger,
			fillControls() {
				notice = undefined
				void fillSurface(chain, surfaceId)
			},
			async share() {
				const current = chain.options.controlSurfaces?.find((s) => s.id === surfaceId)
				if (!current) {
					throw new Error("This surface no longer exists")
				}
				const url = surfaceShareURL(current, portableComponents(controlComponents(chain)))
				await navigator.clipboard.writeText(url)
				return "Share link copied. Anyone opening it gets this surface on their own instruments."
			},
			addControls: [...components].map(([id, component]) => ({
				label: `Add ${component.name} controls…`,
				action: () => {
					controlDialogs.push(selectSurfaceControls(chain, surfaceId, id))
				}
			})),
			change(changed) {
				notice = undefined
				signature = JSON.stringify([changed, [...controlComponents(chain).keys()]])
				updateSurface(chain, changed)
			},
			configurationChanged() {
				clearTimeout(saveTimer)
				saveTimer = setTimeout(
					() => chain.dispatchEvent(new Event(EVENT_CONFIGURATION_CHANGED)),
					200
				)
			}
		})
		host.replaceChildren(...panelViews.map((view) => view.element), surface.element)
	}
	for (const [target, event] of [
		[chain, EVENT_CONFIGURATION_CHANGED],
		[chain.inputManager, EVENT_INPUTS_UPDATED],
		[chain.outputManager, EVENT_OUTPUTS_UPDATED],
		[chain.transformerManager, EVENT_TRANSFORMERS_UPDATED]
	] as const) {
		target.addEventListener(event, () => void refresh(), { signal: abort.signal })
	}
	void refresh()
	return {
		destroy() {
			disposed = true
			generation++
			unregisterTriggers()
			clearTimeout(saveTimer)
			abort.abort()
			schemaAbort.abort()
			surface?.destroy()
			audioSources?.destroy()
			noteSource.destroy()
			panelViews.forEach((view) => view.destroy())
			controlDialogs.forEach((dialog) => dialog.destroy())
		}
	}
}