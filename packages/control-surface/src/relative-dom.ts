import { noteSelector } from "./note-selector"
import {
	EVENT_BLUR,
	EVENT_CLICK,
	EVENT_KEY_DOWN,
	EVENT_KEY_UP,
	EVENT_POINTER_DOWN,
	EVENT_POINTER_UP,
	EVENT_POINTER_CANCEL,
	EVENT_LOST_POINTER_CAPTURE
} from "./events"
import { RelativeKeys } from "./relative-keys"
import { noteName } from "./music"
import type { ControlDescriptor, ControlValue } from "./types"

export function createRelativeKeys(
	d: ControlDescriptor,
	apply: (value: ControlValue, edge?: boolean) => void
) {
	const element = document.createElement("div")
	element.setAttribute("role", "group")
	element.setAttribute("aria-label", d.label)
	element.setAttribute(
		"aria-description",
		"The first touch anchors the root note. Other touches play intervals relative to it. For keyboard playing, use arrows to choose a note; hold Space or Enter to play, then release to stop. Assistive activation toggles a note on or off."
	)
	const controller = new RelativeKeys(d.relativeKeys, (value, edge) => {
		refresh()
		apply(value, edge)
	})
	const buttons: HTMLButtonElement[] = []
	const refresh = () =>
		buttons.forEach((button, index) => {
			button.setAttribute("aria-pressed", String(controller.contacts.has(-index - 1)))
			button.disabled = !!(d.disabled || d.readOnly)
		})
	for (let i = 0; i < 13 && controller.options.rootNote + i <= 127; i++) {
		const button = document.createElement("button"),
			id = -i - 1
		button.type = "button"
		button.textContent = noteName(controller.options.rootNote + i)
		button.setAttribute("aria-label", `Play ${button.textContent}`)
		button.tabIndex = i ? -1 : 0
		const down = () => {
			if (button.disabled || controller.contacts.has(id)) {
				return
			}
			controller.keyboardDown(id, controller.options.rootNote + i)
		}
		button.addEventListener(EVENT_KEY_DOWN, (event) => {
			if (event.key === " " || event.key === "Enter") {
				event.preventDefault()
				if (!event.repeat) {
					down()
				}
				return
			}
			const step =
				event.key === "ArrowRight" || event.key === "ArrowUp"
					? 1
					: event.key === "ArrowLeft" || event.key === "ArrowDown"
						? -1
						: 0
			if (step) {
				event.preventDefault()
				const target = Math.max(0, Math.min(buttons.length - 1, i + step))
				buttons.forEach((b, index) => (b.tabIndex = index === target ? 0 : -1))
				selectNote(target)
			}
		})
		button.addEventListener(EVENT_KEY_UP, (event) => {
			if (event.key === " " || event.key === "Enter") {
				event.preventDefault()
				controller.up(id)
			}
		})
		button.addEventListener(EVENT_POINTER_DOWN, (event) => {
			event.preventDefault()
			button.focus()
			button.setPointerCapture(event.pointerId)
			down()
		})
		button.addEventListener(EVENT_CLICK, (event) => {
			if (event.detail === 0 && !button.disabled) {
				if (controller.contacts.has(id)) {
					controller.up(id)
				} else {
					down()
				}
			}
		})
		for (const name of [
			EVENT_POINTER_UP,
			EVENT_POINTER_CANCEL,
			EVENT_LOST_POINTER_CAPTURE,
			EVENT_BLUR
		]) {
			button.addEventListener(name, () => controller.up(id))
		}
		buttons.push(button)
		element.append(button)
	}
	refresh()
	const selectNote = noteSelector(element, buttons, d.label)
	return { element, controller, update: refresh, release: () => controller.release() }
}