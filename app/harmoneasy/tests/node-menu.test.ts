// @vitest-environment happy-dom
import { EVENT_KEY_DOWN, EVENT_FOCUS_IN } from "../../../packages/control-surface/src/events"
import { afterEach, expect, it, vi } from "vitest"
import { createNodeMenu } from "../source/components/graph/node-menu"
import { transformerActions } from "../source/components/graph/transformer-actions"
import { TransformerHarmoniser } from "../../../packages/audiobus/io/transformers/transformer-harmoniser"
import { tranformerFactory } from "../../../packages/audiobus/io/transformer-factory"

afterEach(() => document.body.replaceChildren())

it("opens actions by keyboard, dismisses with Escape and outside clicks, and runs actions", () => {
	const run = vi.fn(),
		menu = createNodeMenu([{ label: "Clone", run }])
	document.body.append(menu.element)
	try {
		const trigger = menu.element.querySelector("button")!,
			panel = menu.element.querySelector<HTMLElement>(".node-menu-panel")!
		expect(panel.hidden).toBe(true)
		trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
		expect(panel.hidden).toBe(false)
		expect(document.activeElement).toBe(panel.querySelector("button"))
		panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
		expect(panel.hidden).toBe(true)
		expect(document.activeElement).toBe(trigger)
		trigger.click()
		document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
		expect(panel.hidden).toBe(true)
		trigger.click()
		panel.querySelector("button")!.click()
		expect(run).toHaveBeenCalledOnce()
		expect(panel.hidden).toBe(true)
	} finally {
		menu.destroy()
	}
})

it("clones next to the original with independent MIDI identity and persists renamed and recolored settings", () => {
	const original = new TransformerHarmoniser({ root: 5, enabled: false }),
		next = new TransformerHarmoniser()
	let transformers = [original, next]
	const chain = Object.assign(new EventTarget(), {
		transformerManager: {
			getTransformers: () => transformers,
			setTransformers: (value: typeof transformers) => {
				transformers = value
			}
		}
	})
	const actions = transformerActions(chain as any, original)
	const edit = (label: string, value: string) => {
		actions.find((action) => action.label === label)!.run()
		const dialog = document.querySelector("dialog")!,
			input = dialog.querySelector("input")!
		input.value = value
		dialog
			.querySelector("form")!
			.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
	}
	try {
		edit("Rename", "Lead harmony")
		edit("Recolor", "#ffcc44")
		const saved = JSON.parse(original.exportConfig())
		expect(saved).toMatchObject({ displayName: "Lead harmony", displayColor: "#ffcc44" })
		const restored = tranformerFactory(original.type, saved)
		expect(JSON.parse(restored.exportConfig())).toMatchObject(saved)
		restored.destroy()
		actions.find((action) => action.label === "Clone")!.run()
		expect(transformers[0]).toBe(original)
		expect(transformers[2]).toBe(next)
		const copy = transformers[1]
		expect(copy.uuid).not.toBe(original.uuid)
		expect(copy.midiControlId).not.toBe(original.midiControlId)
		expect(JSON.parse(copy.exportConfig())).toMatchObject({
			root: 5,
			enabled: false,
			displayName: "Lead harmony copy",
			displayColor: "#ffcc44"
		})
	} finally {
		transformers.forEach((transformer) => transformer.destroy())
	}
})
it("exposes named menu semantics, decorative icons, and complete keyboard navigation", () => {
	const menu = createNodeMenu([
		{ label: "Swap", run: vi.fn() },
		{ label: "Clone", disabled: true, run: vi.fn() },
		{ label: "Rename", run: vi.fn() },
		{ label: "Recolor", run: vi.fn() },
		{ label: "Delete transformer", className: "device-remove", run: vi.fn() }
	])
	document.body.append(menu.element)
	try {
		const trigger = menu.element.querySelector("button")!,
			panel = menu.element.querySelector<HTMLElement>("[role=menu]")!
		const key = (value: string) =>
			document.activeElement!.dispatchEvent(
				new KeyboardEvent(EVENT_KEY_DOWN, { key: value, bubbles: true, cancelable: true })
			)
		expect(trigger.getAttribute("aria-haspopup")).toBe("menu")
		expect(trigger.getAttribute("aria-controls")).toBe(panel.id)
		expect(panel.getAttribute("aria-labelledby")).toBe(trigger.id)
		for (const item of panel.querySelectorAll("button")) {
			expect(item.getAttribute("role")).toBe("menuitem")
			expect(item.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true")
		}
		trigger.focus()
		key("ArrowUp")
		expect(document.activeElement?.textContent).toBe("Delete transformer")
		key("ArrowDown")
		expect(document.activeElement?.textContent).toBe("Swap")
		key("ArrowDown")
		expect(document.activeElement?.textContent).toBe("Rename")
		key("End")
		expect(document.activeElement?.textContent).toBe("Delete transformer")
		key("Home")
		expect(document.activeElement?.textContent).toBe("Swap")
		key("r")
		expect(document.activeElement?.textContent).toBe("Rename")
		key("r")
		expect(document.activeElement?.textContent).toBe("Recolor")
		key("Tab")
		expect(panel.hidden).toBe(true)
		expect(document.activeElement).toBe(trigger)
		trigger.click()
		const outside = document.body.appendChild(document.createElement("button"))
		outside.focus()
		outside.dispatchEvent(new FocusEvent(EVENT_FOCUS_IN, { bubbles: true }))
		expect(panel.hidden).toBe(true)
		expect(document.activeElement).toBe(outside)
	} finally {
		menu.destroy()
	}
})