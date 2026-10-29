// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import {
	EVENT_CHAINS_UPDATED,
	EVENT_CHAIN_ACTIVE_CHANGED,
	EVENT_KEY_DOWN,
	EVENT_CHANGE
} from "audiobus/event-constants"
import { createChainWorkspace, type GraphView } from "../source/components/graph/chain-workspace"
import type IOChainManager from "audiobus/io/IO-chain-manager"
import { readPresets } from "../source/components/graph/saved-presets"

let workspace: ReturnType<typeof createChainWorkspace> | undefined
let frames: (() => void)[]
afterEach(() => {
	workspace?.destroy()
	workspace = undefined
	document.body.replaceChildren()
	vi.unstubAllGlobals()
})
function mount() {
	vi.stubGlobal("localStorage", { getItem: () => null })
	frames = []
	vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
		frames.push(callback)
		return frames.length
	})
	vi.stubGlobal("cancelAnimationFrame", vi.fn())
	document.body.innerHTML =
		'<nav id="chain-navigation"></nav><div id="graph-layout-settings"></div><div id="graph"></div>'
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
		const chain = {
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
		}
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
		mountGraph
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
	const action = panel.querySelector<HTMLSelectElement>(".chain-actions select")!
	expect(
		[...action.options].filter((item) => item.textContent === "Save as a Preset")
	).toHaveLength(1)
	expect(panel.querySelector(".save-preset")).toBeNull()
	const open = () => {
		action.value = "save-preset"
		action.dispatchEvent(new Event(EVENT_CHANGE))
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