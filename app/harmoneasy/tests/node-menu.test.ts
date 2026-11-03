// @vitest-environment happy-dom
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