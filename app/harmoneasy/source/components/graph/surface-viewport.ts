import type IOChain from "audiobus/io/IO-chain"
import type IOChainManager from "audiobus/io/IO-chain-manager"
import type { SurfaceState } from "control-surface/types"
import {
	EVENT_CHAINS_UPDATED,
	EVENT_CONFIGURATION_CHANGED,
	EVENT_CONTROL_SURFACE_EXPAND,
	EVENT_KEY_DOWN
} from "audiobus/events/event-constants"
import type { FocusStage, PerformanceView } from "../../services/focus-stage"
import { button, element } from "./dom"
import { mountControlSurface, removeSurface } from "./control-surfaces"

/**
 * The one fullscreen performance view: every chain's control surfaces, and the
 * Focus Stage pads when a stage is supplied (only the main window has one).
 */
export function createSurfaceViewport(
	manager: IOChainManager,
	startExpanded = false,
	includesChain: (id: string) => boolean = () => true,
	stage?: FocusStage
) {
	type Entry = { chainId: string; chain: IOChain; surface: SurfaceState }
	let entries: Entry[] = []
	let selected: Entry | undefined
	let surfaceView: ReturnType<typeof mountControlSurface> | undefined
	let previousFocus: HTMLElement | null = null
	let overflow = ""
	let view: PerformanceView | undefined
	const subscriptions = new Map<IOChain, AbortController>()
	const viewport = element("div", "node-viewport-editor surface-viewport nodrag nopan nowheel")
	viewport.setAttribute("role", "dialog")
	viewport.setAttribute("aria-modal", "true")
	const panel = element("section", "node-control-surface graph-node can-remove is-fullscreen")
	const header = element("header", "surface-viewport-header")
	const views = element("div", "surface-viewport-views")
	views.setAttribute("role", "group")
	views.setAttribute("aria-label", "Performance view")
	views.hidden = !stage
	const toolbar = element("div", "surface-titlebar")
	const content = element("div", "surface-viewport-content nodrag nopan nowheel")
	content.id = `surface-panel-${crypto.randomUUID()}`
	content.setAttribute("role", "region")
	const icon = (path: string) =>
		`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" /></svg>`
	const viewButton = (label: string, path: string, action: () => void) => {
		const control = button("", action, "surface-viewport-view")
		control.innerHTML = `${icon(path)}<span>${label}</span>`
		control.setAttribute("aria-controls", content.id)
		return control
	}
	const controlsButton = viewButton(
		"Controls",
		"M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6",
		() => {
			const entry =
				entries.find(
					(item) =>
						item.chain === selected?.chain && item.surface.id === selected?.surface.id
				) ?? preferred()
			if (entry) {
				select(entry)
			}
		}
	)
	const padsButton = viewButton("Pads", "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z", () =>
		showPads()
	)
	views.append(controlsButton, padsButton)
	const exit = button("", () => close(), "surface-viewport-exit close-icon")
	exit.title = "Return to the workspace (Esc)"
	exit.setAttribute("aria-label", "Exit fullscreen view")
	header.append(views, toolbar, exit)
	panel.append(header, content)
	viewport.append(panel)
	const syncHeader = () => {
		controlsButton.disabled = !entries.length
		controlsButton.title = entries.length ? "" : "This workspace has no control surfaces yet"
		controlsButton.setAttribute("aria-pressed", String(view === "controls"))
		padsButton.setAttribute("aria-pressed", String(view === "pads"))
		toolbar.hidden = view !== "controls"
		panel.dataset.view = view ?? ""
	}
	const leavePads = () => {
		if (view === "pads") {
			stage?.deactivate()
			stage?.element.remove()
		}
	}
	const close = () => {
		if (!view) {
			return
		}
		leavePads()
		view = undefined
		surfaceView?.destroy()
		surfaceView = undefined
		content.replaceChildren()
		viewport.remove()
		document.body.style.overflow = overflow
		previousFocus?.focus({ preventScroll: true })
	}
	/** Returns true when this call put the viewport on screen. */
	const openShell = () => {
		if (view) {
			return false
		}
		previousFocus =
			document.activeElement instanceof HTMLElement ? document.activeElement : null
		overflow = document.body.style.overflow
		document.body.style.overflow = "hidden"
		document.body.append(viewport)
		return true
	}
	const removeAction = {
		label: "Remove control surface",
		className: "device-remove",
		run: () => {
			if (selected) {
				removeSurface(selected.chain, selected.surface.id)
			}
			refresh()
		}
	}
	const preferred = () => {
		const main = (entry: Entry) => entry.surface.id === entry.chain.options.mainSurfaceId
		const active = (entry: Entry) => entry.chain === manager.activeChain
		return (
			entries.find((entry) => active(entry) && main(entry)) ??
			entries.find(active) ??
			entries.find(main) ??
			entries[0]
		)
	}
	const select = (entry: Entry) => {
		const opening = openShell()
		const changed =
			view !== "controls" ||
			selected?.chain !== entry.chain ||
			selected?.surface.id !== entry.surface.id
		leavePads()
		view = "controls"
		selected = entry
		if (changed || !surfaceView) {
			surfaceView?.destroy()
			content.replaceChildren()
			surfaceView = mountControlSurface(content, entry.chain, entry.surface.id, toolbar, () => [
				...(entries.length > 1
					? entries.map((item) => ({
							label: `Open ${item.surface.name}`,
							icon: "open",
							action: () => select(item)
						}))
					: []),
				{ ...removeAction, editOnly: true, action: removeAction.run }
			])
		}
		viewport.setAttribute("aria-label", `${entry.surface.name} controls`)
		content.setAttribute("aria-label", entry.surface.name)
		syncHeader()
		if (opening) {
			exit.focus({ preventScroll: true })
		}
	}
	const showPads = () => {
		if (!stage || view === "pads") {
			return
		}
		openShell()
		surfaceView?.destroy()
		surfaceView = undefined
		content.replaceChildren(stage.element)
		view = "pads"
		viewport.setAttribute("aria-label", "Focus Stage pads")
		content.setAttribute("aria-label", "Pads")
		syncHeader()
		stage.activate()
	}
	/** Without a requested view, open the active chain's controls, or pads when it has none. */
	const show = (requested?: PerformanceView) => {
		const entry = requested === "pads" ? undefined : preferred()
		if (entry) {
			select(entry)
		} else {
			showPads()
		}
	}
	const detachStage = stage?.attach({ show, hide: close })
	function refresh() {
		const chains = manager.entries.filter(([id]) => includesChain(id))
		entries = chains.flatMap(([chainId, chain]) =>
			(chain.options.controlSurfaces ?? []).map((surface) => ({ chainId, chain, surface }))
		)
		for (const [chain, abort] of subscriptions) {
			if (!chains.some(([, current]) => current === chain)) {
				abort.abort()
				subscriptions.delete(chain)
			}
		}
		for (const [, chain] of chains) {
			if (subscriptions.has(chain)) {
				continue
			}
			const abort = new AbortController()
			subscriptions.set(chain, abort)
			chain.addEventListener(EVENT_CONFIGURATION_CHANGED, refresh, { signal: abort.signal })
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
		if (view === "controls") {
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
		} else if (view) {
			syncHeader()
		}
	}
	const keydown = (event: KeyboardEvent) => {
		if (!view || document.querySelector("dialog[open]")) {
			return
		}
		if (event.key === "Escape") {
			if (event.isComposing) {
				return
			}
			if (
				(event.target as HTMLElement)?.closest?.(
					".he-dropdown:has(.he-dropdown-panel:not([hidden]))"
				) ||
				((event.target as HTMLElement)?.closest?.("[data-keyboard-notes]") &&
					!(event.target as HTMLElement).matches(".cs-viewport"))
			) {
				return
			}
			event.preventDefault()
			event.stopPropagation()
			close()
		}
		if (event.key === "Tab") {
			const selector =
				'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
			const collectFocusables = (root: ParentNode): HTMLElement[] => {
				const found: HTMLElement[] = []
				for (const node of root.querySelectorAll<HTMLElement>("*")) {
					if (node.matches(selector) && !node.closest("[hidden]") && node.tabIndex >= 0) {
						found.push(node)
					}
					if (node.shadowRoot) {
						found.push(...collectFocusables(node.shadowRoot))
					}
				}
				return found
			}
			const controls = collectFocusables(viewport)
			const first = controls[0],
				last = controls.at(-1)
			const active = document.activeElement
			const inside = active instanceof Node && viewport.contains(active)
			if (!inside && first) {
				event.preventDefault()
				;(event.shiftKey ? last : first)?.focus()
			} else if (event.shiftKey && active === first) {
				event.preventDefault()
				last?.focus()
			} else if (!event.shiftKey && active === last) {
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
		refresh,
		show,
		destroy() {
			close()
			detachStage?.()
			manager.removeEventListener(EVENT_CHAINS_UPDATED, refresh)
			document.removeEventListener(EVENT_KEY_DOWN, keydown, true)
			for (const abort of subscriptions.values()) {
				abort.abort()
			}
			subscriptions.clear()
		}
	}
}
