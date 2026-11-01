import { EVENT_CLICK, EVENT_KEY_DOWN } from "./events"
import { Strum } from "./strum"
import { noteName } from "./music"
import type { ControlDescriptor, ControlValue } from "./types"

export function createStrum(
	d: ControlDescriptor,
	apply: (value: ControlValue, edge?: boolean) => void
) {
	const element = document.createElement("div")
	element.setAttribute("role", "group")
	element.setAttribute("aria-label", d.label)
	element.setAttribute(
		"aria-description",
		"Drag across the strings to strum. Use arrow keys to choose a string and Space or Enter to pluck it."
	)
	const controller = new Strum(d.strum, apply),
		buttons: HTMLButtonElement[] = []
	controller.options.tuning.forEach((pitch, row) => {
		const button = document.createElement("button")
		button.type = "button"
		button.textContent = `String ${row + 1}: ${noteName(Math.min(127, pitch + Math.max(0, controller.options.frets[row])))}`
		button.setAttribute("aria-label", `Pluck ${button.textContent}`)
		button.disabled = !!(d.disabled || d.readOnly || controller.options.frets[row] < 0)
		button.tabIndex = -1
		button.addEventListener(EVENT_CLICK, () => {
			if (!button.disabled) {
				controller.pluck(row)
			}
		})
		button.addEventListener(EVENT_KEY_DOWN, (event) => {
			const direction =
				event.key === "ArrowDown" || event.key === "ArrowRight"
					? 1
					: event.key === "ArrowUp" || event.key === "ArrowLeft"
						? -1
						: 0
			if (!direction) {
				return
			}
			event.preventDefault()
			let target = row + direction
			while (target >= 0 && target < buttons.length && buttons[target].disabled) {
				target += direction
			}
			if (target < 0 || target >= buttons.length) {
				return
			}
			buttons.forEach((b, i) => (b.tabIndex = i === target ? 0 : -1))
			buttons[target].focus()
		})
		buttons.push(button)
		element.append(button)
	})
	const first = buttons.find((button) => !button.disabled)
	if (first) {
		first.tabIndex = 0
	}
	return { element, controller, release: () => controller.release() }
}