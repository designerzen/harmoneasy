import { EVENT_CLICK, EVENT_KEY_DOWN, EVENT_POINTER_DOWN, EVENT_FOCUS_IN } from "./events"
import { musicOptions, musicValues, noteName } from "./music"
import type { ControlDescriptor, ControlValue } from "./types"

/** One Tab stop per grid, with native buttons and two-dimensional arrow navigation. */
export function createMusicGrid(
	d: ControlDescriptor,
	apply: (value: ControlValue, edge?: boolean) => void
) {
	const { steps, pitches, frets } = musicOptions(d.widget, d.music)
	const tab = d.widget === "guitar-tab"
	const grid = document.createElement("div")
	grid.className = "cs-note-grid"
	grid.setAttribute("role", "grid")
	grid.setAttribute("aria-label", d.label)
	grid.setAttribute("aria-rowcount", String(pitches.length))
	grid.setAttribute("aria-colcount", String(steps))
	grid.setAttribute(
		"aria-description",
		`Arrow keys move between cells. Home and End move along a row; Control Home and End move to the first or last cell. Enter or Space toggles a note. Delete clears it. ${tab ? "Plus and minus change the fret; digits set frets zero to nine." : "Plus and minus change velocity."}`
	)
	grid.style.setProperty("--cs-steps", String(steps))
	grid.style.setProperty("--cs-rows", String(pitches.length))
	let values = musicValues(d, d.defaultValue)
	let velocity = 1
	const buttons: HTMLButtonElement[] = []
	const refresh = () => {
		buttons.forEach((button, i) => {
			const row = Math.floor(i / steps),
				value = values[i],
				on = tab ? value >= 0 : value > 0
			button.disabled = !!(d.disabled || d.readOnly)
			button.setAttribute("aria-pressed", String(on))
			button.setAttribute(
				"aria-label",
				`${tab ? `String ${row + 1}, ${noteName(pitches[row])}` : noteName(pitches[row])}, step ${(i % steps) + 1}, ${tab ? (value < 0 ? "rest" : `fret ${value}, ${noteName(pitches[row] + value)}`) : on ? `velocity ${Math.round(value * 100)} percent` : "off"}`
			)
			button.textContent = tab ? (value < 0 ? "–" : String(value)) : on ? "●" : "·"
			button.dataset.on = String(on)
		})
	}
	const change = (i: number, value: number) => {
		if (buttons[i].disabled) {
			return
		}
		values = [...values]
		values[i] = value
		refresh()
		apply([...values], true)
	}
	pitches.forEach((_, row) => {
		const rowElement = document.createElement("div")
		rowElement.setAttribute("role", "row")
		rowElement.setAttribute("aria-rowindex", String(row + 1))
		for (let column = 0; column < steps; column++) {
			const i = row * steps + column
			const cell = document.createElement("div"),
				button = document.createElement("button")
			cell.setAttribute("role", "gridcell")
			cell.setAttribute("aria-colindex", String(column + 1))
			button.type = "button"
			button.tabIndex = i === 0 ? 0 : -1
			button.addEventListener(EVENT_FOCUS_IN, () =>
				buttons.forEach((item) => (item.tabIndex = item === button ? 0 : -1))
			)
			button.addEventListener(EVENT_POINTER_DOWN, (event) => {
				velocity = event.pointerType === "pen" && event.pressure > 0 ? event.pressure : 1
			})
			button.addEventListener(EVENT_CLICK, (event) =>
				change(
					i,
					(tab ? values[i] >= 0 : values[i] > 0)
						? tab
							? -1
							: 0
						: tab
							? 0
							: event.detail
								? velocity
								: 1
				)
			)
			button.addEventListener(EVENT_KEY_DOWN, (event) => {
				if (button.disabled) {
					return
				}
				let target = i
				switch (event.key) {
					case "ArrowLeft":
						target = row * steps + Math.max(0, column - 1)
						break
					case "ArrowRight":
						target = row * steps + Math.min(steps - 1, column + 1)
						break
					case "ArrowUp":
						target = Math.max(0, row - 1) * steps + column
						break
					case "ArrowDown":
						target = Math.min(pitches.length - 1, row + 1) * steps + column
						break
					case "Home":
						target = event.ctrlKey ? 0 : row * steps
						break
					case "End":
						target = event.ctrlKey ? buttons.length - 1 : row * steps + steps - 1
						break
					case "Delete":
					case "Backspace":
						change(i, tab ? -1 : 0)
						break
					case "+":
					case "=":
						change(
							i,
							tab ? Math.min(frets, values[i] + 1) : Math.min(1, values[i] + 0.1)
						)
						break
					case "-":
						change(i, tab ? Math.max(-1, values[i] - 1) : Math.max(0, values[i] - 0.1))
						break
					default:
						if (tab && /^\d$/.test(event.key)) {
							change(i, Math.min(frets, Number(event.key)))
						} else {
							return
						}
				}
				event.preventDefault()
				buttons.forEach((item, index) => (item.tabIndex = index === target ? 0 : -1))
				buttons[target].focus()
			})
			buttons.push(button)
			cell.append(button)
			rowElement.append(cell)
		}
		grid.append(rowElement)
	})
	refresh()
	return {
		element: grid,
		update(value: ControlValue | undefined) {
			values = musicValues(d, value)
			refresh()
		}
	}
}