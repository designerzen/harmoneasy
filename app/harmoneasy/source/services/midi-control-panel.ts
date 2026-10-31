import {
	EVENT_INPUT,
	EVENT_CHANGE,
	EVENT_CLOSE,
	EVENT_TOGGLE,
	EVENT_CLICK,
	EVENT_CHAINS_UPDATED,
	EVENT_WORKSPACE_RESTORED,
	EVENT_CONFIGURATION_CHANGED
} from "audiobus/event-constants"
import { element, field } from "./music-tools-dom"
import type IOChainManager from "audiobus/io/IO-chain-manager"
import type { Transformer } from "audiobus/io/transformers/abstract-transformer"
import {
	MidiControls,
	DEFAULT_MIDI_BINDINGS,
	scaleMidiValue,
	type MidiBinding,
	type MidiTarget
} from "./midi-controls"

type Control = HTMLElement
const selector =
	'button, summary, a[href], select, input[type="range"], input[type="number"], input[type="checkbox"], input[type="radio"]'

function controlName(element: Control): string {
	const label =
		element.closest("label") ??
		(element instanceof HTMLInputElement || element instanceof HTMLSelectElement
			? element.labels?.[0]
			: null)
	const labelText = label
		? [...label.childNodes]
				.filter((n) => n.nodeType === 3)
				.map((n) => n.textContent)
				.join("")
				.trim()
		: ""
	return (
		labelText ||
		element.getAttribute("aria-label") ||
		element.getAttribute("data-midi-control") ||
		element.getAttribute("name") ||
		element.title ||
		element.textContent?.trim() ||
		element.id ||
		element.className ||
		element.tagName
	)
}

export function domMidiTargets(root: Document): MidiTarget[] {
	const occurrences = new Map<object, Map<string, number>>()
	const targets = new Map<string, MidiTarget>()
	for (const element of root.querySelectorAll<Control>(selector)) {
		if (element.closest("[data-midi-ignore]")) {
			continue
		}
		const stableId =
			element.id && !element.id.startsWith("_r_") && !element.id.startsWith(":")
				? element.id
				: ""
		const scope =
			element.closest<HTMLElement>("[data-midi-scope]") ??
			(stableId ? element : element.parentElement?.closest<HTMLElement>("[id]"))
		const scopeName = scope?.dataset.midiScope ?? (stableId ? "app" : scope?.id) ?? "app"
		const name = controlName(element)
		// React useId IDs change on remount; use semantic names within explicit scopes.
		const action = !(
			element instanceof HTMLInputElement || element instanceof HTMLSelectElement
		)
		const semanticId =
			element.dataset.midiControl ||
			element.getAttribute("name") ||
			(action && element.className ? element.className : name)
		const localId = scope?.dataset.midiScope
			? `${element.tagName}:${semanticId}`
			: stableId || `${element.tagName}:${semanticId}`
		const base = `${scopeName}:${localId}`
		const owner = scope ?? root
		let counts = occurrences.get(owner)
		if (!counts) {
			occurrences.set(owner, (counts = new Map()))
		}
		const count = counts.get(base) ?? 0
		counts.set(base, count + 1)
		const id = count ? `${base}:${count}` : base
		const displayScope =
			scope?.dataset.midiLabel ?? scope?.getAttribute("aria-label") ?? scopeName
		targets.set(id, {
			id,
			label: `${displayScope} / ${name}`,
			kind: action ? "action" : "value",
			apply(value) {
				if (
					element.matches(":disabled") ||
					(element instanceof HTMLInputElement && element.readOnly)
				) {
					return
				}
				if (
					!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement)
				) {
					element.click()
					return
				}
				if (element instanceof HTMLSelectElement) {
					const options = [...element.options].filter(
						(o) =>
							!o.disabled &&
							!(
								o.parentElement instanceof HTMLOptGroupElement &&
								o.parentElement.disabled
							)
					)
					if (!options.length) {
						return
					}
					const next = options[scaleMidiValue(value, 0, options.length - 1)].value
					// The native setter also works with React controlled selects.
					Object.getOwnPropertyDescriptor(
						HTMLSelectElement.prototype,
						"value"
					)!.set!.call(element, next)
				} else if (element.type === "checkbox" || element.type === "radio") {
					const checked = value >= 64
					if (element.checked === checked || (element.type === "radio" && !checked)) {
						return
					}
					element.click()
					return
				} else {
					const min = element.min ? Number(element.min) : 0
					const max = element.max ? Number(element.max) : 127
					const step = element.step === "any" ? 0 : Number(element.step || 1)
					const next = String(scaleMidiValue(value, min, max, step))
					Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
						element,
						next
					)
				}
				element.dispatchEvent(new Event(EVENT_INPUT, { bubbles: true }))
				element.dispatchEvent(new Event(EVENT_CHANGE, { bubbles: true }))
			}
		})
	}
	// Expanded graph views may mirror the same control. Prefer the expanded view.
	return [...targets.values()]
}

export function createMidiControlPanel(
	manager: IOChainManager,
	saved: string | undefined,
	persist: (serialized: string) => void
): MidiControls {
	const host = document.getElementById("midi-control-settings")!
	let settings: { bindings?: unknown; enabled?: boolean } = {}
	try {
		if (saved) {
			settings = JSON.parse(saved) ?? {}
		}
	} catch {
		/* Keep defaults for invalid URL settings. */
	}
	const targets = () => {
		const result = domMidiTargets(document)
		for (const [chainId, chain] of manager.entries) {
			for (const item of chain.transformers) {
				const transformer = item as Transformer<any>
				for (const field of transformer.fields) {
					if (field.type !== "select" || !field.values?.length) {
						continue
					}
					result.push({
						id: `${chainId}:transformer:${transformer.midiControlId}:${field.name}`,
						label: `${chain.options.name} / ${transformer.name} / ${field.label ?? field.name}`,
						kind: "value",
						apply(value) {
							const choice =
								field.values![scaleMidiValue(value, 0, field.values!.length - 1)]
							transformer.setConfig(
								field.name,
								typeof choice === "object" && choice !== null
									? choice.value
									: choice
							)
							chain.dispatchEvent(new Event(EVENT_CONFIGURATION_CHANGED))
						}
					})
				}
			}
		}
		return result
	}
	const controls = new MidiControls(targets, settings.bindings ?? DEFAULT_MIDI_BINDINGS, () => {
		persist(JSON.stringify({ enabled: controls.enabled, bindings: controls.bindings }))
		renderBindings()
	})
	controls.enabled = settings.enabled !== false
	manager.controlChangeHandler = controls.handle
	host.dataset.midiIgnore = ""
	host.innerHTML = `<label><input type="checkbox" data-role="enabled"> Enable control via MIDI</label>
        <p>Choose what to control, select Learn MIDI CC, then move a hardware knob or slider. Learning records its CC, channel and input device without moving the target. You can also assign a CC manually.</p>
        <p>Assigned CCs are used by these controls and do not reach instruments. Unassigned messages continue to instruments. Buttons trigger once when a CC crosses 64.</p>
        <label>Find a control <input type="search" data-role="search" placeholder="Volume, tempo, chain or parameter"></label>
        <label>Control <select data-role="target"></select></label>
        <button type="button" data-role="refresh">Refresh controls</button>
        <button type="button" data-role="learn">Learn MIDI CC</button>
        <button type="button" data-role="cancel">Cancel learn</button>
        <details><summary>Assign a CC manually</summary>
        <label>CC <input data-role="cc" type="number" min="0" max="127" value="20"></label>
        <label>Channel <select data-role="channel"><option value="0">All</option>${Array.from({ length: 16 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("")}</select></label>
        <button type="button" data-role="assign">Assign from any device</button></details>
        <p role="status" data-role="status" aria-live="polite"></p>
        <h3>CC assignments</h3><p>Edit the control beside a CC to change what it controls. Each row can be relearned or removed. One CC may control several targets.</p>
        <ul data-role="bindings"></ul>`
	const get = <T extends HTMLElement>(role: string) =>
		host.querySelector<T>(`[data-role="${role}"]`)!
	const targetSelect = get<HTMLSelectElement>("target")
	const status = get("status")
	const label = (target: MidiTarget) => target.label.replace(/^app \/ /, "Global / ")
	const populateTargets = (select: HTMLSelectElement, selected: string, query = "") => {
		const groups = new Map<string, HTMLOptGroupElement>()
		select.replaceChildren()
		for (const target of targets()) {
			const name = label(target)
			if (query && !name.toLowerCase().includes(query.toLowerCase())) {
				continue
			}
			const scope = name.split(" / ")[0]
			let group = groups.get(scope)
			if (!group) {
				group = element("optgroup")
				group.label = scope
				groups.set(scope, group)
				select.append(group)
			}
			const option = element("option", name)
			option.value = target.id
			group.append(option)
		}
		if (
			selected &&
			![...select.options].some((option) => option.value === selected) &&
			!query
		) {
			const missing = element("option", `${selected} (unavailable)`)
			missing.value = selected
			select.append(missing)
		}
		if ([...select.options].some((option) => option.value === selected)) {
			select.value = selected
		}
	}
	const refresh = () => {
		populateTargets(targetSelect, targetSelect.value, get<HTMLInputElement>("search").value)
		get<HTMLButtonElement>("learn").disabled = !targetSelect.value
		get<HTMLButtonElement>("assign").disabled = !targetSelect.value
		renderBindings()
	}
	const learn = (target: string) => {
		controls.learning = target || null
		renderBindings()
	}
	function renderBindings() {
		get("bindings").replaceChildren(
			...controls.bindings.map((binding) => {
				const item = element("li")
				const target = field(item, "Control", element("select"))
				target.dataset.role = "binding-target"
				populateTargets(target, binding.target)
				const cc = field(item, "CC", element("input"))
				cc.type = "number"
				cc.min = "0"
				cc.max = "127"
				cc.value = String(binding.cc)
				const channel = field(item, "Channel", element("select"))
				for (let i = 0; i <= 16; i++) {
					const option = element("option", i ? String(i) : "All channels")
					option.value = String(i)
					channel.append(option)
				}
				channel.value = String(binding.channel)
				const source = field(item, "Input device", element("select"))
				const sources = new Set(["", ...controls.bindings.map((b) => b.source)])
				for (const id of sources) {
					const device = manager.devices.find(({ device }) => device.uuid === id)
					const option = element(
						"option",
						id ? (device?.device.name ?? id) : "Any device"
					)
					option.value = id
					source.append(option)
				}
				source.value = binding.source
				const save = element("button", "Save assignment")
				save.type = "button"
				save.dataset.role = "binding-save"
				save.onclick = () => {
					if (!cc.reportValidity()) {
						return
					}
					try {
						const next: MidiBinding = {
							target: target.value,
							cc: cc.valueAsNumber,
							channel: Number(channel.value),
							source: source.value
						}
						controls.replace(binding.target, next)
					} catch (error) {
						status.textContent = String(error)
					}
				}
				const relearn = element("button", "Learn new MIDI CC")
				relearn.type = "button"
				relearn.onclick = () => learn(binding.target)
				const remove = element("button", "Remove")
				remove.type = "button"
				remove.onclick = () => {
					controls.learning = null
					controls.remove(binding.target)
				}
				item.append(save, relearn, remove)
				return item
			})
		)
		const learningTarget = targets().find((target) => target.id === controls.learning)
		status.textContent = controls.learning
			? `Learning ${learningTarget ? label(learningTarget) : controls.learning}: move a MIDI knob or slider. The next CC will be assigned.`
			: "Assignments saved. Choose a control to learn or edit an assignment below."
		get<HTMLButtonElement>("cancel").disabled = !controls.learning
	}
	const enabled = get<HTMLInputElement>("enabled")
	enabled.checked = controls.enabled
	enabled.onchange = () => {
		controls.enabled = enabled.checked
		controls.learning = null
		persist(JSON.stringify({ enabled: controls.enabled, bindings: controls.bindings }))
		renderBindings()
	}
	get("refresh").onclick = refresh
	get("search").addEventListener(EVENT_INPUT, refresh)
	get("learn").onclick = () => learn(targetSelect.value)
	get("cancel").onclick = () => learn("")
	get("assign").onclick = () => {
		try {
			controls.assign({
				target: targetSelect.value,
				cc: get<HTMLInputElement>("cc").valueAsNumber,
				channel: Number(get<HTMLSelectElement>("channel").value),
				source: ""
			})
		} catch (error) {
			status.textContent = String(error)
		}
	}
	const dialog = document.getElementById("midi-dialog") as HTMLDialogElement | null
	document.getElementById("btn-midi")?.addEventListener(EVENT_CLICK, () => {
		refresh()
		dialog?.showModal()
	})
	const cancelLearning = () => {
		controls.learning = null
		renderBindings()
	}
	dialog?.addEventListener(EVENT_CLOSE, cancelLearning)
	dialog?.addEventListener(EVENT_TOGGLE, (event) => {
		if ((event as ToggleEvent).newState === "closed") {
			cancelLearning()
		} else {
			refresh()
		}
	})
	manager.addEventListener(EVENT_CHAINS_UPDATED, refresh)
	manager.addEventListener(EVENT_WORKSPACE_RESTORED, refresh)
	refresh()
	return controls
}