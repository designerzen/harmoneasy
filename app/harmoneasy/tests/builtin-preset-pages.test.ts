// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest"
import {
	builtinPresetPage,
	builtinPresetPages,
	builtinPresetRoute
} from "../source/services/builtin-preset-pages"
import { completePresets, presetSetup } from "../source/components/graph/preset-catalogue"
import { PERFORMANCE_PRESETS } from "../source/services/performance-presets"
import { parsePresetPage, presetPageUrl } from "../source/services/preset-page"
import { createRoomUrl } from "../source/services/room-url"
import { INPUT_DEFINITIONS } from "../../../packages/audiobus/io/input-definitions"
import { createPresetTransformers } from "../../../packages/audiobus/io/transformer-presets"
import { NOTE_ON, NOTE_OFF } from "../../../packages/audiobus/commands/commands"
import { createAudioCommand } from "../../../packages/audiobus/commands/audio-command-factory"
import { createPresetBrowser } from "../source/components/graph/PresetBrowser"
import { decompressFromBase64 } from "lz-string"
import IOChainManager from "../../../packages/audiobus/io/IO-chain-manager"
import { componentBindings } from "../../../packages/audiobus/io/component-ui"
import { presetWorkspace } from "../source/services/preset-page"
import { presetPagesPlugin } from "../scripts/preset-pages.js"
import { parsePresetLibrary } from "../../../packages/audiobus/io/preset-library"

describe("complete public preset catalogue", () => {
	it("serves generated preset data in development below the configured base", () => {
		const plugin = presetPagesPlugin()
		plugin.configResolved({ base: "/app/", publicDir: "public" })
		let middleware: any
		plugin.configureServer({
			middlewares: {
				use: (handler: any) => {
					middleware = handler
				}
			}
		})
		const response = { setHeader: vi.fn(), end: vi.fn() }
		const next = vi.fn()
		middleware({ url: "/app/presets/genres/electro/preset.json?ignored=1" }, response, next)
		expect(JSON.parse(response.end.mock.calls[0][0]).clock.bpm).toBe(125)
		expect(next).not.toHaveBeenCalled()
		middleware({ url: "/presets/genres/electro/preset.json" }, response, next)
		expect(next).toHaveBeenCalledOnce()
	})

	it("restores layered voices with shared input and resolvable sound and transformer controls", async () => {
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
			timer: { now: 0, BPM: 68 } as any,
			outputMixer: context.createGain(),
			audioContext: context
		})
		try {
			const page = builtinPresetPages().get("hardware/leap-motion/aurora")!
			// Substitute only the physical endpoint so this test needs no tracking SDK.
			page.workspace.devices[0].definition = { factory: "keyboard-input" }
			await manager.restoreWorkspace(presetWorkspace(page))
			expect(manager.restoreWarnings).toEqual([])
			const first = manager.getChain("layer-0")!
			const second = manager.getChain("layer-1")!
			expect(first.inputs[0]).toBe(second.inputs[0])
			expect(first.outputs[0]).not.toBe(second.outputs[0])
			for (const chain of [first, second]) {
				for (const connection of chain.options.controlSurfaces![0].connections) {
					const device =
						manager.devices.find((device) => device.id === connection.componentId)
							?.device ??
						chain.transformers.find(
							(transformer) =>
								`transformer:${transformer.midiControlId}` ===
								connection.componentId
						)!
					const bindings = await componentBindings(device, connection.componentId)
					expect(bindings.map((binding) => binding.descriptor.id)).toEqual(
						expect.arrayContaining(connection.controlIds)
					)
				}
			}
		} finally {
			manager.destroy()
			vi.unstubAllGlobals()
		}
	})
	it("publishes every built-in browser entry with a unique route and valid complete workspace", () => {
		const presets = completePresets([])
		const pages = builtinPresetPages()
		expect(new Set(presets.map(builtinPresetRoute)).size).toBe(presets.length)
		for (const preset of presets) {
			const route = builtinPresetRoute(preset)
			const page = pages.get(route)!
			expect(page.name, route).toBe(preset.name)
			expect(() => parsePresetPage(JSON.stringify(page)), route).not.toThrow()
			for (const ending of ["", "/", "/index.html"]) {
				expect(
					presetPageUrl(`https://example.test/app/${route}${ending}`, "/app/")?.pathname
				).toBe(`/app/${route}/preset.json`)
				expect(
					new URL(
						createRoomUrl(`https://example.test/app/${route}${ending}`, {
							roomId: "jam"
						})
					).pathname
				).toBe("/app/room/")
			}
		}
		expect(pages.get("presets/genres/electro")?.clock.bpm).toBe(125)
		expect(pages.get("hardware/cosmo/dots")).toEqual(pages.get("preset/hardware/cosmo/dots"))
		expect(pages.get("hardware/arcana/strum")).toEqual(
			pages.get("presets/hardware/arcana/strum")
		)
	})
	it("provides independent layered instruments with supported inputs and connected surfaces", () => {
		const inputs = new Set<string>()
		for (const preset of PERFORMANCE_PRESETS.filter((item) => item.category !== "Hardware")) {
			const setup = presetSetup(preset)
			expect(setup.chains.length).toBeGreaterThanOrEqual(2)
			const input = setup.devices.find((device) => device.id === "performance-input")!
			inputs.add(input.definition.type!)
			expect(INPUT_DEFINITIONS[input.definition.type!], preset.name).toBeDefined()
			for (const chain of setup.chains) {
				expect(chain.steps.length).toBeGreaterThanOrEqual(2)
				const surfaces = chain.options.controlSurfaces!
				expect(surfaces.length).toBeGreaterThan(0)
				expect(surfaces.map((surface) => surface.id)).toContain(chain.options.mainSurfaceId)
				for (const connection of surfaces.flatMap((surface) => surface.connections)) {
					if (!connection.componentId.startsWith("transformer:")) {
						expect(chain.outputs).toContain(connection.componentId)
					}
				}
				// Exercise the actual configured pipeline over a phrase, including releases.
				const transformers = createPresetTransformers({ ...preset, steps: chain.steps })
				for (const transformer of transformers) {
					const connection = surfaces
						.flatMap((surface) => surface.connections)
						.find(
							(connection) =>
								connection.componentId ===
								`transformer:${transformer.midiControlId}`
						)
					if (connection) {
						expect(
							transformer.getUiDescriptor().controls.map((control) => control.id)
						).toEqual(expect.arrayContaining(connection.controlIds))
					}
				}
				for (let index = 0; index < 16; index++) {
					for (const type of [NOTE_ON, NOTE_OFF]) {
						const notes = transformers.reduce(
							(notes, transformer) =>
								transformer.transform(notes, {
									BPM: 110,
									bpm: 110,
									now: index,
									divisions: 24
								} as any),
							[createAudioCommand(type, 60 + (index % 7), index + 1)]
						)
						for (const note of notes) {
							expect(
								Number.isFinite(note.number),
								`${preset.name}: ${chain.options.name}`
							).toBe(true)
							expect(note.number).toBeGreaterThanOrEqual(0)
							expect(note.number).toBeLessThanOrEqual(127)
						}
					}
				}
			}
			setup.devices[2].definition.options!.volume = 0
			expect(presetSetup(preset).devices[2].definition.options!.volume).toBeGreaterThan(0)
		}
		for (const input of [
			"leap-motion",
			"music-mouse",
			"gamepad-music",
			"camera-gestures",
			"microphone-pitch",
			"step-sequencer",
			"ble-midi",
			"pads",
			"osc"
		]) {
			expect(inputs.has(input)).toBe(true)
		}
	})
	it("keeps a sixteen-bar live set and its distinct timbres intact", () => {
		const page = builtinPresetPages().get("presets/genres/electro/live-set")!
		expect(page.clock).toMatchObject({ bpm: 125, bars: 16 })
		expect(page.workspace.chains).toHaveLength(3)
		const preset = PERFORMANCE_PRESETS.find((preset) => preset.name === page.name)!
		expect(presetSetup(preset).clock).toEqual(page.clock)
		expect(
			new Set(
				page.workspace.devices
					.filter((device: any) => device.definition.factory === "polyphonic")
					.map((device: any) => device.definition.options.shape)
			).size
		).toBe(3)
	})

	it("rejects invalid clock defaults in imported setups", () => {
		const setup = presetSetup(PERFORMANCE_PRESETS[0])
		setup.clock!.bars = 0
		expect(() =>
			parsePresetLibrary(
				JSON.stringify({
					format: "harmoneasy-preset-library",
					version: 1,
					presets: [],
					setups: [setup]
				})
			)
		).toThrow("Invalid setup clock")
	})
	it("applies a performance selection as a complete workspace from the browser", async () => {
		vi.stubGlobal("localStorage", { getItem: () => null })
		const manager = { restoreWorkspace: vi.fn() }
		const onApply = vi.fn()
		const browser = createPresetBrowser({ manager: manager as any, onApply })
		try {
			const card = [...document.querySelectorAll<HTMLButtonElement>("nav button")].find(
				(button) => button.textContent?.includes("Leap Motion Aurora")
			)!
			card.click()
			const apply = document.querySelector<HTMLButtonElement>(".preset-apply-button")!
			expect(apply.textContent).toBe("Replace workspace with Leap Motion Aurora")
			apply.click()
			await Promise.resolve()
			expect(onApply).not.toHaveBeenCalled()
			const encoded = manager.restoreWorkspace.mock.calls[0][0]
			const workspace = JSON.parse(decompressFromBase64(encoded.slice(10)))
			expect(workspace.chains).toHaveLength(2)
			expect(workspace.devices[0].definition.type).toBe("leap-motion")
			expect(
				builtinPresetPage(
					PERFORMANCE_PRESETS.find((preset) => preset.name === "Leap Motion Aurora")!
				).workspace.devices
			).toEqual(workspace.devices)
		} finally {
			browser.destroy()
			vi.unstubAllGlobals()
		}
	})
})