import { EVENT_PAGE_HIDE } from "audiobus/events/event-constants"
import type IOChainManager from "audiobus/io/IO-chain-manager"
import { surfaceTriggerState, type SurfaceTriggerState } from "./control-surface-triggers"

export interface WorkspaceWindowSession {
	tabId: string
	manager: IOChainManager
	window: Window | null
	timeline?: HTMLElement
	triggers: SurfaceTriggerState
	ready(dispose: () => void): void
	closed(): void
}

declare global {
	interface Window {
		harmoneasyTabWindows?: Map<string, WorkspaceWindowSession>
	}
}

/** Only the editor runs in the new window; audio and MIDI stay in the opening window. */
export function createWorkspaceWindows(
	manager: IOChainManager,
	callbacks: {
		changed(): void
		returned(id: string): void
		error(message: string): void
		timeline?: HTMLElement | null
	}
) {
	const registry = (window.harmoneasyTabWindows ??= new Map())
	const windows = new Map<
		string,
		{ token: string; session: WorkspaceWindowSession; dispose?: () => void }
	>()
	let timer: ReturnType<typeof setInterval> | undefined
	const finish = (id: string, notify = true) => {
		const entry = windows.get(id)
		if (!entry) {
			return
		}
		windows.delete(id)
		registry.delete(entry.token)
		entry.dispose?.()
		entry.session.window?.close()
		if (!windows.size) {
			clearInterval(timer)
			timer = undefined
		}
		if (notify) {
			callbacks.returned(id)
		}
	}
	const destroy = () => {
		window.removeEventListener(EVENT_PAGE_HIDE, destroy)
		for (const id of [...windows.keys()]) {
			finish(id, false)
		}
	}
	window.addEventListener(EVENT_PAGE_HIDE, destroy)
	return {
		has: (id: string) => windows.has(id),
		focus(id: string) {
			windows.get(id)?.session.window?.focus()
		},
		open(id: string) {
			const existing = windows.get(id)
			if (existing && !existing.session.window?.closed) {
				existing.session.window?.focus()
				return
			}
			if (existing) {
				finish(id)
			}
			const token = crypto.randomUUID()
			const session: WorkspaceWindowSession = {
				tabId: id,
				manager,
				triggers: surfaceTriggerState,
				window: null,
				...(id === "timeline" && callbacks.timeline
					? { timeline: callbacks.timeline }
					: {}),
				ready(dispose) {
					const entry = windows.get(id)
					if (entry?.session === session) {
						entry.dispose = dispose
					} else {
						dispose()
					}
				},
				closed: () => {
					if (windows.get(id)?.session === session) {
						finish(id)
					}
				}
			}
			registry.set(token, session)
			try {
				const url = new URL(
					`${import.meta.env.BASE_URL}chain-window.html`,
					window.location.href
				)
				url.hash = token
				session.window = window.open(
					url.href,
					`harmoneasy-tab-${token}`,
					"popup,width=1200,height=850,resizable=yes,scrollbars=yes"
				)
				if (!session.window) {
					throw new Error("Allow popups for Harmoneasy to open tabs in separate windows.")
				}
			} catch (error) {
				registry.delete(token)
				callbacks.error(error instanceof Error ? error.message : String(error))
				return
			}
			windows.set(id, { token, session })
			// Also catch windows closed before their editor has loaded.
			timer ??= setInterval(() => {
				for (const [tabId, entry] of windows) {
					if (entry.session.window?.closed) {
						finish(tabId)
					}
				}
			}, 500)
			callbacks.changed()
			session.window.focus()
		},
		return: (id: string) => finish(id),
		destroy
	}
}