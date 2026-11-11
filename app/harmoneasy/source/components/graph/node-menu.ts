import { createDropdown, menuIcon } from "control-surface/dropdown"
import "control-surface/dropdown.css"
import { EVENT_CLICK, EVENT_CLOSE, EVENT_SUBMIT } from "audiobus/events/event-constants"
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
	let currentActions: NodeMenuAction[] = []
	const setActions = (actions: NodeMenuAction[]) => {
		const unchanged =
			actions.length === currentActions.length &&
			actions.every((action, index) => {
				const previous = currentActions[index]
				return (
					action.label === previous.label &&
					action.icon === previous.icon &&
					action.className === previous.className &&
					action.disabled === previous.disabled
				)
			})
		currentActions = actions
		if (unchanged) {
			return
		}
		menu.close(menu.panel.contains(document.activeElement))
		menu.content.replaceChildren()
		for (const [index, action] of actions.entries()) {
			const item = button(
				action.label,
				() => {
					menu.close(true)
					currentActions[index].run()
				},
				action.className
			)
			item.tabIndex = -1
			item.title = action.label
			item.setAttribute("aria-label", action.label)
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