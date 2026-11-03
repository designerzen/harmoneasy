// @vitest-environment happy-dom
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { TransformerNode } from "../source/components/graph/nodes/TransformerNode"
import { ChainContext } from "../source/components/graph/ChainContext"
import { TransformerHarmoniser } from "../../../packages/audiobus/io/transformers/transformer-harmoniser"
import { componentBindings } from "../../../packages/audiobus/io/component-ui"
import { EVENT_CONFIGURATION_CHANGED } from "../../../packages/audiobus/event-constants"

vi.mock("@xyflow/react", () => ({ Handle: () => null, Position: {} }))
vi.mock("../source/components/graph/GraphDialogs", () => ({ TransformerDialog: () => null }))
vi.mock("../source/components/graph/element-icons", () => ({
	elementIcon: () => "harmoniser.svg",
	elementDescription: () => "Harmoniser description"
}))

it.each([true, 1])(
	"keeps the title toggle and external controls in sync for enabled=%s",
	async (initial) => {
		globalThis.IS_REACT_ACT_ENVIRONMENT = true
		const element = new TransformerHarmoniser({ enabled: initial })
		const chain = new EventTarget()
		const save = vi.fn()
		const move = { moveOneStepBefore: vi.fn(), moveOneStepAfter: vi.fn() }
		Object.assign(chain, { transformerQuantity: 2, transformerManager: move })
		chain.addEventListener(EVENT_CONFIGURATION_CHANGED, save)
		const host = document.body.appendChild(document.createElement("div"))
		const root = createRoot(host)
		try {
			await act(async () =>
				root.render(
					<ChainContext.Provider value={{ chain, chainId: "test" } as any}>
						<TransformerNode
							id="harmoniser"
							data={{
								element,
								label: element.name,
								layoutMode: initial === true ? "vertical" : "horizontal",
								description: element.description
							}}
						/>
					</ChainContext.Provider>
				)
			)
			const toggle = host.querySelector<HTMLButtonElement>(".device-toggle")!
			expect(toggle.getAttribute("aria-pressed")).toBe("true")
			const bar = host.querySelector(".device-title-controls")!
			expect(bar.querySelector("button")).toBe(toggle)
			expect(
				bar.querySelectorAll("button")[bar.querySelectorAll("button").length - 1].className
			).toBe("device-expand")
			expect(bar.querySelector(".transformer-move-controls")).toBeNull()
			const ordering = host.querySelector(".transformer-move-controls")!
			expect(
				ordering.classList.contains(initial === true ? "is-vertical" : "is-horizontal")
			).toBe(true)
			await act(async () => ordering.querySelector<HTMLButtonElement>(".btn-next")!.click())
			expect(move.moveOneStepAfter).toHaveBeenCalledWith(element)
			await act(async () => toggle.click())
			expect(element.options.enabled).toBe(typeof initial === "boolean" ? false : 0)
			expect(toggle.getAttribute("aria-pressed")).toBe("false")
			expect(save).toHaveBeenCalledOnce()
			const binding = (await componentBindings(element, "test")).find(
				(entry) => entry.descriptor.id === "enabled"
			)!
			await act(async () => binding.write(initial))
			expect(toggle.getAttribute("aria-pressed")).toBe("true")
			expect(host.querySelector(".component-controls [aria-label='enabled']")).toBeNull()
			expect(host.querySelector(".component-controls select")).not.toBeNull()
			const details = host.querySelector<HTMLDetailsElement>(".node-title-details")!
			const summary = details.querySelector<HTMLElement>("summary")!
			expect(summary.textContent).toBe(element.name)
			expect(summary.querySelector(".element-icon")).not.toBeNull()
			expect(details.open).toBe(false)
			summary.click()
			expect(details.open).toBe(true)
			expect(details.querySelector("p")!.textContent).toBe(element.description)
			expect(host.querySelector(".summary-info")).toBeNull()
		} finally {
			await act(async () => root.unmount())
			host.remove()
			element.destroy()
		}
	}
)