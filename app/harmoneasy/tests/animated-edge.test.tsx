// @vitest-environment happy-dom
import React, { act, Profiler } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { AnimatedSVGEdge } from "../source/components/graph/AnimatedSVGEdge"
import { ChainContext } from "../source/components/graph/ChainContext"
import { INPUT_EVENT, NOTE_ON, NOTE_OFF } from "../../../packages/audiobus/commands"

vi.mock("@xyflow/react", () => ({
	BaseEdge: () => null,
	getSmoothStepPath: () => ["M0 0 L100 100"]
}))

it("coalesces matching notes into one animation per frame without React commits", async () => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
	const frames: FrameRequestCallback[] = []
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn((callback) => frames.push(callback))
	)
	const cancel = vi.fn()
	vi.stubGlobal("cancelAnimationFrame", cancel)
	const inputManager = new EventTarget()
	const host = document.body.appendChild(document.createElement("div"))
	const root = createRoot(host)
	const commits = vi.fn()
	const send = (from: string, type = NOTE_ON, velocity = 80) =>
		inputManager.dispatchEvent(
			Object.assign(new Event(INPUT_EVENT), { command: { from, type, velocity, number: 60 } })
		)
	try {
		await act(async () =>
			root.render(
				<ChainContext.Provider value={{ chain: { inputManager } } as any}>
					<Profiler id="edge" onRender={commits}>
						<svg>
							<AnimatedSVGEdge
								{...({
									id: "edge",
									data: { type: "input", name: "piano" },
									sourceX: 0,
									sourceY: 0,
									targetX: 100,
									targetY: 100
								} as any)}
							/>
						</svg>
					</Profiler>
				</ChainContext.Provider>
			)
		)
		const motion = host.querySelector("animateMotion")!
		const begin = vi.fn()
		Object.assign(motion, { beginElement: begin })
		commits.mockClear()
		send("other")
		send("piano", NOTE_OFF)
		send("piano", NOTE_ON, 0)
		expect(frames).toHaveLength(0)
		for (let i = 0; i < 100; i++) {
			send("piano", NOTE_ON, 96)
		}
		expect(frames).toHaveLength(1)
		await act(async () => frames[0](16))
		expect(begin).toHaveBeenCalledOnce()
		expect(host.querySelector("circle")!.getAttribute("r")).toBe("6")
		expect(commits).not.toHaveBeenCalled()
		send("piano")
	} finally {
		await act(async () => root.unmount())
		expect(cancel).toHaveBeenCalled()
		host.remove()
		vi.unstubAllGlobals()
	}
})