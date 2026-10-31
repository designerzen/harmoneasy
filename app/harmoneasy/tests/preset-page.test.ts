// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { readFile } from "node:fs/promises"
import { decompressFromBase64 } from "lz-string"
import {
	loadPresetPage,
	parsePresetPage,
	presetPageUrl,
	presetWorkspace
} from "../source/services/preset-page"
import IOChainManager from "../../../packages/audiobus/io/IO-chain-manager"
import { componentBindings } from "../../../packages/audiobus/io/component-ui"
import { defaultMusicTools } from "../../../packages/audiobus/io/music-tools"
import { createRoomUrl } from "../source/services/room-url"

const json = await readFile("public/preset/hardware/arcana/strum/preset.json", "utf8")
afterEach(() => vi.unstubAllGlobals())

describe("folder preset pages", () => {
	it.each(["", "/", "/index.html"])(
		"loads a preset route ending in %s below the deployment base",
		async (ending) => {
			const fetcher = vi.fn(async () => new Response(json))
			const preset = await loadPresetPage(
				`https://example.test/harmoneasy/preset/hardware/arcana/strum${ending}?ignored=1#room=jam`,
				"/harmoneasy/",
				fetcher
			)
			expect(fetcher).toHaveBeenCalledExactlyOnceWith(
				"https://example.test/harmoneasy/preset/hardware/arcana/strum/preset.json"
			)
			expect(preset?.name).toBe("Arcana Strum")
		}
	)
	it("ignores ordinary pages and refuses encoded or malformed preset paths", async () => {
		const fetcher = vi.fn()
		expect(
			await loadPresetPage("https://example.test/harmoneasy/room/", "/harmoneasy/", fetcher)
		).toBeUndefined()
		expect(fetcher).not.toHaveBeenCalled()
		expect(
			presetPageUrl("https://example.test/preset/hardware/arcana/strum", "/")?.pathname
		).toBe("/preset/hardware/arcana/strum/preset.json")
		for (const path of ["%2e%2e%2fprivate", "hardware//strum", "hardware/%2Fstrum"]) {
			expect(() => presetPageUrl(`https://example.test/preset/${path}`, "/")).toThrow(
				"Invalid preset path"
			)
		}
	})
	it("reports missing and malformed files instead of silently starting a default workspace", async () => {
		await expect(
			loadPresetPage(
				"https://example.test/preset/missing",
				"/",
				async () => new Response(null, { status: 404 })
			)
		).rejects.toThrow("404")
		await expect(
			loadPresetPage(
				"https://example.test/preset/missing",
				"/",
				async () => new Response("<html>fallback</html>")
			)
		).rejects.toThrow()
	})
	it("retains full room state when encoding for the existing workspace restorer", () => {
		const data = JSON.parse(json)
		data.workspace.musicTools = defaultMusicTools()
		data.workspace.chains[1].disabledInputs = ["arcana-strum-input"]
		data.workspace.chains[0].options.positions = { "strum-synth": { x: 200, y: 300 } }
		data.midiControls.bindings = [{ target: "app:volume", cc: 7, channel: 0, source: "" }]
		const preset = parsePresetPage(JSON.stringify(data))
		expect(JSON.parse(decompressFromBase64(presetWorkspace(preset).slice(10)))).toEqual(
			data.workspace
		)
		expect(preset.clock).toEqual(data.clock)
		expect(preset.midiControls).toEqual(data.midiControls)
	})
	it.each([
		(data) => {
			data.version = 2
		},
		(data) => {
			data.clock.bpm = 0
		},
		(data) => {
			data.clock.bars = 0
		},
		(data) => {
			data.midiControls.bindings = [{ cc: 200 }]
		},
		(data) => {
			data.workspace.chains[0].inputs = ["missing"]
		},
		(data) => {
			data.workspace.chains[0].disabledOutputs = ["missing"]
		},
		(data) => {
			data.workspace.chains[0].options.controlSurfaces[0].widgets[0].span = 0
		}
	])("rejects invalid setup state before restoration", (change: (data: any) => void) => {
		const data = JSON.parse(json)
		change(data)
		expect(() => parsePresetPage(JSON.stringify(data))).toThrow()
	})
	it("restores the Arcana fixture with shared input routes and resolvable surface controls", async () => {
		const param = (value = 0) => ({
			value,
			cancelScheduledValues: vi.fn(),
			linearRampToValueAtTime: vi.fn(),
			setValueAtTime: vi.fn()
		})
		vi.stubGlobal(
			"BiquadFilterNode",
			class {
				frequency = param()
				Q = param()
				connect = vi.fn()
			}
		)
		const context = {
			currentTime: 0,
			createGain: () => ({ gain: param(1), connect: vi.fn() }),
			createWaveShaper: () => ({ curve: null, connect: vi.fn() }),
			createOscillator: () => ({ frequency: param(), connect: vi.fn(), start: vi.fn() })
		} as unknown as AudioContext
		const manager = new IOChainManager({
			timer: { now: 0, BPM: 120 } as any,
			outputMixer: context.createGain(),
			audioContext: context
		})
		try {
			await manager.restoreWorkspace(presetWorkspace(parsePresetPage(json)))
			expect(manager.restoreWarnings).toEqual([])
			const performance = manager.getChain("strum-performance")!
			expect(manager.getChain("strum-inspector")!.inputs[0]).toBe(performance.inputs[0])
			for (const connection of performance.options.controlSurfaces![0].connections) {
				const entry = manager.devices.find(
					(device) => device.id === connection.componentId
				)!
				const bindings = await componentBindings(entry.device, entry.id)
				expect(bindings.map((binding) => binding.descriptor.id)).toEqual(
					expect.arrayContaining(connection.controlIds)
				)
			}
		} finally {
			manager.destroy()
		}
	})
	it("creates room invitations at the application root from preset pages", () => {
		const link = createRoomUrl(
			"https://example.test/harmoneasy/preset/hardware/arcana/strum/",
			{ roomId: "jam" }
		)
		expect(new URL(link).pathname).toBe("/harmoneasy/room/")
	})
})