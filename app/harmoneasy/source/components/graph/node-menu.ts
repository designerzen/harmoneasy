import { createDropdown, menuIcon } from "control-surface/dropdown"
import "control-surface/dropdown.css"
import { EVENT_CLICK, EVENT_CLOSE, EVENT_SUBMIT } from "audiobus/event-constants"
import { button, element } from "./dom"

export interface NodeMenuAction {
	label: string
	className?: string
	icon?: string
	disabled?: boolean
	run(): void
}

export function createNodeMenu(actions: NodeMenuAction[]) {
	const menu = createDropdown("Node actions")
	menu.element.classList.add("node-menu")
	menu.trigger.classList.add("device-menu")
	menu.panel.classList.add("node-menu-panel")
	const setActions = (actions: NodeMenuAction[]) => {
		menu.close(menu.panel.contains(document.activeElement))
		menu.content.replaceChildren()
		for (const action of actions) {
			const item = button(
				action.label,
				() => {
					menu.close(true)
					action.run()
				},
				action.className
			)
			item.tabIndex = -1
			item.disabled = action.disabled ?? false
			item.setAttribute("role", "menuitem")
			item.prepend(menuIcon(action.icon ?? action.label))
			menu.content.append(item)
		}
	}
	setActions(actions)
	return { element: menu.element, setActions, destroy: menu.destroy }
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