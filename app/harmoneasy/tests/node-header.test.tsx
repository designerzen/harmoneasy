// @vitest-environment happy-dom
import React, { act, useState } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { NodeHeader } from "../source/components/graph/NodeHeader"

it("keeps the menu open after the first click selects and rerenders its graph node", async () => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
	const host = document.body.appendChild(document.createElement("div"))
	const root = createRoot(host),
		run = vi.fn()
	function Node() {
		const [selection, select] = useState(0)
		return (
			<div onClick={() => select((value) => value + 1)}>
				<NodeHeader
					title="Input"
					removeLabel="Remove input"
					onRemove={() => run(selection)}
					onSwap={() => {}}
				>
					<button type="button" className="device-expand">
						Expand
					</button>
				</NodeHeader>
			</div>
		)
	}
	try {
		await act(async () => root.render(<Node />))
		const trigger = host.querySelector<HTMLButtonElement>(".device-menu")!
		await act(async () => trigger.click())
		expect(host.querySelector(".device-menu")).toBe(trigger)
		expect(trigger.getAttribute("aria-expanded")).toBe("true")
		const panel = host.querySelector<HTMLElement>(".node-menu-panel")!
		expect(panel.hidden).toBe(false)
		expect(document.activeElement).toBe(panel.querySelector("button"))
		await act(async () => panel.querySelector<HTMLButtonElement>(".device-remove")!.click())
		expect(run).toHaveBeenCalledWith(1)
		expect(panel.hidden).toBe(true)
		expect(document.activeElement).toBe(trigger)
	} finally {
		await act(async () => root.unmount())
		host.remove()
	}
})