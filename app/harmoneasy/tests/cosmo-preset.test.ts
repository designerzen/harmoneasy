// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFile } from "node:fs/promises"
import { parsePresetPage, presetWorkspace } from "../source/services/preset-page"
import IOChainManager from "audiobus/io/IO-chain-manager"
import OutputManager from "audiobus/io/output-manager"
import InputCosmoDots from "audiobus/io/inputs/input-cosmo-dots"
import OutputYoshimi from "audiobus/io/outputs/output-yoshimi"
import { componentBindings } from "audiobus/io/component-ui"
import { controlComponents, removeSurface } from "../source/components/graph/control-surfaces"
import { EVENT_CONTROL_SURFACE_EXPAND } from "audiobus/event-constants"
import { createChainWorkspace } from "../source/components/graph/chain-workspace"

vi.mock("../../../packages/audiobus/wam/yoshimi-assets", () => ({
	loadYoshimi: vi.fn(),
	yoshimiAsset: (path: string) => path
}))
vi.mock("../../../packages/control-surface/src/renderer", () => ({
	GpuSurfaceRenderer: {
		create: async () => {
			throw new Error("No test GPU")
		}
	}
}))
const json = await readFile("presets/hardware/cosmo/dots.json", "utf8")
const banks = await readFile("../../packages/audiobus/wam/yoshimi/banks/root.json", "utf8")
let manager: IOChainManager
let workspace: ReturnType<typeof createChainWorkspace> | undefined
const postMessage = vi.fn()
const settle = async () => {
	for (let i = 0; i < 30; i++) {
		await Promise.resolve()
	}
}
beforeEach(async () => {
	vi.useFakeTimers()
	vi.stubGlobal("requestAnimationFrame", () => 1)
	vi.stubGlobal("cancelAnimationFrame", vi.fn())
	vi.stubGlobal(
		"IntersectionObserver",
		class {
			observe() {}
			disconnect() {}
		}
	)
	vi.stubGlobal(
		"AudioWorkletNode",
		class {
			port = { postMessage, close: vi.fn() }
			connect = vi.fn()
			disconnect = vi.fn()
		}
	)
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async (path: string) =>
				new Response(path.endsWith("root.json") ? banks : "<instrument/>")
		)
	)
	const context = {
		currentTime: 0,
		destination: {},
		createGain: () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() })
	} as unknown as AudioContext
	manager = new IOChainManager({
		timer: { now: 0, BPM: 100, isRunning: true, divisions: 24 } as any,
		audioContext: context,
		outputMixer: context.createGain()
	})
	await manager.restoreWorkspace(presetWorkspace(parsePresetPage(json)))
	postMessage.mockClear()
})
afterEach(async () => {
	workspace?.destroy()
	workspace = undefined
	manager.destroy()
	await settle()
	vi.unstubAllGlobals()
	vi.useRealTimers()
	document.body.replaceChildren()
})
describe("Cosmo Dots Strings preset", () => {
	it("restores the complete chain and Strings patch with every surface control available", async () => {
		expect(manager.restoreWarnings).toEqual([])
		const chain = manager.activeChain!
		expect(chain.transformers.map((transformer) => transformer.type)).toEqual([
			"Quantiser",
			"Harmoniser",
			"Chordifier"
		])
		const output = chain.outputs[0] as OutputYoshimi
		expect(output.options).toMatchObject({ bank: "Strings", preset: "0033-Strings1.xiz" })
		for (const connection of chain.options.controlSurfaces![0].connections) {
			const bindings = await componentBindings(
				controlComponents(chain).get(connection.componentId)!,
				connection.componentId
			)
			expect(bindings.map((binding) => binding.descriptor.id)).toEqual(
				expect.arrayContaining(connection.controlIds)
			)
		}
		await output.setControlValue("instrument", "Strings/0065-Simple Strings.xiz")
		await output.setControlValue("cutoff", 90)
		expect(postMessage).toHaveBeenCalledWith({ type: "midi", data: [0xb0, 74, 90] })
		expect(
			manager.exportWorkspaceData().devices.find((device) => device.id === "cosmo-yoshimi")!
				.definition.options
		).toMatchObject({ preset: "0065-Simple Strings.xiz", cutoff: 90 })
	})
	it("plays chord notes from a Dot and releases them after its configured duration", async () => {
		const chain = manager.activeChain!
		const input = chain.inputs[0] as InputCosmoDots
		input.activate(0)
		await settle()
		manager.updateTime(1, 24)
		await OutputManager.settled(chain.outputs[0])
		const on = postMessage.mock.calls.filter(
			([message]) => message.type === "midi" && (message.data[0] & 0xf0) === 0x90
		)
		expect(on).toHaveLength(3)
		vi.advanceTimersByTime(650)
		await settle()
		manager.updateTime(2, 48)
		await OutputManager.settled(chain.outputs[0])
		const off = postMessage.mock.calls.filter(
			([message]) => message.type === "midi" && (message.data[0] & 0xf0) === 0x80
		)
		expect(off.map(([message]) => message.data[1])).toEqual(
			on.map(([message]) => message.data[1])
		)
	})
	it("opens the control surface first and keeps playable SVG Dots available when editing routing", async () => {
		document.body.innerHTML = '<div id="graph"></div>'
		workspace = createChainWorkspace(
			document.getElementById("graph")!,
			manager,
			() => ({
				update: vi.fn(),
				destroy: vi.fn()
			}),
			true
		)
		await settle()
		const graph = document.querySelector<HTMLElement>(".chain-graph")!
		const surface = document.querySelector<HTMLElement>(".surface-viewport")!
		expect(surface.isConnected).toBe(true)
		expect(surface.hidden).toBe(false)
		expect(surface.querySelectorAll("button[data-cosmo-dot] svg")).toHaveLength(8)
		const input = manager.activeChain!.inputs[0] as InputCosmoDots
		input.setDotCount(3)
		expect(surface.querySelectorAll("button[data-cosmo-dot] svg")).toHaveLength(3)
		surface.querySelector<HTMLButtonElement>(".device-expand")!.click()
		expect(graph.hidden).toBe(false)
		expect(surface.isConnected).toBe(false)
		manager.activeChain!.dispatchEvent(
			new CustomEvent(EVENT_CONTROL_SURFACE_EXPAND, { detail: "cosmo-performance" })
		)
		await settle()
		expect(surface.isConnected).toBe(true)
		expect(surface.querySelectorAll("button[data-cosmo-dot] svg")).toHaveLength(3)
		removeSurface(manager.activeChain!, "cosmo-performance")
		expect(graph.hidden).toBe(false)
		expect(manager.activeChain!.options.mainSurfaceId).toBeUndefined()
	})
})