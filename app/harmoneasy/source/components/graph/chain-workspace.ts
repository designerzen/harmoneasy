import { createDropdown } from "control-surface/dropdown"
import "control-surface/dropdown.css"
import type IOChain from "audiobus/io/IO-chain"
import type IOChainManager from "audiobus/io/IO-chain-manager"
import {
	EVENT_CHAINS_UPDATED,
	EVENT_CHAIN_ACTIVE_CHANGED,
	EVENT_KEY_DOWN
} from "audiobus/events/event-constants"
import { DEFAULT_LAYOUT_MODE } from "./options"
import { createIOChainManagerUI } from "./IOChainManagerUI"
import { createPresets } from "./Presets"
import { createChainName } from "./ChainName"
import { createChainSidebar } from "./ChainSidebar"
import { element, button, option } from "./dom"
import type { ChainUIContext } from "./chain-ui-context"
import { createSurfaceViewport } from "./surface-viewport"
import { installSurfaceTriggers } from "./control-surface-triggers"
import {
	SURFACE_FRAGMENT_KEY,
	importSharedSurface,
	portableComponents,
	readSharedSurface
} from "./control-surface-share"
import { controlComponents } from "./control-surfaces"

export interface GraphView {
	update(isFront: boolean, focusRequest: number): void
	destroy(): void
}
/** The note timeline shares the chain tabs and panes under this id. */
const TIMELINE = "timeline"
type DropSide = "left" | "right" | "top" | "bottom" | "center"
/** Which side of the workspace a drag is over: edges split it, the middle replaces it. */
function dropSideAt(event: DragEvent, rect: DOMRect): DropSide {
	const x = (event.clientX - rect.left) / (rect.width || 1),
		y = (event.clientY - rect.top) / (rect.height || 1)
	const edge = Math.min(x, 1 - x, y, 1 - y)
	if (edge > 0.25) {
		return "center"
	}
	return edge === x ? "left" : edge === 1 - x ? "right" : edge === y ? "top" : "bottom"
}
/** Which tabs fill the panes, so a reload puts every window back where it was. */
export interface WorkspaceLayout {
	panes: string[]
	pinned?: string[]
	tabOrder?: string[]
	focused: number
	split: "row" | "column"
	solo: string | null
}
export interface WorkspaceLayoutStore {
	saved?: unknown
	save?: (layout: WorkspaceLayout) => void
}
/** Saved layouts come from the URL, so anything malformed is ignored. */
function readLayout(value: unknown): WorkspaceLayout | null {
	const layout = value as Partial<WorkspaceLayout> | null
	if (
		!layout ||
		!Array.isArray(layout.panes) ||
		!layout.panes.length ||
		!layout.panes.every((id) => typeof id === "string")
	) {
		return null
	}
	return {
		panes: [...layout.panes],
		...(Array.isArray(layout.pinned) && layout.pinned.every((id) => typeof id === "string")
			? { pinned: [...layout.pinned] }
			: {}),
		...(Array.isArray(layout.tabOrder) && layout.tabOrder.every((id) => typeof id === "string")
			? { tabOrder: [...new Set(layout.tabOrder)] }
			: {}),
		focused:
			Number.isInteger(layout.focused) &&
			layout.focused! >= 0 &&
			layout.focused! < layout.panes.length
				? layout.focused!
				: 0,
		split: layout.split === "column" ? "column" : "row",
		solo: typeof layout.solo === "string" ? layout.solo : null
	}
}
/** A surface link adds that surface to the active chain once, then leaves the URL clean. */
function openSharedSurface(manager: IOChainManager): boolean {
	const shared = readSharedSurface()
	const chain = manager.activeChain ?? manager.entries[0]?.[1]
	if (!shared || !chain) {
		return false
	}
	const url = new URL(window.location.href)
	const fragment = new URLSearchParams(url.hash.slice(1))
	fragment.delete(SURFACE_FRAGMENT_KEY)
	url.hash = fragment.toString()
	history.replaceState(history.state, "", url)
	return Boolean(importSharedSurface(chain, shared, portableComponents(controlComponents(chain))))
}
export function createChainWorkspace(
	container: HTMLElement,
	manager: IOChainManager,
	mountGraph: (host: HTMLElement, context: ChainUIContext) => GraphView,
	startWithSurfaces = false,
	layoutStore: WorkspaceLayoutStore = {}
) {
	const host = element("div", "chains-workspace chains-stacked")
	container.append(host)
	const navigation = document.getElementById("chain-navigation")
	const settings = document.getElementById("graph-layout-settings")
	const tabs = element("div")
	tabs.setAttribute("role", "tablist")
	tabs.setAttribute("aria-label", "Chains")
	const newChain = createIOChainManagerUI(manager)
	if (navigation) {
		navigation.append(tabs, newChain.element)
	} else {
		host.append(newChain.element)
	}
	const warnings = element("div"),
		empty = element("p", "", "No IOChains. Add a chain to start routing inputs to outputs.")
	warnings.style.display = "contents"
	host.append(warnings, empty)
	const timeline = document.getElementById("recordings")
	const timelineHome = timeline && {
		parent: timeline.parentElement,
		next: timeline.nextSibling,
		label: timeline.getAttribute("aria-label")
	}
	if (timeline) {
		timeline.classList.add("timeline-pane")
		timeline.tabIndex = -1
		timeline.setAttribute("role", "tabpanel")
		timeline.setAttribute("aria-labelledby", `chain-tab-${TIMELINE}`)
		timeline.removeAttribute("aria-label")
		host.append(timeline)
	}
	const dropZone = element("div", "pane-drop-zone")
	dropZone.hidden = true
	dropZone.append(element("div", "pane-drop-preview"))
	host.append(dropZone)
	const restored = readLayout(layoutStore.saved)
	// Panes split side by side ("row") or stacked ("column").
	let panes: string[] = restored?.panes ?? (manager.activeChainId ? [manager.activeChainId] : []),
		pinned = new Set(restored?.pinned ?? []),
		tabOrder = restored?.tabOrder ?? null,
		focused = restored?.focused ?? 0,
		split = restored?.split ?? "row",
		dragging: string | null = null,
		tabDrop: HTMLElement | null = null,
		solo = restored?.solo ?? null,
		savedLayout = JSON.stringify(restored),
		focusRequest = 0,
		scrollFrame: number | null = null,
		overflow: string | null = null
	const views = new Map<string, ReturnType<typeof createPanel>>()
	const paneIds = () => {
		const ids = [...manager.entries.map(([id]) => id), ...(timeline ? [TIMELINE] : [])]
		return tabOrder
			? [
					...tabOrder.filter((id) => ids.includes(id)),
					...ids.filter((id) => !tabOrder!.includes(id))
				]
			: ids
	}
	/** Focuses an existing pane or replaces an unpinned pane, keeping every pin visible. */
	const show = (id: string) => {
		const index = panes.indexOf(id)
		if (index >= 0) {
			focused = index
		} else {
			const available = pinned.has(panes[focused])
				? panes.findIndex((pane) => !pinned.has(pane))
				: focused
			focused = available < 0 ? panes.length : available
			panes[focused] = id
		}
	}
	const togglePin = (id: string) => {
		solo = null
		if (pinned.delete(id)) {
			if (panes.length > 1) {
				const front = panes[focused]
				panes = panes.filter((pane) => pane !== id)
				focused = panes.includes(front)
					? panes.indexOf(front)
					: Math.min(focused, panes.length - 1)
			}
		} else {
			pinned.add(id)
			if (!panes.includes(id)) {
				panes.push(id)
			}
			focused = panes.indexOf(id)
		}
		focusRequest++
		render()
		document.getElementById(`chain-pin-${id}`)?.focus({ preventScroll: true })
	}
	const focus = (id: string) => {
		show(id)
		focusRequest++
		render()
		if (scrollFrame !== null) {
			cancelAnimationFrame(scrollFrame)
		}
		scrollFrame = requestAnimationFrame(() => {
			scrollFrame = null
			const panel = pinned.size ? host : id === TIMELINE ? timeline : views.get(id)?.element
			panel?.scrollIntoView?.({ block: "start", inline: "nearest" })
		})
	}
	const toggleSolo = (id: string) => {
		show(id)
		solo = solo === id ? null : id
		render()
	}
	/** Docks a dragged tab at a screen edge while retaining pinned panes. */
	const dock = (id: string, side: DropSide) => {
		solo = null
		const current = panes[focused]
		const other =
			current !== id
				? current
				: (panes.find((pane) => pane !== id) ?? paneIds().find((pane) => pane !== id))
		if (side === "center" || !other) {
			panes = [id]
			focused = 0
		} else {
			const first = side === "left" || side === "top"
			split = side === "left" || side === "right" ? "row" : "column"
			panes = first ? [id, other] : [other, id]
			focused = first ? 0 : 1
		}
		for (const pin of pinned) {
			if (!panes.includes(pin)) {
				panes.push(pin)
			}
		}
		focusRequest++
		render()
	}
	const clearTabDrop = () => {
		if (tabDrop) {
			delete tabDrop.dataset.reorder
			tabDrop = null
		}
	}
	const endDrag = () => {
		dragging = null
		clearTabDrop()
		dropZone.hidden = true
		delete dropZone.dataset.side
	}
	const reorderTab = (id: string, target: string, after: boolean) => {
		const ids = paneIds()
		if (id === target || !ids.includes(id) || !ids.includes(target)) {
			return
		}
		const order = ids.filter((tabId) => tabId !== id)
		order.splice(order.indexOf(target) + Number(after), 0, id)
		if (order.every((tabId, index) => tabId === ids[index])) {
			return
		}
		tabOrder = order
		render()
		document.getElementById(`chain-tab-${id}`)?.focus({ preventScroll: true })
	}
	dropZone.ondragover = (event) => {
		if (!dragging) {
			return
		}
		event.preventDefault()
		clearTabDrop()
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = "move"
		}
		dropZone.dataset.side = dropSideAt(event, dropZone.getBoundingClientRect())
	}
	dropZone.ondragleave = (event) => {
		if (!dropZone.contains(event.relatedTarget as Node | null)) {
			delete dropZone.dataset.side
		}
	}
	dropZone.ondrop = (event) => {
		event.preventDefault()
		if (dragging) {
			dock(dragging, dropSideAt(event, dropZone.getBoundingClientRect()))
		}
		endDrag()
	}
	const removeChain = (id: string) => {
		const entries = manager.entries
		const index = entries.findIndex(([key]) => key === id)
		if (index < 0) {
			return
		}
		const chain = entries[index][1]
		if (!window.confirm(`Remove “${chain.options.name ?? `Chain ${index + 1}`}”?`)) {
			return
		}
		const nextId = entries[index + 1]?.[0] ?? entries[index - 1]?.[0] ?? null
		if (panes[focused] === id && nextId && !panes.includes(nextId)) {
			panes[focused] = nextId
		}
		manager.removeChain(id)
		const front = panes[focused]
		if (front) {
			document.getElementById(`chain-tab-${front}`)?.focus()
		} else {
			navigation?.querySelector<HTMLButtonElement>("button")?.focus()
		}
	}
	function createPanel(chainId: string, chain: IOChain) {
		const context = { chain, chainId, manager }
		const panel = element("section")
		panel.id = `iochain-${chainId}`
		panel.dataset.midiScope = chainId
		panel.tabIndex = -1
		panel.setAttribute("role", "tabpanel")
		panel.setAttribute("aria-labelledby", `chain-tab-${chainId}`)
		const toolbar = element("header", "chain-toolbar")
		const identity = element("div", "chain-identity")
		const power = button(
			"",
			() => chain.setActive(!chain.isActive),
			"chain-power chain-icon-button"
		)
		power.innerHTML =
			'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v10M6 5a9 9 0 1 0 12 0" /></svg>'
		const powerText = element("span")
		power.append(powerText)
		const name = createChainName(chain)
		identity.append(power, name.element)
		const presets = createPresets(chain, manager)
		const actions = element("div", "chain-actions")
		const action = createDropdown("Chain actions")
		action.trigger.append("Actions")
		const actionOption = (text: string, value: string, path: string) => {
			const item = button("", () => {
				action.close(true)
				runAction(value)
			})
			item.tabIndex = -1
			item.setAttribute("role", "menuitem")
			if (value === "delete") {
				item.className = "device-remove"
			}
			item.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" /></svg>`
			item.append(element("span", "", text))
			return item
		}
		const soloOption = actionOption("Solo", "solo", "M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6")
		const horizontal = actionOption(
				"Horizontal layout",
				"horizontal",
				"M3 4h6v16H3zM15 4h6v16h-6zM9 12h6"
			),
			vertical = actionOption(
				"Vertical layout",
				"vertical",
				"M4 3h16v6H4zM4 15h16v6H4zM12 9v6"
			)
		action.content.append(
			actionOption(
				"Save as a preset",
				"save-preset",
				"M5 3h12l4 4v14H3V3h2ZM7 3v6h10V3M7 21v-8h10v8"
			),
			actionOption("Clone chain", "clone", "M9 9h12v12H9zM15 9V3H3v12h6"),
			soloOption,
			horizontal,
			vertical,
			actionOption(
				"Delete chain",
				"delete",
				"M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"
			)
		)
		const runAction = (value: string) => {
			if (value === "horizontal" || value === "vertical") {
				chain.setGraphOptions({ graphLayout: value, positions: {} })
			} else if (value === "clone") {
				void manager.cloneChain(chainId)
			} else if (value === "delete") {
				removeChain(chainId)
			} else if (value === "solo") {
				toggleSolo(chainId)
			} else if (value === "save-preset") {
				presets.openSave()
			}
		}
		actions.append(action.element)
		const expand = button("", () => toggleSolo(chainId), "chain-solo-toggle chain-icon-button")
		expand.innerHTML =
			'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path /></svg>'
		toolbar.append(identity, presets.element, actions, expand)
		const graph = element("div", "chain-graph")
		const sidebar = createChainSidebar(context)
		const canvas = element("div", "chain-graph-canvas")
		graph.append(sidebar.element, canvas)
		panel.append(toolbar, graph)
		host.append(panel)
		const graphView = mountGraph(canvas, context)
		const layoutLabel = element("label")
		layoutLabel.dataset.midiScope = `${chainId}:layout`
		const layoutName = document.createTextNode("")
		const layoutSelect = element("select")
		layoutSelect.append(option("Vertical", "vertical"), option("Horizontal", "horizontal"))
		layoutSelect.onchange = () =>
			chain.setGraphOptions({
				graphLayout: layoutSelect.value as "horizontal" | "vertical",
				positions: {}
			})
		layoutLabel.append(layoutName, layoutSelect)
		return {
			element: panel,
			chain,
			layoutLabel,
			update(index: number) {
				const isFront = (solo ?? panes[focused]) === chainId,
					isSolo = solo === chainId
				panel.className = `chain-panel ${chain.isActive ? "active" : "inactive"} ${isFront ? "chain-front" : ""} ${isSolo ? "chain-solo" : ""}`
				panel.hidden = solo ? !isSolo : !panes.includes(chainId)
				panel.inert = panel.hidden
				placePane(panel, chainId)
				const chainLabel = chain.options.name ?? `Chain ${index + 1}`
				power.title = chain.isActive
					? "Turn chain off"
					: "Turn chain on — settings are still editable while off"
				power.setAttribute("aria-label", `${chain.isActive ? "On" : "Off"}: ${chainLabel}`)
				power.setAttribute("aria-pressed", String(chain.isActive))
				powerText.textContent = chain.isActive ? "On" : "Off"
				name.update()
				soloOption.querySelector("span")!.textContent = isSolo ? "Exit Solo" : "Solo"
				const mode = chain.options.graphLayout ?? DEFAULT_LAYOUT_MODE
				horizontal.disabled = mode === "horizontal"
				vertical.disabled = mode === "vertical"
				expand.title = isSolo ? "Exit fullscreen chain" : "Expand chain"
				expand.setAttribute("aria-label", expand.title)
				expand.setAttribute("aria-expanded", String(isSolo))
				expand
					.querySelector("path")!
					.setAttribute(
						"d",
						isSolo
							? "M3 9h6V3m6 0v6h6M3 15h6v6m6 0v-6h6"
							: "M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6"
					)
				layoutName.textContent = `${chainLabel} layout`
				layoutSelect.value = mode
				graphView.update(!panel.hidden && !graph.hidden, isFront ? focusRequest : 0)
			},
			destroy() {
				graphView.destroy()
				sidebar.destroy()
				presets.destroy()
				action.destroy()
				layoutLabel.remove()
				panel.remove()
			}
		}
	}
	function placePane(panel: HTMLElement, id: string) {
		const index = panes.indexOf(id)
		panel.dataset.pane = !solo && panes.length > 1 && index >= 0 ? String(index) : ""
		panel.style.setProperty("--pane-position", String(index + 1))
	}
	function createTab(id: string, label: string, controls: string, ids: string[]) {
		const tab = element("span", "chain-tab")
		tab.setAttribute("role", "presentation")
		const dropAfter = (event: DragEvent) => {
			const rect = tab.getBoundingClientRect()
			return event.clientX >= rect.left + rect.width / 2
		}
		tab.ondragover = (event) => {
			if (!dragging || dragging === id) {
				clearTabDrop()
				return
			}
			event.preventDefault()
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = "move"
			}
			clearTabDrop()
			tabDrop = tab
			tab.dataset.reorder = dropAfter(event) ? "after" : "before"
		}
		tab.ondragleave = (event) => {
			if (tabDrop === tab && !tab.contains(event.relatedTarget as Node | null)) {
				clearTabDrop()
			}
		}
		tab.ondrop = (event) => {
			if (!dragging) {
				return
			}
			event.preventDefault()
			const source = dragging
			endDrag()
			reorderTab(source, id, dropAfter(event))
		}
		const pin = button("", () => togglePin(id), "chain-tab-pin")
		pin.id = `chain-pin-${id}`
		pin.title = `${pinned.has(id) ? "Unpin" : "Pin"} ${label}`
		pin.setAttribute("aria-label", pin.title)
		pin.setAttribute("aria-pressed", String(pinned.has(id)))
		pin.innerHTML =
			'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 3 5 5-4 1-3 5v3l-7-7h3l5-3zM3 21l7-7" /></svg>'
		const select = button(label, () => focus(id))
		select.id = `chain-tab-${id}`
		select.setAttribute("role", "tab")
		select.setAttribute("aria-controls", controls)
		select.setAttribute("aria-selected", String(panes[focused] === id))
		select.toggleAttribute("data-shown", panes.includes(id))
		select.tabIndex = panes[focused] === id ? 0 : -1
		select.title =
			"Drag to reorder tabs or to a side of the workspace to split it. Alt+Shift+Left/Right to reorder."
		select.setAttribute("aria-keyshortcuts", "Alt+Shift+ArrowLeft Alt+Shift+ArrowRight")
		select.draggable = true
		select.ondragstart = (event) => {
			endDrag()
			dragging = id
			event.dataTransfer?.setData("text/plain", label)
			if (event.dataTransfer) {
				event.dataTransfer.effectAllowed = "move"
			}
			dropZone.hidden = false
		}
		select.ondragend = endDrag
		select.onkeydown = (event) => {
			const index = ids.indexOf(id)
			if (
				event.altKey &&
				event.shiftKey &&
				(event.key === "ArrowLeft" || event.key === "ArrowRight")
			) {
				event.preventDefault()
				const after = event.key === "ArrowRight"
				const target = ids[index + (after ? 1 : -1)]
				if (target) {
					reorderTab(id, target, after)
				}
				return
			}
			const next =
				event.key === "ArrowRight"
					? (index + 1) % ids.length
					: event.key === "ArrowLeft"
						? (index + ids.length - 1) % ids.length
						: event.key === "Home"
							? 0
							: event.key === "End"
								? ids.length - 1
								: null
			if (next === null) {
				return
			}
			event.preventDefault()
			focus(ids[next])
			document.getElementById(`chain-tab-${ids[next]}`)?.focus({ preventScroll: true })
		}
		tab.append(pin, select)
		return tab
	}
	function render() {
		const entries = manager.entries
		const ids = paneIds()
		if (tabOrder) {
			tabOrder = ids
		}
		const front = panes[focused]
		pinned = new Set([...pinned].filter((id) => ids.includes(id)))
		panes = panes.filter((id, index) => ids.includes(id) && panes.indexOf(id) === index)
		for (const pin of pinned) {
			if (!panes.includes(pin)) {
				panes.push(pin)
			}
		}
		if (!panes.length && ids.length) {
			panes = [ids[0]]
		}
		focused = panes.includes(front)
			? panes.indexOf(front)
			: Math.max(0, Math.min(focused, panes.length - 1))
		if (!entries.some(([id]) => id === solo)) {
			solo = null
		}
		if (solo && overflow === null) {
			overflow = document.body.style.overflow
			document.body.style.overflow = "hidden"
		}
		if (!solo && overflow !== null) {
			document.body.style.overflow = overflow
			overflow = null
		}
		for (const [id, view] of views) {
			if (!entries.some(([chainId, chain]) => chainId === id && chain === view.chain)) {
				view.destroy()
				views.delete(id)
			}
		}
		const tabElements = new Map<string, HTMLElement>()
		for (const [index, [id, chain]] of entries.entries()) {
			let view = views.get(id)
			if (!view) {
				view = createPanel(id, chain)
				views.set(id, view)
			}
			view.update(index)
			const tab = createTab(
				id,
				chain.options.name ?? `Chain ${index + 1}`,
				view.element.id,
				ids
			)
			const remove = button("×", () => removeChain(id), "chain-tab-remove")
			remove.title = "Remove chain"
			remove.setAttribute(
				"aria-label",
				`Remove ${chain.options.name ?? `Chain ${index + 1}`}`
			)
			tab.append(remove)
			tabElements.set(id, tab)
		}
		host.dataset.split = !solo && panes.length > 1 ? split : ""
		host.style.setProperty("--pane-count", String(panes.length || 1))
		if (timeline) {
			timeline.hidden = solo !== null || !panes.includes(TIMELINE)
			timeline.inert = timeline.hidden
			timeline.classList.toggle("chain-front", !solo && panes[focused] === TIMELINE)
			placePane(timeline, TIMELINE)
			const tab = createTab(TIMELINE, "Note timeline", timeline.id, ids)
			tab.classList.add("chain-tab-timeline")
			tabElements.set(TIMELINE, tab)
		}
		tabs.replaceChildren(...ids.map((id) => tabElements.get(id)!))
		if (settings) {
			settings.replaceChildren(...entries.map(([id]) => views.get(id)!.layoutLabel))
		}
		if (settings && !entries.length) {
			settings.append(element("p", "", "Add a chain to choose its layout."))
		}
		warnings.setAttribute("role", "status")
		warnings.setAttribute("aria-live", "polite")
		warnings.replaceChildren(
			...manager.restoreWarnings.map((warning) => element("p", "", warning))
		)
		empty.hidden = !!entries.length
		const layout: WorkspaceLayout = {
			panes: [...panes],
			...(pinned.size ? { pinned: [...pinned] } : {}),
			...(tabOrder ? { tabOrder: [...tabOrder] } : {}),
			focused,
			split,
			solo
		}
		if (JSON.stringify(layout) !== savedLayout) {
			savedLayout = JSON.stringify(layout)
			layoutStore.save?.(layout)
		}
	}
	const activeChanged = () => {
		if (manager.activeChainId) {
			show(manager.activeChainId)
		}
		focusRequest++
		render()
	}
	const keydown = (event: KeyboardEvent) => {
		if (event.key === "Escape" && solo && !document.querySelector("dialog[open]")) {
			solo = null
			render()
		}
	}
	manager.addEventListener(EVENT_CHAINS_UPDATED, render)
	manager.addEventListener(EVENT_CHAIN_ACTIVE_CHANGED, activeChanged)
	document.addEventListener(EVENT_KEY_DOWN, keydown)
	const transport = document.getElementById("midi-transport-control"),
		actionBar = document.getElementById("action-bar")
	const updateOffset = () => {
		if (!transport) {
			return
		}
		document.documentElement.style.setProperty(
			"--transport-height",
			`${transport.getBoundingClientRect().height}px`
		)
		document.documentElement.style.setProperty(
			"--action-bar-height",
			`${actionBar?.getBoundingClientRect().height ?? 0}px`
		)
	}
	const observer =
		transport && typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateOffset) : null
	if (transport) {
		observer?.observe(transport)
	}
	if (actionBar) {
		observer?.observe(actionBar)
	}
	updateOffset()
	render()
	const surfaceViewport = createSurfaceViewport(
		manager,
		openSharedSurface(manager) || startWithSurfaces
	)
	const removeSurfaceTriggers = installSurfaceTriggers(manager)
	let destroyed = false
	return {
		destroy() {
			if (destroyed) {
				return
			}
			destroyed = true
			surfaceViewport.destroy()
			removeSurfaceTriggers()
			if (scrollFrame !== null) {
				cancelAnimationFrame(scrollFrame)
			}
			manager.removeEventListener(EVENT_CHAINS_UPDATED, render)
			manager.removeEventListener(EVENT_CHAIN_ACTIVE_CHANGED, activeChanged)
			document.removeEventListener(EVENT_KEY_DOWN, keydown)
			observer?.disconnect()
			document.documentElement.style.removeProperty("--transport-height")
			document.documentElement.style.removeProperty("--action-bar-height")
			if (overflow !== null) {
				document.body.style.overflow = overflow
			}
			for (const view of views.values()) {
				view.destroy()
			}
			if (timeline && timelineHome) {
				timeline.classList.remove("timeline-pane", "chain-front")
				timeline.removeAttribute("role")
				timeline.removeAttribute("aria-labelledby")
				timeline.removeAttribute("tabindex")
				timeline.removeAttribute("data-pane")
				timeline.style.removeProperty("--pane-position")
				if (timelineHome.label !== null) {
					timeline.setAttribute("aria-label", timelineHome.label)
				}
				timeline.hidden = false
				timeline.inert = false
				timelineHome.parent?.insertBefore(timeline, timelineHome.next)
			}
			newChain.destroy()
			tabs.remove()
			settings?.replaceChildren()
			host.remove()
		}
	}
}