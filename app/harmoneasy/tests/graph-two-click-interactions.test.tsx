// @vitest-environment happy-dom
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ControlSurface } from "control-surface"
import { bindingKey } from "control-surface/model"
import type { ControlBinding, SurfaceState } from "control-surface/types"
import {
	EVENT_KEY_DOWN,
	EVENT_POINTER_DOWN,
	EVENT_POINTER_MOVE,
	EVENT_POINTER_UP
} from "../../../packages/control-surface/src/events"
import {
	bezierPreviewPath,
	buildConnectionCandidate,
	describeConnectionStory,
	describeHandleAction,
	inferConnectionIntent,
	nudgePosition
} from "../source/components/graph/graph-interactions"
import { CONTROL_HANDLE, SURFACE_HANDLE } from "../source/components/graph/control-surfaces"
import { AUDIO_HANDLE } from "../source/components/graph/layout"
import { NodeHeader } from "../source/components/graph/NodeHeader"
import { GraphControls } from "../source/components/graph/GraphControls"

const setViewportMock = vi.fn(async () => true)
const zoomInMock = vi.fn(async () => true)
const zoomOutMock = vi.fn(async () => true)
const fitViewMock = vi.fn(async () => true)
const viewportState = { x: 100, y: 50, zoom: 1 }

vi.mock("@xyflow/react", () => ({
	Controls: ({ children, ...props }: any) => <div {...props}>{children}</div>,
	ControlButton: ({ children, ...props }: any) => (
		<button type="button" {...props}>
			{children}
		</button>
	),
	useReactFlow: () => ({
		zoomIn: zoomInMock,
		zoomOut: zoomOutMock,
		fitView: fitViewMock,
		getViewport: () => ({ ...viewportState }),
		setViewport: setViewportMock
	}),
	useViewport: () => ({ ...viewportState })
}))

vi.mock("../../../packages/control-surface/src/renderer", () => ({
	GpuSurfaceRenderer: {
		create: vi.fn(async () => {
			throw new Error("No test GPU")
		})
	}
}))

describe("Graph 2-click wiring & node placement helpers", () => {
	it("normalizes 2-click connections in either direction and generates visual storytelling copy", () => {
		expect(inferConnectionIntent(CONTROL_HANDLE)).toBe("controls")
		expect(inferConnectionIntent(SURFACE_HANDLE)).toBe("controls")
		expect(inferConnectionIntent(AUDIO_HANDLE)).toBe("audio")
		expect(inferConnectionIntent("audio-in")).toBe("audio")
		expect(inferConnectionIntent(null)).toBe("signal")

		// Source-first: Synth Controls -> Control Surface
		const forward = buildConnectionCandidate(
			{ nodeId: "synth", handleId: CONTROL_HANDLE, handleType: "source" },
			{ nodeId: "surface", handleId: SURFACE_HANDLE, handleType: "target" }
		)
		expect(forward).toEqual({
			source: "synth",
			target: "surface",
			sourceHandle: CONTROL_HANDLE,
			targetHandle: SURFACE_HANDLE
		})

		// Target-first: Control Surface -> Synth Controls
		const reverse = buildConnectionCandidate(
			{ nodeId: "surface", handleId: SURFACE_HANDLE, handleType: "target" },
			{ nodeId: "synth", handleId: CONTROL_HANDLE, handleType: "source" }
		)
		expect(reverse).toEqual(forward)

		// Rejects self-connection or same handle direction
		expect(
			buildConnectionCandidate(
				{ nodeId: "synth", handleId: CONTROL_HANDLE, handleType: "source" },
				{ nodeId: "synth", handleId: SURFACE_HANDLE, handleType: "target" }
			)
		).toBeNull()
		expect(
			buildConnectionCandidate(
				{ nodeId: "a", handleId: CONTROL_HANDLE, handleType: "source" },
				{ nodeId: "b", handleId: CONTROL_HANDLE, handleType: "source" }
			)
		).toBeNull()

		const pending = {
			nodeId: "synth",
			handleId: CONTROL_HANDLE,
			handleType: "source" as const,
			nodeLabel: "Moog",
			portLabel: "Moog controls",
			intent: "controls" as const
		}
		expect(describeConnectionStory(pending)).toContain("Moog controls")
		expect(describeHandleAction(pending)).toBe("Plug controls")
		expect(bezierPreviewPath({ x: 10, y: 20 }, { x: 210, y: 120 })).toMatch(/^M 10 20 C /)
	})

	it("computes keyboard nudge offsets for 2-click node placement", () => {
		expect(nudgePosition({ x: 100, y: 100 }, "ArrowRight", false)).toEqual({ x: 124, y: 100 })
		expect(nudgePosition({ x: 100, y: 100 }, "ArrowUp", true)).toEqual({ x: 100, y: 36 })
		expect(nudgePosition({ x: 100, y: 100 }, "Enter", false)).toBeNull()
	})
})

describe("Graph single-click pan controls and node move header trigger", () => {
	beforeEach(() => {
		globalThis.IS_REACT_ACT_ENVIRONMENT = true
		setViewportMock.mockClear()
	})

	afterEach(() => {
		document.body.replaceChildren()
		delete document.documentElement.dataset.reducedMotion
	})

	it("pans the graph viewport via single clicks and respects reduced-motion", async () => {
		const host = document.body.appendChild(document.createElement("div"))
		const root = createRoot(host)
		try {
			await act(async () => root.render(<GraphControls layoutMode="horizontal" />))

			await act(async () => {
				host.querySelector<HTMLButtonElement>(".graph-pan-left")!.click()
			})
			expect(setViewportMock).toHaveBeenLastCalledWith(
				{ x: 240, y: 50, zoom: 1 },
				{ duration: 150 }
			)

			document.documentElement.dataset.reducedMotion = "reduce"
			await act(async () => {
				host.querySelector<HTMLButtonElement>(".graph-pan-down")!.click()
			})
			expect(setViewportMock).toHaveBeenLastCalledWith(
				{ x: 100, y: -90, zoom: 1 },
				{ duration: 0 }
			)
		} finally {
			await act(async () => root.unmount())
		}
	})

	it("renders a 2-click Move trigger in NodeHeader while preserving toggle/expand button order", async () => {
		const onMove = vi.fn()
		const host = document.body.appendChild(document.createElement("div"))
		const root = createRoot(host)
		try {
			await act(async () =>
				root.render(
					<NodeHeader
						title="Synth"
						removeLabel="Remove output"
						onRemove={vi.fn()}
						onMove={onMove}
						isMoving={false}
					>
						<button type="button" className="device-toggle">
							On
						</button>
						<button type="button" className="device-expand">
							Expand
						</button>
					</NodeHeader>
				)
			)

			const bar = host.querySelector(".device-title-controls")!
			const buttons = bar.querySelectorAll("button")
			expect(buttons[0].className).toBe("device-toggle")
			expect(buttons[buttons.length - 1].className).toBe("device-expand")

			const moveBtn = host.querySelector<HTMLButtonElement>(".device-move-trigger")!
			expect(moveBtn.getAttribute("aria-pressed")).toBe("false")
			await act(async () => moveBtn.click())
			expect(onMove).toHaveBeenCalledOnce()
		} finally {
			await act(async () => root.unmount())
		}
	})
})

describe("Control Surface 2-click widget move coexisting with drag", () => {
	const views: { destroy(): void }[] = []

	function makeBinding(id: string): ControlBinding {
		let value = 0.5
		return {
			key: bindingKey("synth", id),
			sourceLabel: "Synth",
			descriptor: { id, label: id, widget: "dial", min: 0, max: 1 },
			read: () => value,
			write: async (next) => {
				value = Number(next)
			}
		}
	}

	beforeEach(() => {
		vi.stubGlobal(
			"requestAnimationFrame",
			vi.fn(() => 1)
		)
		vi.stubGlobal("cancelAnimationFrame", vi.fn())
		vi.stubGlobal(
			"IntersectionObserver",
			class {
				observe() {}
				disconnect() {}
			}
		)
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				disconnect() {}
			}
		)
	})

	afterEach(() => {
		views.splice(0).forEach((view) => view.destroy())
		document.body.replaceChildren()
		vi.unstubAllGlobals()
	})

	it("moves a widget with 2 clicks + visual storytelling slots and cancels cleanly on Escape", () => {
		const bindings = [makeBinding("Cutoff"), makeBinding("Resonance"), makeBinding("Drive")]
		const state: SurfaceState = {
			id: "surface",
			name: "Performance",
			connections: [],
			widgets: bindings.map((b) => ({ key: b.key })),
			theme: "neon"
		}
		const change = vi.fn()
		const surface = new ControlSurface({ state, bindings, editing: true, change })
		views.push(surface)
		document.body.append(surface.element)

		// Click 1: pick up "Cutoff"
		const moveCutoff = surface.element.querySelector<HTMLButtonElement>(
			'button[aria-label="Move Cutoff"]'
		)!
		moveCutoff.click()

		expect(surface.element.classList.contains("cs-moving")).toBe(true)
		expect(surface.element.querySelector(".cs-moving-source")).not.toBeNull()
		expect(surface.element.querySelectorAll(".cs-move-destination")).toHaveLength(2)
		const banner = surface.element.querySelector<HTMLElement>(".cs-move-banner")!
		expect(banner.hidden).toBe(false)
		expect(banner.textContent).toContain("Moving Cutoff")

		// Escape cancels move mode without changing order
		surface.element.dispatchEvent(
			new KeyboardEvent(EVENT_KEY_DOWN, { key: "Escape", bubbles: true, cancelable: true })
		)
		expect(surface.element.classList.contains("cs-moving")).toBe(false)
		expect(banner.hidden).toBe(true)
		expect(state.widgets.map((w) => w.key)).toEqual(bindings.map((b) => b.key))

		// Click 1 again -> Click 2 on "Place after Drive"
		surface.element
			.querySelector<HTMLButtonElement>('button[aria-label="Move Cutoff"]')!
			.click()
		const placeAfterDrive = surface.element.querySelector<HTMLButtonElement>(
			'button[aria-label="Place Cutoff after Drive"]'
		)!
		placeAfterDrive.click()

		expect(surface.element.classList.contains("cs-moving")).toBe(false)
		expect(state.widgets.map((w) => w.key)).toEqual([
			bindings[1].key,
			bindings[2].key,
			bindings[0].key
		])
		expect(change).toHaveBeenCalled()
	})

	it("still allows pointer dragging on the Move handle without arming 2-click move mode", () => {
		const bindings = [makeBinding("Cutoff"), makeBinding("Resonance")]
		const state: SurfaceState = {
			id: "surface",
			name: "Performance",
			connections: [],
			widgets: bindings.map((b) => ({ key: b.key })),
			theme: "neon"
		}
		const surface = new ControlSurface({ state, bindings, editing: true, change: vi.fn() })
		views.push(surface)
		document.body.append(surface.element)

		const handle = surface.element.querySelector<HTMLButtonElement>(
			'button[aria-label="Move Cutoff"]'
		)!
		handle.setPointerCapture = vi.fn()
		handle.releasePointerCapture = vi.fn()
		handle.hasPointerCapture = vi.fn(() => true)

		handle.dispatchEvent(
			new PointerEvent(EVENT_POINTER_DOWN, {
				pointerId: 1,
				button: 0,
				clientX: 10,
				clientY: 10,
				bubbles: true
			})
		)
		handle.dispatchEvent(
			new PointerEvent(EVENT_POINTER_MOVE, {
				pointerId: 1,
				clientX: 120,
				clientY: 10,
				bubbles: true
			})
		)
		handle.dispatchEvent(
			new PointerEvent(EVENT_POINTER_UP, {
				pointerId: 1,
				clientX: 120,
				clientY: 10,
				bubbles: true
			})
		)
		// Browser click immediately following a completed drag must be suppressed by layoutHandle
		handle.click()

		expect(surface.element.classList.contains("cs-moving")).toBe(false)
	})
})
