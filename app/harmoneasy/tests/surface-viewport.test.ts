// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import { createSurfaceViewport } from "../source/components/graph/surface-viewport"
import { mountControlSurface } from "../source/components/graph/control-surfaces"
import {
	EVENT_CHAINS_UPDATED,
	EVENT_CONTROL_SURFACE_EXPAND,
	EVENT_KEY_DOWN
} from "audiobus/events/event-constants"
import type IOChainManager from "audiobus/io/IO-chain-manager"
import type { FocusStage, FocusStageHost } from "../source/services/focus-stage"

vi.mock("../source/components/graph/control-surfaces", () => ({
	mountControlSurface: vi.fn((host, _chain, id) => {
		host.textContent = `Controls for ${id}`
		return { destroy: vi.fn() }
	}),
	removeSurface: (chain: any, id: string) => {
		chain.options.controlSurfaces = chain.options.controlSurfaces.filter(
			(surface: any) => surface.id !== id
		)
	}
}))
let viewport: ReturnType<typeof createSurfaceViewport> | undefined
afterEach(() => {
	viewport?.destroy()
	viewport = undefined
	document.body.replaceChildren()
	vi.clearAllMocks()
})
function setup(
	startExpanded: boolean,
	withSurfaces = true,
	includesChain?: (id: string) => boolean,
	stage?: FocusStage
) {
	const entries = ["Lead", "Drums"].map(
		(name) =>
			[
				name,
				Object.assign(new EventTarget(), {
					options: {
						name,
						controlSurfaces: withSurfaces
							? [{ id: name, name: `${name} mix`, connections: [], widgets: [] }]
							: []
					}
				})
			] as const
	)
	const manager = Object.assign(new EventTarget(), { entries })
	viewport = createSurfaceViewport(
		manager as unknown as IOChainManager,
		startExpanded,
		includesChain,
		stage
	)
	return {
		manager,
		entries,
		dialog: () => document.querySelector<HTMLElement>(".surface-viewport")
	}
}
it("starts preset surfaces expanded and switches across chains without closing the viewport", () => {
	const { dialog, manager, entries } = setup(true)
	const surface = dialog()!
	expect(surface.getAttribute("aria-label")).toBe("Lead mix controls")
	expect(document.body.style.overflow).toBe("hidden")
	expect(surface.querySelector("[role=tablist]")).toBeNull()
	expect(surface.querySelector(".device-menu")).toBeNull()
	const actions = () => vi.mocked(mountControlSurface).mock.calls.at(-1)![4]!()
	const open = (name: string) => actions().find((action) => action.label === `Open ${name}`)
	open("Drums mix")!.action()
	expect(dialog()).toBe(surface)
	expect(surface.querySelector(".surface-viewport-content")!.textContent).toBe(
		"Controls for Drums"
	)
	expect(vi.mocked(mountControlSurface).mock.results[0].value.destroy).toHaveBeenCalledOnce()
	open("Lead mix")!.action()
	expect(surface.getAttribute("aria-label")).toBe("Lead mix controls")
	manager.dispatchEvent(new Event(EVENT_CHAINS_UPDATED))
	expect(surface.getAttribute("aria-label")).toBe("Lead mix controls")
	expect(mountControlSurface).toHaveBeenCalledTimes(3)
	entries[0][1].options.controlSurfaces = []
	manager.dispatchEvent(new Event(EVENT_CHAINS_UPDATED))
	expect(dialog()).toBe(surface)
	expect(surface.getAttribute("aria-label")).toBe("Drums mix controls")
	expect(open("Drums mix")).toBeUndefined()
	const remove = actions().find((action) => action.label === "Remove control surface")!
	expect(remove.editOnly).toBe(true)
	remove.action()
	expect(dialog()).toBeNull()
	expect(document.body.style.overflow).toBe("")
})
it("opens from the graph gadget, exits, restores focus, and releases subscriptions", () => {
	const { entries, dialog } = setup(false)
	expect(dialog()).toBeNull()
	const opener = document.body.appendChild(document.createElement("button"))
	opener.focus()
	const chain = entries[0][1]
	const expand = () =>
		chain.dispatchEvent(new CustomEvent(EVENT_CONTROL_SURFACE_EXPAND, { detail: "Lead" }))
	expand()
	dialog()!.querySelector<HTMLButtonElement>(".surface-viewport-exit")!.click()
	expect(dialog()).toBeNull()
	expect(document.activeElement).toBe(opener)
	expand()
	document.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: "Escape", bubbles: true }))
	expect(dialog()).toBeNull()
	expand()
	viewport!.destroy()
	expect(dialog()).toBeNull()
	expand()
	expect(dialog()).toBeNull()
	expect(document.body.style.overflow).toBe("")
})
it("keeps the graph visible when a preset has no surfaces", () => {
	const { dialog } = setup(true, false)
	expect(dialog()).toBeNull()
	expect(document.body.style.overflow).toBe("")
})

it("keeps expanded controls in the window that owns the chain", () => {
	let local = false
	const { entries, dialog } = setup(false, true, (id) => local && id === "Lead")
	const expand = () =>
		entries[0][1].dispatchEvent(
			new CustomEvent(EVENT_CONTROL_SURFACE_EXPAND, { detail: "Lead" })
		)
	expand()
	expect(dialog()).toBeNull()
	local = true
	viewport!.refresh()
	expand()
	expect(dialog()).not.toBeNull()
	local = false
	viewport!.refresh()
	expect(dialog()).toBeNull()
	expand()
	expect(dialog()).toBeNull()
})

it("lets gadgets handle Escape before closing the expanded surface from the playing region", () => {
	const { dialog } = setup(true)
	const host = dialog()!.querySelector<HTMLElement>(".surface-viewport-content")!
	host.dataset.keyboardNotes = ""
	const gadget = host.appendChild(document.createElement("button"))
	const playing = host.appendChild(document.createElement("div"))
	playing.className = "cs-viewport"
	playing.tabIndex = 0
	gadget.addEventListener(EVENT_KEY_DOWN, (event) => {
		if (event.key === "Escape") {
			event.stopPropagation()
			playing.focus()
		}
	})
	gadget.focus()
	gadget.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: "Escape", bubbles: true }))
	expect(dialog()).not.toBeNull()
	expect(document.activeElement).toBe(playing)
	playing.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: "Escape", bubbles: true }))
	expect(dialog()).toBeNull()
})
function fakeStage() {
	let host: FocusStageHost | undefined
	const element = document.createElement("section")
	element.className = "focus-stage"
	const stage = {
		element,
		attach: vi.fn((next: FocusStageHost) => {
			host = next
			return () => (host = undefined)
		}),
		activate: vi.fn(),
		deactivate: vi.fn(),
		open: (view?: "controls" | "pads") => host?.show(view),
		close: () => host?.hide()
	}
	return stage
}

it("hosts the Focus Stage pads beside the controls in the same fullscreen view", () => {
	const stage = fakeStage()
	const { dialog } = setup(false, true, undefined, stage as unknown as FocusStage)
	const views = () =>
		[...dialog()!.querySelectorAll<HTMLButtonElement>(".surface-viewport-view")].map(
			(view) => [view.textContent, view.getAttribute("aria-pressed")]
		)
	// The menu button opens the chain's controls when it has a surface.
	stage.open()
	expect(views()).toEqual([
		["Controls", "true"],
		["Pads", "false"]
	])
	expect(dialog()!.querySelector<HTMLElement>(".surface-titlebar")!.hidden).toBe(false)
	dialog()!.querySelectorAll<HTMLButtonElement>(".surface-viewport-view")[1].click()
	expect(stage.activate).toHaveBeenCalledOnce()
	expect(stage.element.isConnected).toBe(true)
	expect(dialog()!.querySelector<HTMLElement>(".surface-titlebar")!.hidden).toBe(true)
	expect(dialog()!.getAttribute("aria-label")).toBe("Focus Stage pads")
	dialog()!.querySelectorAll<HTMLButtonElement>(".surface-viewport-view")[0].click()
	expect(stage.deactivate).toHaveBeenCalledOnce()
	expect(stage.element.isConnected).toBe(false)
	expect(dialog()!.getAttribute("aria-label")).toBe("Lead mix controls")
	stage.open("pads")
	stage.close()
	expect(dialog()).toBeNull()
	expect(stage.deactivate).toHaveBeenCalledTimes(2)
})

it("opens pads when there are no surfaces and never starts expanded without one", () => {
	const stage = fakeStage()
	const { dialog } = setup(true, false, undefined, stage as unknown as FocusStage)
	expect(dialog()).toBeNull()
	stage.open()
	expect(stage.activate).toHaveBeenCalledOnce()
	expect(dialog()!.querySelector<HTMLButtonElement>(".surface-viewport-view")!.disabled).toBe(true)
	document.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: "Escape", bubbles: true }))
	expect(dialog()).toBeNull()
	expect(stage.deactivate).toHaveBeenCalledOnce()
	viewport!.destroy()
	viewport = undefined
	stage.open()
	expect(dialog()).toBeNull()
})
