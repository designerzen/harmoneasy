import type IOChain from "audiobus/io/IO-chain"
import type IOChainManager from "audiobus/io/IO-chain-manager"
import type { SurfaceState } from "control-surface/types"
import {
	EVENT_CHAINS_UPDATED,
	EVENT_CONTROL_SURFACE_EXPAND,
	EVENT_CONTROL_SURFACE_MINIMISE,
	EVENT_KEY_DOWN
} from "audiobus/event-constants"
import { button, element } from "./dom"
import { mountControlSurface, removeSurface } from "./control-surfaces"

/** One native viewport for every surface, including surfaces in other preset chains. */
export function createSurfaceViewport(manager: IOChainManager, startExpanded = false) {
	type Entry = { chainId: string; chain: IOChain; surface: SurfaceState }
	let entries: Entry[] = []
	let selected: Entry | undefined
	let view: ReturnType<typeof mountControlSurface> | undefined
	let previousFocus: HTMLElement | null = null
	let overflow = ""
	let open = false
	let tabSignature = ""
	const subscriptions = new Map<IOChain, AbortController>()
	const viewport = element("div", "node-viewport-editor surface-viewport nodrag nopan nowheel")
	viewport.setAttribute("role", "dialog")
	viewport.setAttribute("aria-modal", "true")
	const panel = element("section", "node-control-surface graph-node can-remove is-fullscreen")
	const header = element("header", "device-node-header node-actions")
	const controls = element("div", "device-title-controls nodrag nopan")
	const left = element("div", "node-actions-left")
	const right = element("div", "node-actions-right")
	const title = element("h6")
	const tabs = element("div", "surface-viewport-tabs")
	tabs.setAttribute("role", "tablist")
	tabs.setAttribute("aria-label", "Control surfaces")
	const content = element("div", "surface-viewport-content nodrag nopan nowheel")
	content.id = `surface-panel-${crypto.randomUUID()}`
	content.setAttribute("role", "tabpanel")
	const gadget = (label: string, className: string, path: string, action: () => void) => {
		const control = button("", action, className)
		control.title = label
		control.setAttribute("aria-label", label)
		control.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" /></svg>`
		return control
	}
	const close = () => {
		if (!open) {
			return
		}
		open = false
		view?.destroy()
		view = undefined
		content.replaceChildren()
		viewport.remove()
		document.body.style.overflow = overflow
		previousFocus?.focus({ preventScroll: true })
	}
	const remove = gadget("Remove control surface", "device-remove", "m6 6 12 12M18 6 6 18", () => {
		if (selected) {
			removeSurface(selected.chain, selected.surface.id)
		}
		refresh()
	})
	const minimise = gadget("Minimise control surface", "device-minimise", "M5 12h14", () => {
		if (selected) {
			selected.chain.dispatchEvent(
				new CustomEvent(EVENT_CONTROL_SURFACE_MINIMISE, { detail: selected.surface.id })
			)
		}
		close()
	})
	minimise.setAttribute("aria-expanded", "true")
	const expand = gadget(
		"Exit fullscreen control surface",
		"device-expand",
		"M3 9h6V3m6 0v6h6M3 15h6v6m6 0v-6h6",
		close
	)
	expand.setAttribute("aria-expanded", "true")
	left.append(remove)
	right.append(minimise, expand)
	controls.append(left, right)
	header.append(controls, title)
	panel.append(header, tabs, content)
	viewport.append(panel)
	const select = (entry: Entry) => {
		const opening = !open
		const changed = selected?.chain !== entry.chain || selected?.surface.id !== entry.surface.id
		selected = entry
		if (!open) {
			previousFocus =
				document.activeElement instanceof HTMLElement ? document.activeElement : null
			overflow = document.body.style.overflow
			document.body.style.overflow = "hidden"
			document.body.append(viewport)
			open = true
		}
		if (changed || !view) {
			view?.destroy()
			content.replaceChildren()
			view = mountControlSurface(content, entry.chain, entry.surface.id)
		}
		title.textContent = entry.surface.name
		viewport.setAttribute("aria-label", `${entry.surface.name} controls`)
		content.setAttribute("aria-label", entry.surface.name)
		for (const [index, tab] of [
			...tabs.querySelectorAll<HTMLButtonElement>("[role=tab]")
		].entries()) {
			const active = entries[index] === entry
			tab.setAttribute("aria-selected", String(active))
			tab.tabIndex = active ? 0 : -1
		}
		if (opening) {
			expand.focus({ preventScroll: true })
		}
	}
	function refresh() {
		entries = manager.entries.flatMap(([chainId, chain]) =>
			(chain.options.controlSurfaces ?? []).map((surface) => ({ chainId, chain, surface }))
		)
		for (const [chain, abort] of subscriptions) {
			if (!manager.entries.some(([, current]) => current === chain)) {
				abort.abort()
				subscriptions.delete(chain)
			}
		}
		for (const [, chain] of manager.entries) {
			if (subscriptions.has(chain)) {
				continue
			}
			const abort = new AbortController()
			subscriptions.set(chain, abort)
			chain.addEventListener(
				EVENT_CONTROL_SURFACE_EXPAND,
				(event) => {
					refresh()
					const entry = entries.find(
						(item) =>
							item.chain === chain &&
							item.surface.id === (event as CustomEvent<string>).detail
					)
					if (entry) {
						select(entry)
					}
				},
				{ signal: abort.signal }
			)
		}
		const signature = JSON.stringify(
			entries.map(({ chainId, surface, chain }) => [
				chainId,
				surface.id,
				surface.name,
				chain.options.name
			])
		)
		if (signature !== tabSignature) {
			tabSignature = signature
			tabs.replaceChildren(
				...entries.map((entry, index) => {
					const tab = button(
						`${entry.chain.options.name ?? "Chain"} · ${entry.surface.name}`,
						() => select(entries[index])
					)
					tab.setAttribute("role", "tab")
					tab.setAttribute("aria-controls", content.id)
					tab.onkeydown = (event) => {
						const next =
							event.key === "ArrowRight"
								? (index + 1) % entries.length
								: event.key === "ArrowLeft"
									? (index + entries.length - 1) % entries.length
									: event.key === "Home"
										? 0
										: event.key === "End"
											? entries.length - 1
											: null
						if (next === null) {
							return
						}
						event.preventDefault()
						select(entries[next])
						tabs.querySelectorAll<HTMLButtonElement>("button")[next]?.focus()
					}
					return tab
				})
			)
		}
		tabs.hidden = entries.length < 2
		if (open) {
			const next =
				entries.find(
					(entry) =>
						entry.chain === selected?.chain && entry.surface.id === selected?.surface.id
				) ?? entries[0]
			if (next) {
				select(next)
			} else {
				close()
			}
		}
	}
	const keydown = (event: KeyboardEvent) => {
		if (!open || document.querySelector("dialog[open]")) {
			return
		}
		if (event.key === "Escape") {
			event.stopPropagation()
			close()
		}
		if (event.key === "Tab") {
			const controls = [
				...viewport.querySelectorAll<HTMLElement>(
					"button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex='0']"
				)
			].filter((control) => !control.closest("[hidden]") && control.tabIndex >= 0)
			const first = controls[0],
				last = controls.at(-1)
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault()
				last?.focus()
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault()
				first?.focus()
			}
		}
	}
	manager.addEventListener(EVENT_CHAINS_UPDATED, refresh)
	document.addEventListener(EVENT_KEY_DOWN, keydown, true)
	refresh()
	if (startExpanded && entries.length) {
		select(
			entries.find((entry) => entry.surface.id === entry.chain.options.mainSurfaceId) ??
				entries[0]
		)
	}
	return {
		destroy() {
			close()
			manager.removeEventListener(EVENT_CHAINS_UPDATED, refresh)
			document.removeEventListener(EVENT_KEY_DOWN, keydown, true)
			for (const abort of subscriptions.values()) {
				abort.abort()
			}
			subscriptions.clear()
		}
	}
}