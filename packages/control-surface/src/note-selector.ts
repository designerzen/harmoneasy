import { EVENT_CLICK } from "./events"

/** Keep native note companions usable without overflowing their GPU gadget. */
export function noteSelector(element: HTMLElement, buttons: HTMLButtonElement[], label: string) {
	let selected = Math.max(
		0,
		buttons.findIndex((button) => !button.disabled)
	)
	const navigation = document.createElement("div")
	navigation.className = "cs-note-selector-navigation"
	const previous = document.createElement("button"),
		next = document.createElement("button")
	previous.type = next.type = "button"
	previous.textContent = "‹"
	next.textContent = "›"
	previous.setAttribute("aria-label", `Previous note in ${label}`)
	next.setAttribute("aria-label", `Next note in ${label}`)
	const select = (index: number) => {
		selected = Math.max(0, Math.min(buttons.length - 1, index))
		buttons.forEach((button, i) => {
			button.hidden = i !== selected
			button.tabIndex = i === selected ? 0 : -1
		})
		previous.disabled = selected === 0
		next.disabled = selected === buttons.length - 1
	}
	previous.addEventListener(EVENT_CLICK, () => select(selected - 1))
	next.addEventListener(EVENT_CLICK, () => select(selected + 1))
	navigation.append(previous, next)
	element.classList.add("cs-note-selector")
	element.append(navigation)
	select(selected)
	return (index: number) => {
		select(index)
		buttons[selected].focus({ preventScroll: true })
	}
}