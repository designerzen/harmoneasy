import { EVENT_CLICK } from "./events"

/** Page editing actions rather than clipping them or introducing gadget scrollbars. */
export function toolPages(element: HTMLElement, label: string) {
	const actions = Array.from(element.children) as HTMLElement[]
	const navigation = document.createElement("div")
	navigation.className = "cs-tool-navigation"
	const previous = document.createElement("button"),
		next = document.createElement("button"),
		indicator = document.createElement("span")
	previous.type = next.type = "button"
	previous.textContent = "‹"
	next.textContent = "›"
	previous.setAttribute("aria-label", `Previous actions for ${label}`)
	next.setAttribute("aria-label", `Next actions for ${label}`)
	indicator.setAttribute("role", "status")
	navigation.append(previous, indicator, next)
	element.append(navigation)
	let page = 0,
		capacity = actions.length
	const show = () => {
		page = Math.min(page, Math.ceil(actions.length / capacity) - 1)
		actions.forEach((action, i) => {
			action.hidden = Math.floor(i / capacity) !== page
			action.inert = action.hidden
		})
		previous.disabled = page === 0
		next.disabled = page === Math.ceil(actions.length / capacity) - 1
		indicator.textContent = `${page + 1} / ${Math.ceil(actions.length / capacity)}`
	}
	previous.addEventListener(EVENT_CLICK, () => {
		page--
		show()
	})
	next.addEventListener(EVENT_CLICK, () => {
		page++
		show()
	})
	return {
		resize(width: number, height: number, scale: number) {
			const columns = Math.max(1, Math.floor((width * scale) / 110)),
				rows = Math.max(1, Math.floor((height * scale - 55) / 55))
			const active = actions.findIndex((action) => action === document.activeElement)
			capacity = columns * rows
			if (active >= 0) {
				page = Math.floor(active / capacity)
			}
			element.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`
			show()
		},
		reveal(action: HTMLElement) {
			const index = actions.indexOf(action)
			if (index >= 0) {
				page = Math.floor(index / capacity)
				show()
			}
		}
	}
}