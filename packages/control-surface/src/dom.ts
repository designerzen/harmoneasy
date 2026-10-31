import { EVENT_CHANGE, EVENT_CLICK, EVENT_INPUT } from "./events"
import { bounds, formatValue, sameValue, validateValue } from "./model"
import type { ControlBinding, ControlValue } from "./types"

export interface DomControl {
	element: HTMLElement
	update(value: ControlValue | undefined): void
}
/** Native semantic controls are also the accessible companions to GPU widgets. */
export function createDomControl(binding: ControlBinding, apply: (value: ControlValue) => void): DomControl {
	const d = binding.descriptor, label = document.createElement("label"), caption = document.createElement("span")
	caption.textContent = d.label
	label.title = d.help ?? ""
	label.append(caption)
	const updates: ((value: ControlValue | undefined) => void)[] = []
	const [min, max] = bounds(d)
	const input = (type: string, suffix = "") => {
		const el = document.createElement("input")
		el.type = type
		el.setAttribute("aria-label", `${d.label}${suffix}`)
		el.dataset.midiControl = binding.key + suffix
		el.disabled = d.disabled === true || d.readOnly === true
		if (["range", "number"].includes(type)) {
			el.min = String(min); el.max = String(max); el.step = String(d.step || "any")
		}
		label.append(el)
		return el
	}
	if (d.widget === "button") {
		const button = document.createElement("button")
		button.type = "button"; button.textContent = d.label
		button.disabled = !!(d.disabled || d.readOnly)
		button.dataset.midiControl = binding.key
		button.addEventListener(EVENT_CLICK, () => apply(d.defaultValue ?? 1))
		caption.remove(); label.append(button)
	} else if (d.widget === "meter" || d.widget === "display") {
		const output = document.createElement("output")
		label.append(output)
		updates.push(v => { output.value = formatValue(d, v) })
	} else if (d.choices?.length) {
		// Index option values preserve typed/array-valued choices without string coercion.
		const select = document.createElement("select")
		select.setAttribute("aria-label", d.label)
		select.dataset.midiControl = binding.key
		select.disabled = !!(d.disabled || d.readOnly)
		for (const [i, choice] of d.choices.entries()) {
			const option = document.createElement("option")
			option.value = String(i); option.textContent = choice.label; select.append(option)
		}
		select.addEventListener(EVENT_CHANGE, () => apply(d.choices![Number(select.value)].value))
		updates.push(v => { select.value = String(d.choices!.findIndex(c => sameValue(c.value, v))) })
		label.append(select)
	} else if (d.widget === "xy" || d.widget === "range") {
		let current: number[] = [min, min]
		for (let axis = 0; axis < 2; axis++) {
			const el = input("range", d.widget === "xy" ? axis ? " Y" : " X" : axis ? " upper" : " lower")
			el.addEventListener(EVENT_INPUT, () => { const next = [...current]; next[axis] = el.valueAsNumber; apply(next) })
			updates.push(v => { current = Array.isArray(v) ? v : [min, min]; el.value = String(current[axis]) })
		}
	} else {
		const type = d.widget === "toggle" ? "checkbox" : d.widget === "color" ? "color" : d.widget === "text" ? "text" : d.widget === "number" ? "number" : "range"
		const el = input(type)
		el.addEventListener(type === "text" || type === "number" ? EVENT_CHANGE : EVENT_INPUT, () => {
			apply(type === "checkbox" ? el.checked : type === "range" || type === "number" ? el.valueAsNumber : el.value)
		})
		updates.push(v => {
			if (type === "checkbox") el.checked = !!v
			else if (document.activeElement !== el) el.value = String(v ?? d.defaultValue ?? "")
		})
	}
	if (d.help) {
		const help = document.createElement("small"); help.textContent = d.help; label.append(help)
	}
	return { element: label, update(value) { for (const update of updates) update(value) } }
}

/** Shared view lifecycle; errors are visible and listeners are explicitly disposable. */
export function createDomGui(bindings: ControlBinding[]): { element: HTMLElement; destroy(): void } {
	const element = document.createElement("div"), error = document.createElement("p"), cleanup: (() => void)[] = []
	element.className = "component-controls nodrag nopan nowheel"
	element.style.cssText = "display:grid;gap:12px;min-width:220px"
	error.setAttribute("role", "alert")
	const groups = new Map<string, HTMLElement>()
	let disposed = false
	for (const binding of bindings) {
		let generation = 0
		const control = createDomControl(binding, value => {
			void Promise.resolve().then(() => binding.write(validateValue(binding.descriptor, value)))
				.then(refresh).catch(e => { error.textContent = String(e); void refresh() })
		})
		const refresh = async () => {
			const version = ++generation
			try { const v = await binding.read(); if (!disposed && generation === version) control.update(v) }
			catch (e) { if (!disposed) error.textContent = String(e) }
		}
		const group = binding.descriptor.group ?? "Controls"
		if (!groups.has(group)) {
			const fieldset = document.createElement("fieldset"), legend = document.createElement("legend")
			legend.textContent = group; fieldset.append(legend); groups.set(group, fieldset); element.append(fieldset)
		}
		groups.get(group)!.append(control.element)
		cleanup.push(binding.subscribe?.(() => void refresh()) ?? (() => {}))
		void refresh()
	}
	element.append(error)
	return { element, destroy() { disposed = true; cleanup.forEach(fn => fn()); element.remove() } }
}
