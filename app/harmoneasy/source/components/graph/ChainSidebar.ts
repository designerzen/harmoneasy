import { createTransformerPicker } from "./Transformers"
import { createDevicePicker } from "./DevicePicker"
import type { ChainUIContext } from "./chain-ui-context"
import { element, button, icon, type NativeView } from "./dom"

export function createChainSidebar(context: ChainUIContext) {
	const tabs = ["Inputs", "Transformers", "Outputs"]
	const icons = ["device-input", "transformer-default", "device-output"]
	const id = `chain-sidebar-${crypto.randomUUID()}`
	const host = element("aside", "chain-sidebar nodrag nopan nowheel")
	host.setAttribute("aria-label", "Add to chain")
	host.dataset.open = "false"
	const tablist = element("div", "chain-sidebar-tabs")
	tablist.setAttribute("role", "tablist")
	tablist.setAttribute("aria-label", "Chain elements")
	tablist.setAttribute("aria-orientation", "vertical")
	let active: number | null = null,
		picker: NativeView | null = null
	const panels = tabs.map((_, index) => {
		const panel = element("div", "chain-sidebar-panel")
		panel.id = `${id}-panel-${index}`
		panel.hidden = true
		panel.setAttribute("role", "tabpanel")
		panel.setAttribute("aria-labelledby", `${id}-tab-${index}`)
		return panel
	})
	const buttons = tabs.map((label, index) => {
		const node = button("", () => open(index))
		node.id = `${id}-tab-${index}`
		node.title = `Add ${label.toLowerCase()} to chain`
		node.setAttribute("role", "tab")
		node.setAttribute("aria-controls", panels[index].id)
		node.append(
			icon(`${import.meta.env.BASE_URL}icons/${icons[index]}.svg`, label),
			element("span", "chain-sidebar-tab-label", label)
		)
		node.onkeydown = (event) => {
			const next =
				event.key === "ArrowDown"
					? (index + 1) % tabs.length
					: event.key === "ArrowUp"
						? (index + tabs.length - 1) % tabs.length
						: event.key === "Home"
							? 0
							: event.key === "End"
								? tabs.length - 1
								: null
			if (next === null) {
				return
			}
			event.preventDefault()
			open(next)
			buttons[next].focus()
		}
		return node
	})
	function update() {
		host.dataset.open = String(active !== null)
		buttons.forEach((node, index) => {
			node.setAttribute("aria-selected", String(active === index))
			node.tabIndex = (active ?? 0) === index ? 0 : -1
			panels[index].hidden = active !== index
		})
	}
	function open(index: number) {
		picker?.destroy()
		panels.forEach((panel) => panel.replaceChildren())
		active = index
		const close = button(
			"",
			() => {
				picker?.destroy()
				picker = null
				active = null
				update()
				buttons[index].focus()
			},
			"chain-sidebar-close"
		)
		close.setAttribute("aria-label", "Close sidebar")
		close.title = `Close ${tabs[index]}`
		close.innerHTML =
			'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m14 6-6 6 6 6M8 12h12" /></svg>'
		const content = element("div", "chain-sidebar-content")
		picker =
			index === 1
				? createTransformerPicker(context)
				: createDevicePicker(context, { direction: index === 0 ? "input" : "output" })
		content.append(picker.element)
		panels[index].append(close, content)
		update()
	}
	tablist.append(...buttons)
	host.append(tablist, ...panels)
	update()
	return {
		element: host,
		destroy() {
			picker?.destroy()
			host.remove()
		}
	}
}