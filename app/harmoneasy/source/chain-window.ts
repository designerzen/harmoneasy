import "./assets/style/index.scss"
import "./assets/style/harmony.scss"
import { EVENT_CHAINS_UPDATED, EVENT_CLICK, EVENT_PAGE_HIDE } from "audiobus/events/event-constants"
import { createGraph } from "./components/transformers-graph"
import type { WorkspaceWindowSession } from "./components/graph/workspace-windows"
import { shareSurfaceTriggers } from "./components/graph/control-surface-triggers"

/** Mount a fresh editor in this document against the opener's live IOChain objects. */
function openTabWindow() {
	let session: WorkspaceWindowSession | undefined
	try {
		session = (window.opener as Window | null)?.harmoneasyTabWindows?.get(
			location.hash.slice(1)
		)
	} catch {
		// A navigated or closed opener cannot supply a running workspace.
	}
	const status = document.getElementById("window-status")!
	if (!session || session.window !== window) {
		status.textContent = "Open this window from a tab in the main Harmoneasy workspace."
		return
	}
	const { manager, tabId } = session
	shareSurfaceTriggers(session.triggers)
	const opener = window.opener as Window
	const syncAppearance = () => {
		const source = opener.document.documentElement
		for (const attribute of [...document.documentElement.attributes]) {
			if (attribute.name.startsWith("data-") || attribute.name === "style") {
				document.documentElement.removeAttribute(attribute.name)
			}
		}
		for (const attribute of [...source.attributes]) {
			if (
				attribute.name.startsWith("data-") ||
				attribute.name === "style" ||
				attribute.name === "lang"
			) {
				document.documentElement.setAttribute(attribute.name, attribute.value)
			}
		}
	}
	syncAppearance()
	const appearance = new MutationObserver(syncAppearance)
	appearance.observe(opener.document.documentElement, { attributes: true })
	if (session.timeline) {
		document.getElementById("window-content")!.append(session.timeline)
	}
	const workspace = createGraph("graph", manager, false, {}, tabId)
	const updateTitle = () => {
		const index = manager.entries.findIndex(([id]) => id === tabId)
		const name =
			tabId === "timeline"
				? "Note timeline"
				: (manager.entries[index]?.[1].options.name ?? `Chain ${index + 1}`)
		document.title = `${name} · Harmoneasy`
		document.getElementById("window-title")!.textContent = name
	}
	updateTitle()
	manager.addEventListener(EVENT_CHAINS_UPDATED, updateTitle)
	const returnTab = () => session.closed()
	document.getElementById("return-tab")!.addEventListener(EVENT_CLICK, returnTab)
	window.addEventListener(EVENT_PAGE_HIDE, returnTab)
	let disposed = false
	session.ready(() => {
		if (disposed) {
			return
		}
		disposed = true
		window.removeEventListener(EVENT_PAGE_HIDE, returnTab)
		manager.removeEventListener(EVENT_CHAINS_UPDATED, updateTitle)
		appearance.disconnect()
		workspace.destroy()
	})
	status.hidden = true
}

openTabWindow()