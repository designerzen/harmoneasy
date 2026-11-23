// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import type IOChainManager from "audiobus/io/IO-chain-manager"
import { EVENT_PAGE_HIDE } from "audiobus/events/event-constants"
import { createWorkspaceWindows } from "../source/components/graph/workspace-windows"

let windows: ReturnType<typeof createWorkspaceWindows> | undefined
afterEach(() => {
	windows?.destroy()
	windows = undefined
	delete window.harmoneasyTabWindows
	vi.restoreAllMocks()
	vi.useRealTimers()
})

function setup() {
	vi.useFakeTimers()
	const popups: {
		closed: boolean
		focus: ReturnType<typeof vi.fn>
		close: ReturnType<typeof vi.fn>
	}[] = []
	const open = vi.spyOn(window, "open").mockImplementation(() => {
		const popup = {
			closed: false,
			focus: vi.fn(),
			close: vi.fn(() => {
				popup.closed = true
			})
		}
		popups.push(popup)
		return popup as unknown as Window
	})
	const callbacks = {
		changed: vi.fn(),
		returned: vi.fn(),
		error: vi.fn(),
		timeline: document.createElement("section")
	}
	const manager = {} as IOChainManager
	windows = createWorkspaceWindows(manager, callbacks)
	return {
		open,
		popups,
		callbacks,
		manager,
		session: () => [...window.harmoneasyTabWindows!.values()].at(-1)!
	}
}

it("opens independent windows sharing the existing manager and focuses an existing window", () => {
	const { open, popups, manager, session, callbacks } = setup()
	windows!.open("one")
	expect(session().manager).toBe(manager)
	expect(session().tabId).toBe("one")
	expect(new URL(open.mock.calls[0][0] as string).pathname).toMatch(/chain-window.html$/)
	expect(windows!.has("one")).toBe(true)
	windows!.open("two")
	expect(session().tabId).toBe("two")
	expect(popups).toHaveLength(2)
	windows!.open("one")
	expect(open).toHaveBeenCalledTimes(2)
	expect(popups[0].focus).toHaveBeenCalledTimes(2)
	expect(callbacks.changed).toHaveBeenCalledTimes(2)
})

it("returns a closed tab exactly once and disposes the separate editor", () => {
	const { session, popups, callbacks } = setup()
	windows!.open("timeline")
	const entry = session()
	expect(entry.timeline).toBe(callbacks.timeline)
	const dispose = vi.fn()
	entry.ready(dispose)
	entry.closed()
	entry.closed()
	expect(dispose).toHaveBeenCalledOnce()
	expect(popups[0].close).toHaveBeenCalledOnce()
	expect(callbacks.returned).toHaveBeenCalledExactlyOnceWith("timeline")
	expect(windows!.has("timeline")).toBe(false)
	expect(window.harmoneasyTabWindows!.size).toBe(0)
})

it("recovers windows closed before loading and cleans every popup when the workspace closes", () => {
	const { popups, callbacks } = setup()
	windows!.open("one")
	popups[0].closed = true
	vi.advanceTimersByTime(500)
	expect(callbacks.returned).toHaveBeenCalledExactlyOnceWith("one")
	windows!.open("two")
	windows!.open("three")
	window.dispatchEvent(new Event(EVENT_PAGE_HIDE))
	expect(popups.every((popup) => popup.closed)).toBe(true)
	expect(callbacks.returned).toHaveBeenCalledTimes(1)
	expect(window.harmoneasyTabWindows!.size).toBe(0)
	expect(vi.getTimerCount()).toBe(0)
})

it("leaves the workspace alone and reports blocked popups", () => {
	const { open, callbacks } = setup()
	open.mockReturnValue(null)
	windows!.open("one")
	expect(windows!.has("one")).toBe(false)
	expect(callbacks.changed).not.toHaveBeenCalled()
	expect(callbacks.error).toHaveBeenCalledWith(expect.stringContaining("Allow popups"))
	expect(window.harmoneasyTabWindows!.size).toBe(0)
})