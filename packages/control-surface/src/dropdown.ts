import {
	EVENT_CLICK,
	EVENT_FOCUS_IN,
	EVENT_KEY_DOWN,
	EVENT_POINTER_DOWN,
	EVENT_RESIZE
} from "./events"

const paths: Record<string, string> = {
	menu: "M4 6h16M4 12h16M4 18h16",
	swap: "M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4",
	clone: "M8 8h12v12H8zM4 16V4h12",
	rename: "m4 16-1 5 5-1L20 8l-4-4ZM14 6l4 4",
	recolor:
		"M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 0-4h-1a1 1 0 0 1 0-2h3a5 5 0 0 0 0-10ZM7 9h.01M10 6h.01M15 7h.01M6 13h.01",
	delete: "M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7",
	add: "M12 4v16M4 12h16",
	visualiser: "M3 20V4m0 16h18M6 15l4-6 4 4 6-9",
	xy: "M4 4h16v16H4zM12 7v10M7 12h10",
	open: "M4 5h6l2 3h8v12H4z",
	beat: "M3 12h4l3-8 4 16 3-8h4",
	theme: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 3v18",
	control: "M4 7h16M4 17h16M8 4v6m8 4v6"
}

/** Decorative icons never replace the visible, accessible action name. */
export function menuIcon(name: string): SVGSVGElement {
	const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg")
	icon.setAttribute("viewBox", "0 0 24 24")
	icon.setAttribute("aria-hidden", "true")
	icon.setAttribute("focusable", "false")
	const key = name.toLowerCase().split(" ")[0]
	icon.innerHTML = `<path d="${paths[key] ?? (key === "remove" ? paths.delete : paths.control)}"/>`
	return icon
}

/** Shared popup behavior; mixed form controls retain their native semantics. */
export function createDropdown(label: string, actionMenu = true, beforeOpen?: () => void) {
	const element = document.createElement("div"),
		trigger = document.createElement("button"),
		panel = document.createElement("div"),
		content = document.createElement("div"),
		abort = new AbortController()
	element.className = "he-dropdown"
	trigger.type = "button"
	trigger.title = label
	trigger.setAttribute("aria-label", label)
	trigger.append(menuIcon("menu"))
	panel.className = "he-dropdown-panel"
	content.className = "he-dropdown-items"
	panel.id = `dropdown-${crypto.randomUUID()}`
	trigger.id = `${panel.id}-trigger`
	trigger.setAttribute("aria-controls", panel.id)
	trigger.setAttribute("aria-expanded", "false")
	trigger.setAttribute("aria-haspopup", actionMenu ? "menu" : "dialog")
	panel.setAttribute("role", actionMenu ? "menu" : "dialog")
	panel.setAttribute("aria-labelledby", trigger.id)
	panel.hidden = true
	panel.tabIndex = -1
	panel.append(content)
	element.append(trigger, panel)
	let search = "",
		searchedAt = 0
	const controls = () =>
		[
			...content.querySelectorAll<HTMLElement>(
				"button:not(:disabled),select:not(:disabled),input:not(:disabled),[tabindex='0']"
			)
		].filter(
			(item) => !item.closest("[hidden]") && item.getAttribute("aria-disabled") !== "true"
		)
	const position = () => {
		panel.style.removeProperty("--dropdown-height")
		const anchor = trigger.getBoundingClientRect(),
			rect = panel.getBoundingClientRect(),
			gap = 12
		const left = Math.max(
			8,
			Math.min(anchor.right - rect.width, window.innerWidth - rect.width - 8)
		)
		const below = window.innerHeight - anchor.bottom - gap - 8,
			above = anchor.top - gap - 8
		const flipped = below < Math.min(rect.height, 240) && above > below
		panel.dataset.side = flipped ? "above" : "below"
		panel.style.left = `${left}px`
		panel.style.top = flipped ? "auto" : `${anchor.bottom + gap}px`
		panel.style.bottom = flipped ? `${window.innerHeight - anchor.top + gap}px` : "auto"
		panel.style.setProperty("--dropdown-height", `${Math.max(44, flipped ? above : below)}px`)
		panel.style.setProperty(
			"--dropdown-pointer",
			`${Math.max(16, Math.min(rect.width - 16, anchor.left + anchor.width / 2 - left))}px`
		)
	}
	const close = (restore = false) => {
		if (panel.hidden) {
			return
		}
		if (typeof panel.hidePopover === "function" && panel.hasAttribute("popover")) {
			panel.hidePopover()
		}
		panel.hidden = true
		trigger.setAttribute("aria-expanded", "false")
		if (restore) {
			trigger.focus({ preventScroll: true })
		}
	}
	const open = (last = false) => {
		search = ""
		beforeOpen?.()
		panel.hidden = false
		trigger.setAttribute("aria-expanded", "true")
		if (typeof panel.showPopover === "function") {
			panel.setAttribute("popover", "manual")
			panel.showPopover()
		}
		position()
		const items = controls()
		if (actionMenu) {
			items.forEach((item) => {
				item.setAttribute("role", "menuitem")
				item.tabIndex = -1
			})
		}
		;((last ? items.at(-1) : items[0]) ?? panel).focus()
	}
	const listen = { signal: abort.signal }
	trigger.addEventListener(EVENT_CLICK, () => (panel.hidden ? open() : close(true)), listen)
	element.addEventListener(
		EVENT_KEY_DOWN,
		(event) => {
			if (event.isComposing) {
				return
			}
			if (event.key === "Escape" && !panel.hidden) {
				event.preventDefault()
				event.stopPropagation()
				close(true)
				return
			}
			if (event.target === trigger && ["ArrowDown", "ArrowUp"].includes(event.key)) {
				event.preventDefault()
				event.stopPropagation()
				open(event.key === "ArrowUp")
				return
			}
			if (panel.hidden || !panel.contains(event.target as Node)) {
				return
			}
			event.stopPropagation()
			if (!actionMenu) {
				return
			}
			if (event.key === "Tab") {
				close(true)
				return
			}
			const items = controls(),
				index = items.indexOf(document.activeElement as HTMLElement)
			let next: HTMLElement | undefined
			if (event.key === "ArrowDown") {
				next = items[(index + 1) % items.length]
			} else if (event.key === "ArrowUp") {
				next = items[(index - 1 + items.length) % items.length]
			} else if (event.key === "Home") {
				next = items[0]
			} else if (event.key === "End") {
				next = items.at(-1)
			} else if (
				event.key.length === 1 &&
				event.key !== " " &&
				!event.ctrlKey &&
				!event.metaKey &&
				!event.altKey
			) {
				const now = Date.now()
				search = now - searchedAt > 700 ? event.key : search + event.key
				searchedAt = now
				const prefix = [...search].every((char) => char === search[0]) ? search[0] : search
				next = [...items.slice(index + 1), ...items.slice(0, index + 1)].find((item) =>
					item.textContent?.trim().toLowerCase().startsWith(prefix.toLowerCase())
				)
			}
			if (next) {
				event.preventDefault()
				event.stopPropagation()
				next.focus()
			}
		},
		listen
	)
	for (const type of [EVENT_POINTER_DOWN, EVENT_FOCUS_IN]) {
		document.addEventListener(
			type,
			(event) => {
				if (!element.contains(event.target as Node)) {
					close()
				}
			},
			listen
		)
	}
	window.addEventListener(
		EVENT_RESIZE,
		() => {
			if (!panel.hidden) {
				position()
			}
		},
		listen
	)
	return {
		element,
		trigger,
		panel,
		content,
		open,
		close,
		destroy() {
			close()
			abort.abort()
			element.remove()
		}
	}
}