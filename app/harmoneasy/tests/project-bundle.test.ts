import { describe, expect, it } from "vitest"
import { createRequire } from "node:module"
import {
	createProjectBundle,
	readProjectBundle,
	portableData,
	bundleWorkspace
} from "../../../packages/audiobus/io/project-bundle"
import { defaultMusicTools } from "../../../packages/audiobus/io/music-tools"
import { parseEventClip, musicalCommand } from "../../../packages/audiobus/io/event-clip"
import { NOTE_ON, NOTE_OFF } from "../../../packages/audiobus/commands"
import IOChainManager from "../../../packages/audiobus/io/IO-chain-manager"
import IOChain from "../../../packages/audiobus/io/IO-chain"
import { TransformerChordTrack } from "../../../packages/audiobus/io/transformers/transformer-chord-track"
const { zipSync, strToU8 } = createRequire(
	new URL("../../../packages/audiobus/package.json", import.meta.url)
)("fflate")

const workspace = () => ({
	version: 2,
	activeChainId: null,
	chains: [],
	devices: [],
	musicTools: defaultMusicTools()
})
const events = () =>
	parseEventClip({
		version: 1,
		duration: 1,
		commands: [
			musicalCommand({
				type: NOTE_ON,
				number: 60,
				channel: 2,
				velocity: 100,
				startAt: 0,
				from: "test"
			}),
			musicalCommand({
				type: NOTE_OFF,
				number: 60,
				channel: 2,
				velocity: 0,
				startAt: 0.5,
				from: "test"
			})
		]
	})
describe("portable project archives", () => {
	it("round trips settings, loops, mappings and audio attachments", async () => {
		const state = workspace()
		state.musicTools.macros[0].mappings.push({ target: "app:volume", minimum: 0, maximum: 100 })
		const midiControls = {
			enabled: true,
			bindings: [{ target: "app:tempo", cc: 20, channel: 16, source: "" }]
		}
		const audio = new Uint8Array([82, 73, 70, 70])
		const bytes = await createProjectBundle({
			name: "Test project",
			workspace: state,
			bpm: 120,
			swing: 0.2,
			midiControls,
			events: events(),
			assets: [{ name: "take.wav", type: "audio/wav", bytes: audio }]
		})
		const restored = await readProjectBundle(bytes)
		expect(restored.manifest.workspace).toEqual(state)
		expect(restored.manifest.midiControls).toEqual(midiControls)
		expect(restored.events?.duration).toBe(1)
		expect(
			restored.events?.commands.map(({ type, number, channel, startAt, velocity }) => ({
				type,
				number,
				channel,
				startAt,
				velocity
			}))
		).toEqual([
			{ type: NOTE_ON, number: 60, channel: 2, startAt: 0, velocity: 100 },
			{ type: NOTE_OFF, number: 60, channel: 2, startAt: 0.5, velocity: 0 }
		])
		expect(restored.files[restored.manifest.assets[0].path]).toEqual(audio)
		expect(bundleWorkspace(restored.manifest)).toMatch(/^workspace:/)
	})
	it("scrubs credentials nested inside serialized transformer JSON and signed URLs", async () => {
		const data = portableData({
			apiKey: "hidden",
			pluginURL: "https://example.com/plugin?access_token=hidden",
			nested: JSON.stringify([
				JSON.stringify({ type: "test", credential: "hidden", other: "safe" })
			]),
			asset: "blob:temporary"
		})
		expect(JSON.stringify(data)).not.toContain("hidden")
		expect(JSON.parse(JSON.parse(data.nested)[0])).toEqual({ type: "test", other: "safe" })
		expect(data.asset).toBe("")
		expect(data.pluginURL).toBe("")
	})
	it("rejects invalid archives, manifests, missing assets and incompatible versions", async () => {
		await expect(readProjectBundle(new Uint8Array([1, 2, 3]))).rejects.toThrow()
		await expect(readProjectBundle(zipSync({ "other.json": strToU8("{}") }))).rejects.toThrow(
			"manifest"
		)
		const bytes = await createProjectBundle({
			name: "test",
			workspace: workspace(),
			bpm: 120,
			swing: 0
		})
		const bundle = await readProjectBundle(bytes)
		for (const patch of [
			{ version: 2 },
			{ bpm: NaN },
			{ assets: [{ path: "assets/missing.wav", name: "missing", type: "audio/wav" }] },
			{ workspace: { ...workspace(), musicTools: { version: 9 } } }
		]) {
			await expect(
				readProjectBundle(
					zipSync({
						"project.json": strToU8(JSON.stringify({ ...bundle.manifest, ...patch }))
					})
				)
			).rejects.toThrow()
		}
	})
	it("preserves chord followers and music tools through manager restore without changing the encoded workspace", async () => {
		const timer = { now: 0, BPM: 120, isRunning: false, stop() {}, start() {} } as any
		const manager = new IOChainManager({ timer, outputMixer: {} as GainNode })
		const chain = new IOChain(timer)
		chain.setTransformers([new TransformerChordTrack({ role: "bass" })])
		manager.addChain(chain)
		const state = manager.musicTools
		state.macros[1].value = 0.4
		manager.setMusicTools(state)
		const encoded = manager.exportWorkspace()
		const archive = await createProjectBundle({
			name: "workspace",
			workspace: manager.exportWorkspaceData(),
			bpm: 120,
			swing: 0
		})
		const restored = new IOChainManager({ timer, outputMixer: {} as GainNode })
		await restored.restoreWorkspace(
			bundleWorkspace((await readProjectBundle(archive)).manifest)
		)
		expect(restored.exportWorkspace()).toBe(encoded)
		expect(restored.activeChain!.transformers[0]).toBeInstanceOf(TransformerChordTrack)
		expect(restored.musicTools.macros[1].value).toBe(0.4)
		manager.destroy()
		restored.destroy()
	})
})