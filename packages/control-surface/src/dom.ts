import {
	EVENT_BLUR,
	EVENT_VISIBILITY_CHANGE,
	EVENT_CHANGE,
	EVENT_CLICK,
	EVENT_INPUT,
	EVENT_KEY_DOWN,
	EVENT_KEY_UP,
	EVENT_POINTER_DOWN,
	EVENT_POINTER_MOVE,
	EVENT_POINTER_UP,
	EVENT_POINTER_CANCEL,
	EVENT_LOST_POINTER_CAPTURE
} from "./events"
import {
	bounds,
	denormalize,
	dialOptions,
	dialPosition,
	formatValue,
	normalize,
	sameValue,
	validateValue
} from "./model"
import { contactPressure } from "./pressure"
import { createMusicGrid } from "./music-dom"
import { isMusicGrid, musicValues } from "./music"
import { createRelativeKeys } from "./relative-dom"
import type { RelativeKeys } from "./relative-keys"
import { createStrum } from "./strum-dom"
import type { Strum } from "./strum"
import type { ControlBinding, ControlValue } from "./types"

export interface DomControl {
	element: HTMLElement
	update(value: ControlValue | undefined): void
	release?(): void
	relative?: RelativeKeys
	strum?: Strum
}
/** Native semantic controls are also the accessible companions to GPU widgets. */
export function createDomControl(
	binding: ControlBinding,
	apply: (value: ControlValue, edge?: boolean) => void
): DomControl {
	const d = binding.descriptor,
		label = document.createElement("div"),
		caption = document.createElement("span")
	caption.textContent = d.label
	label.className = "component-control"
	label.title = d.help ?? ""
	label.append(caption)
	const updates: ((value: ControlValue | undefined) => void)[] = []
	let release: (() => void) | undefined
	let relative: RelativeKeys | undefined
	let strum: Strum | undefined
	const [min, max] = bounds(d)
	const input = (type: string, suffix = "") => {
		const el = document.createElement("input")
		el.type = type
		el.setAttribute("aria-label", `${d.label}${suffix}`)
		el.dataset.midiControl = binding.key + suffix
		el.disabled = d.disabled === true || d.readOnly === true
		if (["range", "number"].includes(type)) {
			el.min = String(min)
			el.max = String(max)
			el.step = String(d.step || "any")
		}
		label.append(el)
		return el
	}
	if (d.widget === "strum") {
		const strings = createStrum(d, apply)
		strum = strings.controller
		release = strings.release
		label.append(strings.element)
	} else if (d.widget === "relative-keys") {
		const keys = createRelativeKeys(d, apply)
		relative = keys.controller
		release = keys.release
		label.append(keys.element)
		updates.push(keys.update)
	} else if (isMusicGrid(d.widget)) {
		const grid = createMusicGrid(d, apply)
		label.append(grid.element)
		updates.push(grid.update)
		if (d.music?.live && !d.disabled && !d.readOnly) {
			release = () => {
				const empty = musicValues(d)
				grid.update(empty)
				apply(empty, true)
			}
		}
	} else if (d.widget === "pad") {
		const button = document.createElement("button")
		button.type = "button"
		button.textContent = d.label
		button.setAttribute("aria-label", d.label)
		button.disabled = !!(d.disabled || d.readOnly)
		button.dataset.midiControl = binding.key
		button.setAttribute("aria-pressed", "false")
		const contacts = new Map<number, { value: number; analogue: boolean }>()
		let keyboard = false
		let pressed = false
		const updatePress = () => {
			let pressure = keyboard ? 1 : 0
			for (const contact of contacts.values()) {
				pressure = Math.max(pressure, contact.value)
			}
			button.setAttribute("aria-pressed", String(pressure > 0))
			const edge = pressed !== pressure > 0
			pressed = pressure > 0
			apply(denormalize(d, pressure), edge)
		}
		release = () => {
			if (keyboard || contacts.size) {
				keyboard = false
				contacts.clear()
				updatePress()
			}
		}
		const contact = (event: PointerEvent) => {
			const value = contactPressure(
				event.pressure,
				event.pointerType,
				contacts.get(event.pointerId)?.analogue
			)
			contacts.set(event.pointerId, { value: value ?? 1, analogue: value !== undefined })
			updatePress()
		}
		button.addEventListener(EVENT_POINTER_DOWN, (event) => {
			if (button.disabled || (event.pointerType === "mouse" && event.button !== 0)) {
				return
			}
			event.preventDefault()
			button.focus()
			button.setPointerCapture(event.pointerId)
			contact(event)
		})
		button.addEventListener(EVENT_POINTER_MOVE, (event) => {
			if (contacts.has(event.pointerId)) {
				contact(event)
			}
		})
		for (const type of [EVENT_POINTER_UP, EVENT_POINTER_CANCEL, EVENT_LOST_POINTER_CAPTURE]) {
			button.addEventListener(type, (event) => {
				if (contacts.delete((event as PointerEvent).pointerId)) {
					updatePress()
				}
			})
		}
		button.addEventListener(EVENT_KEY_DOWN, (event) => {
			if (event.key === " " || event.key === "Enter") {
				event.preventDefault()
				if (!keyboard && !button.disabled) {
					keyboard = true
					updatePress()
				}
			}
		})
		button.addEventListener(EVENT_KEY_UP, (event) => {
			if (event.key === " " || event.key === "Enter") {
				event.preventDefault()
				if (keyboard) {
					keyboard = false
					updatePress()
				}
			}
		})
		button.addEventListener(EVENT_BLUR, () => {
			if (keyboard) {
				keyboard = false
				updatePress()
			}
		})
		button.addEventListener(EVENT_CLICK, (event) => {
			// Assistive technology can activate a button without pointer/key events.
			if (event.detail === 0 && !keyboard && !contacts.size && !button.disabled) {
				apply(denormalize(d, 1), true)
				apply(denormalize(d, 0), true)
			}
		})
		updates.push((value) =>
			button.setAttribute("aria-pressed", String(normalize(d, Number(value)) > 0))
		)
		caption.remove()
		label.append(button)
	} else if (d.widget === "button") {
		const button = document.createElement("button")
		button.type = "button"
		button.textContent = d.label
		button.disabled = !!(d.disabled || d.readOnly)
		button.dataset.midiControl = binding.key
		button.addEventListener(EVENT_CLICK, () => apply(d.defaultValue ?? 1))
		caption.remove()
		label.append(button)
	} else if (d.widget === "meter" || d.widget === "display") {
		const output = document.createElement("output")
		output.setAttribute("aria-label", d.label)
		if (d.widget === "meter") {
			output.setAttribute("role", "meter")
			output.setAttribute("aria-valuemin", String(min))
			output.setAttribute("aria-valuemax", String(max))
		}
		label.append(output)
		updates.push((v) => {
			output.value = formatValue(d, v)
			if (d.widget === "meter") {
				output.setAttribute(
					"aria-valuenow",
					String(typeof v === "number" ? Math.max(min, Math.min(max, v)) : min)
				)
				output.setAttribute("aria-valuetext", formatValue(d, v))
			}
		})
	} else if (d.widget === "select" || d.widget === "radio" || d.choices?.length) {
		// Index option values preserve typed/array-valued choices without string coercion.
		const select = document.createElement("select")
		select.setAttribute("aria-label", d.label)
		select.dataset.midiControl = binding.key
		const choices = d.choices ?? []
		select.disabled = !!(d.disabled || d.readOnly || !choices.length)
		for (const [i, choice] of choices.entries()) {
			const option = document.createElement("option")
			option.value = String(i)
			option.textContent = choice.label
			select.append(option)
		}
		select.addEventListener(EVENT_CHANGE, () => {
			const choice = choices[Number(select.value)]
			if (choice) {
				apply(choice.value)
			}
		})
		updates.push((v) => {
			select.value = String(choices.findIndex((c) => sameValue(c.value, v)))
		})
		label.append(select)
	} else if (d.widget === "xy" || d.widget === "range") {
		let current: number[] = [min, min]
		for (let axis = 0; axis < 2; axis++) {
			const el = input(
				"range",
				d.widget === "xy" ? (axis ? " Y" : " X") : axis ? " upper" : " lower"
			)
			el.addEventListener(EVENT_INPUT, () => {
				const next = [...current]
				next[axis] = el.valueAsNumber
				apply(next)
			})
			updates.push((v) => {
				current = Array.isArray(v) ? v : [min, min]
				el.value = String(current[axis])
			})
		}
	} else {
		const type =
			d.widget === "toggle"
				? "checkbox"
				: d.widget === "color"
					? "color"
					: d.widget === "text"
						? "text"
						: d.widget === "number"
							? "number"
							: "range"
		const el = input(type)
		if (
			(d.widget === "dial" || d.widget === "rotation") &&
			dialOptions(d.widget === "rotation" ? { ...d.dial, mode: "rotation" } : d.dial).mode ===
				"rotation"
		) {
			el.addEventListener(EVENT_KEY_DOWN, (event) => {
				const direction = ["ArrowUp", "ArrowRight"].includes(event.key)
					? 1
					: ["ArrowDown", "ArrowLeft"].includes(event.key)
						? -1
						: 0
				if (!direction || max === min) {
					return
				}
				event.preventDefault()
				const step =
					(d.step && d.step > 0 ? d.step : (max - min) / 100) * (event.shiftKey ? 0.1 : 1)
				const next = denormalize(
					d,
					dialPosition(
						normalize(d, el.valueAsNumber) + (direction * step) / (max - min),
						dialOptions(
							d.widget === "rotation" ? { ...d.dial, mode: "rotation" } : d.dial
						)
					)
				)
				el.value = String(next)
				apply(next)
			})
		}
		el.addEventListener(type === "text" ? EVENT_CHANGE : EVENT_INPUT, () => {
			apply(
				type === "checkbox"
					? el.checked
					: type === "range" || type === "number"
						? el.valueAsNumber
						: el.value
			)
		})
		updates.push((v) => {
			if (type === "range" || type === "number") {
				el.setAttribute("aria-valuetext", formatValue(d, v))
			}
			if (type === "checkbox") {
				el.checked = !!v
			} else if (document.activeElement !== el) {
				el.value = String(v ?? d.defaultValue ?? "")
			}
		})
	}
	if (d.help) {
		for (const control of label.querySelectorAll("input, select, button, output")) {
			control.setAttribute("title", d.help)
			control.setAttribute("aria-description", d.help)
		}
	}
	return {
		element: label,
		release,
		relative,
		strum,
		update(value) {
			for (const update of updates) {
				update(value)
			}
		}
	}
}

/** Shared view lifecycle; errors are visible and listeners are explicitly disposable. */
export function createDomGui(bindings: ControlBinding[]): {
	element: HTMLElement
	destroy(): void
} {
	const element = document.createElement("div"),
		error = document.createElement("p"),
		cleanup: (() => void)[] = []
	element.className = "component-controls nodrag nopan nowheel"
	error.setAttribute("role", "alert")
	const groups = new Map<string, HTMLElement>()
	let disposed = false
	const releases: (() => void)[] = []
	const releasePads = () => releases.forEach((release) => release())
	const visibilityChanged = () => {
		if (document.hidden) {
			releasePads()
		}
	}
	window.addEventListener(EVENT_BLUR, releasePads)
	document.addEventListener(EVENT_VISIBILITY_CHANGE, visibilityChanged)
	cleanup.push(
		() => window.removeEventListener(EVENT_BLUR, releasePads),
		() => document.removeEventListener(EVENT_VISIBILITY_CHANGE, visibilityChanged)
	)
	for (const binding of bindings) {
		let generation = 0
		const control = createDomControl(binding, (value) => {
			void Promise.resolve()
				.then(() => binding.write(validateValue(binding.descriptor, value)))
				.then(refresh)
				.catch((e) => {
					error.textContent = String(e)
					void refresh()
				})
		})
		const refresh = async () => {
			const version = ++generation
			try {
				const v = await binding.read()
				if (!disposed && generation === version) {
					control.update(v)
				}
			} catch (e) {
				if (!disposed) {
					error.textContent = String(e)
				}
			}
		}
		if (control.release) {
			releases.push(control.release)
		}
		const group = binding.descriptor.group
		if (!group) {
			element.append(control.element)
		} else {
			if (!groups.has(group)) {
				const fieldset = document.createElement("fieldset"),
					legend = document.createElement("legend")
				legend.textContent = group
				fieldset.append(legend)
				groups.set(group, fieldset)
				element.append(fieldset)
			}
			groups.get(group)!.append(control.element)
		}
		cleanup.push(binding.subscribe?.(() => void refresh()) ?? (() => {}))
		void refresh()
	}
	element.append(error)
	return {
		element,
		destroy() {
			releasePads()
			disposed = true
			cleanup.forEach((fn) => fn())
			element.remove()
		}
	}
}