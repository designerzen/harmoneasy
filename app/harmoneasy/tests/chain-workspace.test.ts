// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import {
	EVENT_CHAINS_UPDATED,
	EVENT_CHAIN_ACTIVE_CHANGED,
	EVENT_KEY_DOWN,
	EVENT_CHANGE,
	EVENT_DRAG_OVER,
	EVENT_DROP
} from "audiobus/events/event-constants"
import {
	createChainWorkspace,
	type GraphView,
	type WorkspaceLayoutStore
} from "../source/components/graph/chain-workspace"
import type IOChainManager from "audiobus/io/IO-chain-manager"
import { readPresets } from "../source/components/graph/saved-presets"

let workspace: ReturnType<typeof createChainWorkspace> | undefined
let frames: (() => void)[]
afterEach(() => {
	workspace?.destroy()
	workspace = undefined
	document.body.replaceChildren()
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})
function mount(layoutStore: WorkspaceLayoutStore = {}) {
	vi.stubGlobal("localStorage", { getItem: () => null })
	frames = []
	vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
		frames.push(callback)
		return frames.length
	})
	vi.stubGlobal("cancelAnimationFrame", vi.fn())
	document.body.innerHTML =
		'<nav id="chain-navigation"></nav><div id="graph-layout-settings"></div><div id="graph"></div>' +
		'<main><section id="recordings" aria-label="Note timeline"></section></main>'
	const manager = Object.assign(new EventTarget(), {
		entries: [] as [string, any][],
		activeChainId: "one",
		restoreWarnings: [] as string[],
		devices: [],
		removeChain: vi.fn((id: string) => {
			manager.entries = manager.entries.filter(([key]) => key !== id)
			changed()
		}),
		cloneChain: vi.fn()
	})
	const changed = () => manager.dispatchEvent(new Event(EVENT_CHAINS_UPDATED))
	for (const id of ["one", "two"]) {
		const chain = Object.assign(new EventTarget(), {
			options: { name: id, graphLayout: "vertical" },
			isActive: true,
			setName: vi.fn((name: string) => {
				chain.options.name = name
				changed()
			}),
			setActive: vi.fn((active: boolean) => {
				chain.isActive = active
				changed()
			}),
			setGraphOptions: vi.fn((options: any) => {
				Object.assign(chain.options, options)
				changed()
			})
		})
		manager.entries.push([id, chain])
	}
	const graphs = new Map<
		string,
		GraphView & { update: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }
	>()
	const mountGraph = vi.fn((host, context) => {
		expect(host.className).toBe("chain-graph-canvas")
		expect(host.querySelector("button")).toBeNull()
		const graph = { update: vi.fn(), destroy: vi.fn() }
		graphs.set(context.chainId, graph)
		return graph
	})
	workspace = createChainWorkspace(
		document.getElementById("graph")!,
		manager as unknown as IOChainManager,
		mountGraph,
		false,
		layoutStore
	)
	return { manager, graphs, mountGraph, changed }
}

it("mounts React only in graph canvases while native navigation switches existing graphs", () => {
	const { graphs, mountGraph } = mount()
	const first = document.getElementById("iochain-one")!,
		second = document.getElementById("iochain-two")!
	expect(first.parentElement?.classList.contains("chains-workspace")).toBe(true)
	expect(first.hidden).toBe(false)
	expect(second.hidden).toBe(true)
	document.getElementById("chain-tab-two")!.click()
	expect(first.hidden).toBe(true)
	expect(first.inert).toBe(true)
	expect(second.hidden).toBe(false)
	expect(second.inert).toBe(false)
	expect(graphs.get("two")!.update).toHaveBeenLastCalledWith(true, 1)
	expect(mountGraph).toHaveBeenCalledTimes(2)
	document
		.getElementById("chain-tab-two")!
		.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: "ArrowLeft", bubbles: true }))
	expect(document.activeElement?.id).toBe("chain-tab-one")
	expect(first.hidden).toBe(false)
})

it.each(["menu", "tab"])("confirms %s deletion and focuses the remaining chain", (control) => {
	const { manager, graphs } = mount()
	const confirm = vi.fn().mockReturnValue(false)
	vi.stubGlobal("confirm", confirm)
	const remove = () => {
		if (control === "menu") {
			const trigger = document.querySelector<HTMLButtonElement>(
				'#iochain-one .chain-actions [aria-haspopup="menu"]'
			)!
			trigger.click()
			document
				.querySelector<HTMLButtonElement>("#iochain-one .chain-actions .device-remove")!
				.click()
		} else {
			document.querySelector<HTMLButtonElement>(".chain-tab-remove")!.click()
		}
	}
	remove()
	expect(confirm).toHaveBeenLastCalledWith("Remove “one”?")
	expect(manager.removeChain).not.toHaveBeenCalled()
	expect(graphs.get("one")!.destroy).not.toHaveBeenCalled()
	confirm.mockReturnValue(true)
	remove()
	expect(manager.removeChain).toHaveBeenCalledExactlyOnceWith("one")
	expect(graphs.get("one")!.destroy).toHaveBeenCalledOnce()
	expect(document.activeElement?.id).toBe("chain-tab-two")
	expect(document.getElementById("iochain-two")!.hidden).toBe(false)
})

it("updates native names, power and layout controls without remounting graphs", () => {
	const { manager, mountGraph } = mount()
	const panel = document.getElementById("iochain-one")!
	const name = panel.querySelector<HTMLInputElement>(".chain-name")!
	name.focus()
	name.value = "Lead"
	name.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: "Enter", bubbles: true }))
	expect(manager.entries[0][1].setName).toHaveBeenCalledWith("Lead")
	expect(document.getElementById("chain-tab-one")!.textContent).toBe("Lead")
	name.focus()
	name.value = "Cancelled"
	name.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: "Escape", bubbles: true }))
	expect(manager.entries[0][1].setName).toHaveBeenCalledTimes(1)
	expect(name.value).toBe("Lead")
	panel.querySelector<HTMLButtonElement>(".chain-power")!.click()
	expect(panel.querySelector(".chain-power")!.getAttribute("aria-pressed")).toBe("false")
	const layout = document.querySelector<HTMLSelectElement>("#graph-layout-settings select")!
	layout.value = "horizontal"
	layout.dispatchEvent(new Event(EVENT_CHANGE, { bubbles: true }))
	expect(manager.entries[0][1].setGraphOptions).toHaveBeenCalledWith({
		graphLayout: "horizontal",
		positions: {}
	})
	expect(mountGraph).toHaveBeenCalledTimes(2)
})

it("restores solo state, follows active chains, and releases removed graphs and dialogs", () => {
	const { manager, graphs, changed } = mount()
	const panel = document.getElementById("iochain-one")!
	panel.querySelector<HTMLButtonElement>(".chain-solo-toggle")!.click()
	expect(panel.classList.contains("chain-solo")).toBe(true)
	expect(document.body.style.overflow).toBe("hidden")
	document.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: "Escape", bubbles: true }))
	expect(panel.classList.contains("chain-solo")).toBe(false)
	expect(document.body.style.overflow).toBe("")
	manager.activeChainId = "two"
	manager.dispatchEvent(new Event(EVENT_CHAIN_ACTIVE_CHANGED))
	expect(document.getElementById("iochain-two")!.hidden).toBe(false)
	manager.removeChain("one")
	expect(graphs.get("one")!.destroy).toHaveBeenCalledOnce()
	expect(document.getElementById("iochain-one")).toBeNull()
	workspace!.destroy()
	workspace = undefined
	expect(graphs.get("two")!.destroy).toHaveBeenCalledOnce()
	expect(document.querySelector("dialog.preset-browser")).toBeNull()
	const updates = graphs.get("two")!.update.mock.calls.length
	changed()
	expect(graphs.get("two")!.update).toHaveBeenCalledTimes(updates)
})

it("saves from the chain menu and offers overwrite or rename for duplicate names", () => {
	const { manager } = mount()
	const storage = new Map<string, string>()
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value)
	})
	const chain = manager.entries[0][1]
	chain.exportConfiguration = () => ({ options: { ...chain.options }, transformers: "[]" })
	const panel = document.getElementById("iochain-one")!
	const trigger = panel.querySelector<HTMLButtonElement>('.chain-actions [aria-haspopup="menu"]')!
	const action = [
		...panel.querySelectorAll<HTMLButtonElement>('.chain-actions [role="menuitem"]')
	].find((item) => item.textContent === "Save as a preset")!
	expect(action.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true")
	expect(panel.querySelector(".save-preset")).toBeNull()
	const open = () => {
		trigger.click()
		action.click()
		return document.querySelector<HTMLDialogElement>(".save-preset-dialog[open]")!
	}
	const submit = (dialog: HTMLDialogElement) =>
		dialog.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }))
	let dialog = open()
	expect(dialog.querySelector("input")!.value).toBe("one")
	submit(dialog)
	expect(dialog.open).toBe(false)
	const original = readPresets().find((item) => item.name === "one")!
	chain.options.graphLayout = "horizontal"
	dialog = open()
	submit(dialog)
	expect(dialog.open).toBe(true)
	expect(dialog.querySelector('[type="submit"]')!.textContent).toBe("Overwrite")
	expect(readPresets().find((item) => item.id === original.id)?.options?.graphLayout).toBe(
		"vertical"
	)
	submit(dialog)
	expect(readPresets().find((item) => item.id === original.id)?.options?.graphLayout).toBe(
		"horizontal"
	)
	dialog = open()
	submit(dialog)
	Array.from(dialog.querySelectorAll("button"))
		.find((item) => item.textContent === "Rename")!
		.click()
	const name = dialog.querySelector("input")!
	expect(name.readOnly).toBe(false)
	expect(document.activeElement).toBe(name)
	name.value = "Another preset"
	submit(dialog)
	expect(readPresets().find((item) => item.name === "Another preset")).toBeDefined()
	expect(readPresets().filter((item) => item.name === "one")).toHaveLength(1)
	expect(dialog.open).toBe(false)
	dialog = open()
	submit(dialog)
	Array.from(dialog.querySelectorAll("button"))
		.find((item) => item.textContent === "Cancel")!
		.click()
	expect(dialog.open).toBe(false)
	expect(
		readPresets().filter((item) => ["one", "Another preset"].includes(item.name))
	).toHaveLength(2)
})
it("offers the note timeline as a tab that replaces the chain pane", () => {
	const { graphs } = mount()
	const timeline = document.getElementById("recordings")!,
		first = document.getElementById("iochain-one")!
	expect(timeline.parentElement?.classList.contains("chains-workspace")).toBe(true)
	expect(timeline.hidden).toBe(true)
	const tab = document.getElementById("chain-tab-timeline")!
	expect(tab.getAttribute("aria-controls")).toBe("recordings")
	tab.click()
	expect(timeline.hidden).toBe(false)
	expect(first.hidden).toBe(true)
	expect(graphs.get("one")!.update).toHaveBeenLastCalledWith(false, 0)
	tab.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: "ArrowRight", bubbles: true }))
	expect(document.activeElement?.id).toBe("chain-tab-one")
	expect(timeline.hidden).toBe(true)
	workspace!.destroy()
	workspace = undefined
	expect(timeline.parentElement?.tagName).toBe("MAIN")
	expect(timeline.hidden).toBe(false)
	expect(timeline.getAttribute("aria-label")).toBe("Note timeline")
})

it("splits the workspace when a tab is dropped on a side and merges it in the middle", () => {
	const { graphs } = mount()
	const host = document.querySelector<HTMLElement>(".chains-workspace")!,
		zone = host.querySelector<HTMLElement>(".pane-drop-zone")!,
		timeline = document.getElementById("recordings")!,
		first = document.getElementById("iochain-one")!,
		second = document.getElementById("iochain-two")!
	// happy-dom's DragEvent drops pointer coordinates, so the drop zone gets mouse events.
	const drag = (id: string, clientX: number, clientY: number) => {
		document
			.getElementById(`chain-tab-${id}`)!
			.dispatchEvent(new DragEvent("dragstart", { bubbles: true }))
		expect(zone.hidden).toBe(false)
		zone.dispatchEvent(new MouseEvent(EVENT_DRAG_OVER, { clientX, clientY, bubbles: true }))
		zone.dispatchEvent(new MouseEvent(EVENT_DROP, { clientX, clientY, bubbles: true }))
		expect(zone.hidden).toBe(true)
	}
	vi.spyOn(zone, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 100))
	drag("timeline", 95, 50)
	expect(host.dataset.split).toBe("row")
	expect(first.hidden).toBe(false)
	expect(first.dataset.pane).toBe("0")
	expect(timeline.hidden).toBe(false)
	expect(timeline.dataset.pane).toBe("1")
	expect(document.getElementById("chain-tab-timeline")!.getAttribute("aria-selected")).toBe(
		"true"
	)
	expect(document.getElementById("chain-tab-one")!.hasAttribute("data-shown")).toBe(true)
	// Choosing a tab replaces the focused pane and leaves the other one alone.
	document.getElementById("chain-tab-two")!.click()
	expect(timeline.hidden).toBe(true)
	expect(first.hidden).toBe(false)
	expect(second.dataset.pane).toBe("1")
	expect(graphs.get("two")!.update).toHaveBeenLastCalledWith(true, expect.any(Number))
	drag("timeline", 50, 5)
	expect(host.dataset.split).toBe("column")
	expect(timeline.dataset.pane).toBe("0")
	expect(second.dataset.pane).toBe("1")
	drag("two", 50, 50)
	expect(host.dataset.split).toBe("")
	expect(timeline.hidden).toBe(true)
	expect(second.hidden).toBe(false)
})

it("saves the pane layout and restores it on the next load", () => {
	const save = vi.fn()
	mount({ save })
	expect(save).toHaveBeenLastCalledWith({
		panes: ["one"],
		focused: 0,
		split: "row",
		solo: null
	})
	const zone = document.querySelector<HTMLElement>(".pane-drop-zone")!
	vi.spyOn(zone, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 100))
	document
		.getElementById("chain-tab-timeline")!
		.dispatchEvent(new DragEvent("dragstart", { bubbles: true }))
	zone.dispatchEvent(new MouseEvent(EVENT_DROP, { clientX: 50, clientY: 95, bubbles: true }))
	const layout = save.mock.lastCall![0]
	expect(layout).toEqual({ panes: ["one", "timeline"], focused: 1, split: "column", solo: null })
	workspace!.destroy()

	const restored = vi.fn()
	mount({ saved: JSON.parse(JSON.stringify(layout)), save: restored })
	expect(restored).not.toHaveBeenCalled()
	expect(document.querySelector<HTMLElement>(".chains-workspace")!.dataset.split).toBe(
		"column"
	)
	expect(document.getElementById("iochain-one")!.dataset.pane).toBe("0")
	expect(document.getElementById("recordings")!.dataset.pane).toBe("1")
	expect(document.getElementById("chain-tab-timeline")!.getAttribute("aria-selected")).toBe(
		"true"
	)
})

it("ignores saved layouts that are malformed or name missing chains", () => {
	mount({ saved: { panes: ["gone", 4] } })
	expect(document.getElementById("iochain-one")!.hidden).toBe(false)
	workspace!.destroy()
	const save = vi.fn()
	mount({ saved: { panes: ["gone", "two"], focused: 0, split: "row", solo: null }, save })
	expect(document.getElementById("iochain-two")!.hidden).toBe(false)
	expect(document.querySelector<HTMLElement>(".chains-workspace")!.dataset.split).toBe("")
	expect(save).toHaveBeenLastCalledWith({ panes: ["two"], focused: 0, split: "row", solo: null })
})
