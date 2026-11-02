// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import { createSurfaceViewport } from "../source/components/graph/surface-viewport"
import { mountControlSurface } from "../source/components/graph/control-surfaces"
import {
	EVENT_CHAINS_UPDATED,
	EVENT_CONTROL_SURFACE_EXPAND,
	EVENT_CONTROL_SURFACE_MINIMISE,
	EVENT_KEY_DOWN
} from "audiobus/event-constants"
import type IOChainManager from "audiobus/io/IO-chain-manager"

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
function setup(startExpanded: boolean, withSurfaces = true) {
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
	viewport = createSurfaceViewport(manager as unknown as IOChainManager, startExpanded)
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
	const tabs = surface.querySelectorAll<HTMLButtonElement>("[role=tab]")
	expect(tabs).toHaveLength(2)
	tabs[1].click()
	expect(dialog()).toBe(surface)
	expect(surface.querySelector("[role=tabpanel]")!.textContent).toBe("Controls for Drums")
	expect(tabs[1].getAttribute("aria-selected")).toBe("true")
	expect(vi.mocked(mountControlSurface).mock.results[0].value.destroy).toHaveBeenCalledOnce()
	tabs[1].dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: "ArrowLeft", bubbles: true }))
	expect(document.activeElement).toBe(tabs[0])
	expect(tabs[0].getAttribute("aria-selected")).toBe("true")
	manager.dispatchEvent(new Event(EVENT_CHAINS_UPDATED))
	expect(tabs[0].getAttribute("aria-selected")).toBe("true")
	expect(mountControlSurface).toHaveBeenCalledTimes(3)
	entries[0][1].options.controlSurfaces = []
	manager.dispatchEvent(new Event(EVENT_CHAINS_UPDATED))
	expect(dialog()).toBe(surface)
	expect(surface.getAttribute("aria-label")).toBe("Drums mix controls")
	expect(surface.querySelector<HTMLElement>("[role=tablist]")!.hidden).toBe(true)
	surface.querySelector<HTMLButtonElement>(".device-remove")!.click()
	expect(dialog()).toBeNull()
	expect(document.body.style.overflow).toBe("")
})
it("opens from the graph gadget, minimises, restores focus, and releases subscriptions", () => {
	const { entries, dialog } = setup(false)
	expect(dialog()).toBeNull()
	const opener = document.body.appendChild(document.createElement("button"))
	opener.focus()
	const chain = entries[0][1]
	const minimise = vi.fn()
	chain.addEventListener(EVENT_CONTROL_SURFACE_MINIMISE, minimise)
	const expand = () =>
		chain.dispatchEvent(new CustomEvent(EVENT_CONTROL_SURFACE_EXPAND, { detail: "Lead" }))
	expand()
	dialog()!.querySelector<HTMLButtonElement>(".device-minimise")!.click()
	expect(minimise).toHaveBeenCalledOnce()
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

it("lets gadgets handle Escape before closing the expanded surface from the playing region", () => {
	const { dialog } = setup(true)
	const host = dialog()!.querySelector<HTMLElement>("[role=tabpanel]")!
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