import { EVENT_CHANGE, EVENT_CLICK, EVENT_KEY_DOWN } from "./events"
import { waveformPoints } from "./choices"
import type { ControlChoice, ControlDescriptor, ControlValue } from "./types"

export interface ChoiceLayout {
	choices: ControlChoice[]
	columns: number
	rows: number
	gap: number
	height: number
}
export interface ChoicePages {
	element: HTMLElement
	readonly layout: ChoiceLayout
	readonly revision: number
	update(value: ControlValue | undefined): void
	resize(width: number, height: number, scale: number): void
	destroy(): void
}
let groupId = 0

/** Visible, directly selectable options; page controls never change the selected value. */
export function createChoicePages(
	d: ControlDescriptor,
	key: string,
	apply: (value: ControlValue) => void
): ChoicePages {
	const choices = d.choices ?? [],
		element = document.createElement("div"),
		grid = document.createElement("div"),
		navigation = document.createElement("div")
	element.className = "cs-choice-panel"
	grid.className = "cs-choice-grid"
	grid.setAttribute("role", "radiogroup")
	grid.setAttribute("aria-label", d.label)
	navigation.className = "cs-choice-navigation"
	navigation.setAttribute("role", "group")
	navigation.setAttribute("aria-label", `${d.label} pages`)
	const previous = document.createElement("button"),
		next = document.createElement("button"),
		status = document.createElement("span")
	previous.type = next.type = "button"
	previous.textContent = "‹"
	next.textContent = "›"
	previous.setAttribute("aria-label", `Previous ${d.label} options`)
	next.setAttribute("aria-label", `Next ${d.label} options`)
	status.setAttribute("role", "status")
	navigation.append(previous, status, next)
	element.append(grid, navigation)
	const name = `cs-choice-${++groupId}`,
		disabled = Boolean(d.disabled || d.readOnly)
	let page = 0,
		capacity = choices.length || 1,
		columns = 1,
		rows = choices.length || 1,
		height = 160,
		gap = 11,
		revision = 0,
		selected = -1
	let layout: ChoiceLayout = { choices, columns, rows, height, gap }
	const radios = choices.map((choice, index) => {
		const tile = document.createElement("label"),
			radio = document.createElement("input"),
			text = document.createElement("span")
		radio.type = "radio"
		radio.name = name
		radio.value = String(index)
		radio.disabled = disabled
		radio.dataset.midiControl = key
		radio.setAttribute("aria-label", choice.label)
		radio.setAttribute("aria-posinset", String(index + 1))
		radio.setAttribute("aria-setsize", String(choices.length))
		text.textContent = choice.label
		tile.append(radio)
		const points = waveformPoints(choice)
		if (points) {
			const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"),
				path = document.createElementNS("http://www.w3.org/2000/svg", "polyline")
			svg.setAttribute("viewBox", "-2 -2 104 44")
			svg.setAttribute("aria-hidden", "true")
			path.setAttribute("points", points.map(([x, y]) => `${x * 100},${y * 40}`).join(" "))
			svg.append(path)
			tile.append(svg)
		}
		tile.append(text)
		grid.append(tile)
		radio.addEventListener(EVENT_CHANGE, () => {
			if (radio.checked && !disabled) {
				selected = index
				show()
				apply(choice.value)
			}
		})
		return radio
	})
	function show() {
		page = Math.max(0, Math.min(page, Math.ceil(choices.length / capacity) - 1))
		const start = page * capacity,
			visible = choices.slice(start, start + capacity)
		for (const [index, radio] of radios.entries()) {
			const tile = radio.parentElement!
			tile.hidden = index < start || index >= start + capacity
			tile.inert = tile.hidden
			radio.checked = index === selected
			radio.tabIndex =
				index === (selected >= start && selected < start + capacity ? selected : start)
					? 0
					: -1
		}
		navigation.hidden = choices.length <= capacity
		previous.disabled = page === 0
		next.disabled = page >= Math.ceil(choices.length / capacity) - 1
		status.textContent = `${page + 1} / ${Math.max(1, Math.ceil(choices.length / capacity))}`
		grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`
		grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`
		grid.style.height = `${height}px`
		element.style.setProperty("--cs-choice-gap", `${gap}px`)
		layout = { choices: visible, columns, rows, height, gap }
		revision++
	}
	previous.addEventListener(EVENT_CLICK, () => {
		page--
		show()
	})
	next.addEventListener(EVENT_CLICK, () => {
		page++
		show()
	})
	grid.addEventListener(EVENT_KEY_DOWN, (event) => {
		const index = radios.indexOf(event.target as HTMLInputElement)
		if (index < 0 || disabled) {
			return
		}
		let target = index
		if (["ArrowRight", "ArrowDown"].includes(event.key)) {
			target = (index + 1) % choices.length
		} else if (["ArrowLeft", "ArrowUp"].includes(event.key)) {
			target = (index + choices.length - 1) % choices.length
		} else if (event.key === "Home") {
			target = 0
		} else if (event.key === "End") {
			target = choices.length - 1
		} else {
			return
		}
		event.preventDefault()
		event.stopPropagation()
		selected = target
		page = Math.floor(target / capacity)
		show()
		radios[target].focus({ preventScroll: true })
		apply(choices[target].value)
	})
	const resize = (width: number, availableHeight: number, scale: number) => {
		const nextGap = 11 / scale,
			target = 44 / scale
		const nextColumns = Math.max(
			1,
			Math.min(
				choices.length <= 4 ? 2 : 3,
				choices.length || 1,
				Math.floor((width + nextGap) / (target + nextGap))
			)
		)
		const allRows = Math.max(1, Math.floor((availableHeight + nextGap) / (target + nextGap)))
		const paging = choices.length > nextColumns * allRows
		const nextHeight = Math.max(target, availableHeight - (paging ? target + nextGap : 0))
		const nextRows = Math.max(
			1,
			Math.min(
				Math.ceil(choices.length / nextColumns),
				Math.floor((nextHeight + nextGap) / (target + nextGap))
			)
		)
		const nextCapacity = Math.max(1, nextColumns * nextRows)
		if (
			nextCapacity === capacity &&
			nextColumns === columns &&
			nextHeight === height &&
			nextGap === gap
		) {
			return
		}
		const focused = radios.indexOf(document.activeElement as HTMLInputElement)
		columns = nextColumns
		rows = nextRows
		height = Math.max(target, nextHeight)
		gap = nextGap
		capacity = nextCapacity
		if (focused >= 0) {
			page = Math.floor(focused / capacity)
		}
		show()
	}
	const observer = new ResizeObserver(() => {
		const width = element.clientWidth
		if (width) {
			resize(width, element.clientHeight, element.getBoundingClientRect().width / width || 1)
		}
	})
	show()
	observer.observe(element)
	resize(300, 160, 1)
	return {
		element,
		get layout() {
			return layout
		},
		get revision() {
			return revision
		},
		resize,
		update(value) {
			const index = choices.findIndex(
				(choice) => JSON.stringify(choice.value) === JSON.stringify(value)
			)
			if (index === selected) {
				return
			}
			selected = index
			if (index >= 0) {
				page = Math.floor(index / capacity)
			}
			show()
		},
		destroy() {
			observer.disconnect()
		}
	}
}