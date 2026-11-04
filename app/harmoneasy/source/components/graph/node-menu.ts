import {
	EVENT_CLICK,
	EVENT_CLOSE,
	EVENT_KEY_DOWN,
	EVENT_POINTER_DOWN,
	EVENT_SUBMIT
} from "audiobus/event-constants"
import { button, element } from "./dom"

export interface NodeMenuAction {
	label: string
	className?: string
	run(): void
}

export function createNodeMenu(actions: NodeMenuAction[]) {
	const host = element("div", "node-menu"),
		panel = element("div", "node-menu-panel"),
		trigger = button("", () => setOpen(panel.hidden), "device-menu")
	trigger.innerHTML =
		'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>'
	trigger.title = "Node actions"
	trigger.setAttribute("aria-label", "Node actions")
	trigger.setAttribute("aria-expanded", "false")
	panel.id = `node-menu-${crypto.randomUUID()}`
	trigger.setAttribute("aria-controls", panel.id)
	panel.hidden = true
	const setOpen = (open: boolean) => {
		panel.hidden = !open
		trigger.setAttribute("aria-expanded", String(open))
	}
	const setActions = (actions: NodeMenuAction[]) => {
		panel.replaceChildren()
		for (const action of actions) {
			const item = button(
				action.label,
				() => {
					setOpen(false)
					trigger.focus()
					action.run()
				},
				action.className
			)
			item.title = action.label
			item.setAttribute("aria-label", action.label)
			panel.append(item)
		}
	}
	setActions(actions)
	const outside = (event: Event) => {
		if (!host.contains(event.target as Node)) {
			setOpen(false)
		}
	}
	const keydown = (event: KeyboardEvent) => {
		if (event.key === "Escape" && !panel.hidden) {
			event.stopPropagation()
			setOpen(false)
			trigger.focus()
		} else if (event.key === "ArrowDown" && event.target === trigger) {
			event.preventDefault()
			setOpen(true)
			panel.querySelector("button")?.focus()
		}
	}
	host.addEventListener(EVENT_KEY_DOWN, keydown)
	document.addEventListener(EVENT_POINTER_DOWN, outside)
	host.append(trigger, panel)
	return {
		element: host,
		setActions,
		destroy() {
			document.removeEventListener(EVENT_POINTER_DOWN, outside)
			host.remove()
		}
	}
}

export function editNodeValue(
	title: string,
	value: string,
	type: "text" | "color",
	save: (value: string) => void
) {
	const dialog = element("dialog", "node-value-dialog"),
		form = element("form"),
		label = element("label", "", title),
		input = element("input"),
		actions = element("div", "node-value-actions"),
		cancel = button("Cancel", () => dialog.close()),
		submit = element("button", "", "Save")
	dialog.setAttribute("aria-label", title)
	input.type = type
	input.value = value
	input.required = true
	input.setAttribute("aria-label", title)
	submit.type = "submit"
	label.append(input)
	actions.append(cancel, submit)
	form.append(label, actions)
	form.addEventListener(EVENT_SUBMIT, (event) => {
		event.preventDefault()
		if (!input.value.trim()) {
			return
		}
		save(input.value.trim())
		dialog.close()
	})
	dialog.addEventListener(EVENT_CLOSE, () => dialog.remove(), { once: true })
	dialog.addEventListener(EVENT_CLICK, (event) => event.stopPropagation())
	dialog.append(form)
	document.body.append(dialog)
	dialog.showModal()
	input.focus()
	if (type === "text") {
		input.select()
	}
}