// @vitest-environment happy-dom
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { createPortal } from "react-dom"
import { expect, it, vi } from "vitest"
import { DeviceGui } from "../source/components/graph/DeviceGui"
import InputKeyboard from "../../../packages/audiobus/io/inputs/input-keyboard"
import { NOTE_ON, NOTE_OFF, TEMPO_TAP } from "../../../packages/audiobus/commands"
import { EVENT_POINTER_DOWN, EVENT_POINTER_UP } from "../../../packages/audiobus/event-constants"

it("keeps all key labels and input working when moving into and out of fullscreen", async () => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
	const host = document.body.appendChild(document.createElement("div"))
	const root = createRoot(host)
	const input = new InputKeyboard()
	const dispatch = vi.spyOn(input, "dispatch")
	const createGui = vi.spyOn(input, "createGui")
	const editor = document.body.appendChild(document.createElement("div"))
	editor.className = "node-viewport-editor"
	const render = (expanded: boolean) =>
		act(async () => {
			root.render(
				<>
					<DeviceGui device={input} />
					{expanded &&
						createPortal(
							<div className="graph-node is-fullscreen">
								<DeviceGui device={input} expanded />
							</div>,
							editor
						)}
				</>
			)
		})
	const play = (container: Element, key: string, id: number) => {
		const rect = Array.from(container.querySelectorAll(".qwerty-key")).find(
			(element) => element.getAttribute("data-key-code") === key
		)!
		expect(rect).toBeDefined()
		rect.dispatchEvent(
			new PointerEvent(EVENT_POINTER_DOWN, { bubbles: true, pointerId: id, button: 0 })
		)
		expect(rect.classList.contains("active")).toBe(true)
		document.dispatchEvent(new PointerEvent(EVENT_POINTER_UP, { bubbles: true, pointerId: id }))
		expect(rect.classList.contains("active")).toBe(false)
	}
	try {
		await render(false)
		const keyboard = host.querySelector(".qwerty-keyboard")!
		play(host, "q", 1)
		await render(true)
		expect(editor.querySelector(".qwerty-keyboard")).toBe(keyboard)
		for (const group of editor.querySelectorAll(".qwerty-key-group")) {
			expect(group.querySelector(".qwerty-key-label")?.textContent?.trim()).not.toBe("")
		}
		play(editor, "q", 2)
		play(editor, " ", 3)
		await render(false)
		expect(host.querySelector(".qwerty-keyboard")).toBe(keyboard)
		play(host, "q", 4)
		expect(createGui).toHaveBeenCalledTimes(1)
		expect(dispatch.mock.calls.map(([command]) => command.type)).toEqual([
			NOTE_ON,
			NOTE_OFF,
			NOTE_ON,
			NOTE_OFF,
			TEMPO_TAP,
			NOTE_ON,
			NOTE_OFF
		])
	} finally {
		await act(async () => root.unmount())
		input.destroy()
		host.remove()
		editor.remove()
		vi.restoreAllMocks()
	}
})