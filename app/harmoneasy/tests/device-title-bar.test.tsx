// @vitest-environment happy-dom
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { DeviceTitleBar } from "../source/components/graph/DeviceTitleBar"
import { ChainContext } from "../source/components/graph/ChainContext"
import InputManager from "../../../packages/audiobus/io/input-manager"
import OutputManager from "../../../packages/audiobus/io/output-manager"
import AbstractInput from "../../../packages/audiobus/io/inputs/abstract-input"

vi.mock("../source/components/graph/element-icons", () => ({
	deviceIcon: () => "",
	deviceDescription: () => "Plays test notes"
}))
class Input extends AbstractInput {
	destroy() {}
}

it("exposes labelled title controls and updates the toggle when the manager changes", async () => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
	const input = new Input(),
		inputManager = new InputManager(),
		outputManager = new OutputManager()
	inputManager.add(input)
	const chain = {
		inputManager,
		outputManager,
		setInputEnabled: (device: Input, enabled: boolean) =>
			inputManager.setEnabled(device, enabled)
	}
	const host = document.body.appendChild(document.createElement("div"))
	const root = createRoot(host)
	const onRemove = vi.fn(),
		onExpand = vi.fn(),
		onMinimise = vi.fn()
	try {
		await act(async () =>
			root.render(
				<ChainContext.Provider value={{ chain } as any}>
					<DeviceTitleBar
						device={input}
						direction="input"
						expanded={false}
						compact={false}
						onMinimise={onMinimise}
						onRemove={onRemove}
						onExpand={onExpand}
					/>
				</ChainContext.Provider>
			)
		)
		const buttons = host.querySelectorAll("button")
		const toggle = host.querySelector<HTMLButtonElement>(".device-toggle")!
		expect(buttons).toHaveLength(6)
		expect(buttons[0]).toBe(toggle)
		expect(buttons[buttons.length - 1].className).toBe("device-expand")
		const details = host.querySelector("header")!.lastElementChild!
		expect(details.tagName).toBe("DETAILS")
		expect(details.querySelector("summary h6")).not.toBeNull()
		expect(details.querySelector("summary .node-info-icon")).not.toBeNull()
		expect(details.querySelector("p")!.textContent).toBe("Plays test notes")
		expect(host.querySelector(".device-swap")!.textContent).toBe("Swap")
		expect(host.querySelector(".node-actions-left")!.querySelectorAll("button")).toHaveLength(1)
		expect(host.querySelector(".node-actions-right")!.querySelectorAll("button")).toHaveLength(
			5
		)
		const minimise = host.querySelector<HTMLButtonElement>(".device-minimise")!
		expect(minimise.getAttribute("aria-label")).toBe("Minimise input")
		await act(async () => minimise.click())
		expect(onMinimise).toHaveBeenCalledOnce()
		expect(
			[...buttons].every((button) => button.title && button.getAttribute("aria-label"))
		).toBe(true)
		await act(async () => toggle.click())
		expect(inputManager.isEnabled(input)).toBe(false)
		expect(toggle.getAttribute("aria-pressed")).toBe("false")
		expect(toggle.getAttribute("aria-label")).toBe("Enable input")
		await act(async () => inputManager.setEnabled(input, true))
		expect(toggle.getAttribute("aria-pressed")).toBe("true")
		await act(async () => {
			host.querySelector<HTMLButtonElement>(".device-expand")!.click()
			host.querySelector<HTMLButtonElement>(".device-menu")!.click()
			host.querySelector<HTMLButtonElement>(".device-remove")!.click()
		})
		expect(onExpand).toHaveBeenCalledOnce()
		expect(onRemove).toHaveBeenCalledOnce()
		await act(async () =>
			root.render(
				<ChainContext.Provider value={{ chain } as any}>
					<DeviceTitleBar
						device={input}
						direction="input"
						expanded={false}
						compact
						onMinimise={onMinimise}
						onRemove={onRemove}
						onExpand={onExpand}
					/>
				</ChainContext.Provider>
			)
		)
		expect(minimise.getAttribute("aria-label")).toBe("Restore input")
		expect(minimise.getAttribute("aria-expanded")).toBe("false")
	} finally {
		await act(async () => root.unmount())
		host.remove()
		inputManager.destroy()
		outputManager.destroy()
	}
})