// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { readFile } from "node:fs/promises"
import IOChain from "audiobus/io/IO-chain"
import IOChainManager from "audiobus/io/IO-chain-manager"
import { createInputById } from "audiobus/io/input-factory"
import InputChannelTrigger from "audiobus/io/inputs/input-channel-trigger"
import { TransformerEnsemble } from "audiobus/io/transformers/transformer-ensemble"
import { componentBindings } from "audiobus/io/component-ui"
import { deviceId } from "audiobus/io/device-definition"
import { INPUT_EVENT, EVENT_BLUR } from "audiobus/events/event-constants"
import { NOTE_ON, NOTE_OFF } from "audiobus/commands/commands"
import { installSurfaceTriggers } from "../source/components/graph/control-surface-triggers"
import { parsePresetPage, presetWorkspace } from "../source/services/preset-page"

const { Midi } = createRequire(resolve("../../packages/audiobus/package.json"))("@tonejs/midi")
const managers: IOChainManager[] = []
const inputs: InputChannelTrigger[] = []
const cleanups: (() => void)[] = []
function file(channels = [0, 2, 9]) {
	const midi = new Midi()
	midi.header.setTempo(120)
	channels.forEach((channel) => {
		const track = midi.addTrack()
		track.channel = channel
		track.name = `Part ${channel + 1}`
		for (let time = 0; time <= 2; time += 0.5) {
			track.addNote({
				midi: channel === 9 ? 36 : 60 + channel,
				time,
				duration: 0.25,
				velocity: 0.8
			})
		}
	})
	return midi.toArray()
}
function fetchSong(channels = [0, 2, 9]) {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response(file(channels)))
	)
}
function manager() {
	const timer = { now: 0, BPM: 120, isRunning: true } as any
	const m = new IOChainManager({ timer, outputMixer: {} as any })
	managers.push(m)
	return { m, timer }
}
async function ensemble(mode: "keyboard" | "gamepads" = "keyboard") {
	fetchSong()
	const { m, timer } = manager()
	const chain = new IOChain(timer)
	const t = new TransformerEnsemble({
		autoInputs: mode,
		autoJoin: false,
		assist: false,
		midiControlId: "test-ensemble"
	} as any)
	chain.setTransformers([t])
	m.addChain(chain)
	await t.loadMIDIFile("song.mid")
	return { m, chain, t, timer }
}
afterEach(() => {
	cleanups.splice(0).forEach((cleanup) => cleanup())
	managers.splice(0).forEach((m) => m.destroy())
	inputs.splice(0).forEach((input) => input.destroy())
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
	document.body.replaceChildren()
})

describe("per-channel input", () => {
	it("restores through the input factory and exposes a playable pad binding", async () => {
		const input = (await createInputById("channel-trigger", {
			songChannel: 3,
			label: "Bass",
			key: "a",
			now: () => 2
		})) as InputChannelTrigger
		inputs.push(input)
		const commands: any[] = []
		input.addEventListener(INPUT_EVENT, (event: any) => commands.push(event.command))
		const binding = (await componentBindings(input, "bass")).find(
			(b) => b.descriptor.id === "trigger"
		)!
		expect(binding.descriptor).toMatchObject({ widget: "pad", label: "Bass" })
		await binding.write(1)
		await binding.write(0)
		expect(commands.map((c) => [c.type, c.channel, c.startAt])).toEqual([
			[NOTE_ON, 3, 2],
			[NOTE_OFF, 3, 2]
		])
	})
	it("maps one key per input, suppresses repeats and typing, and releases on blur", () => {
		const a = new InputChannelTrigger({ songChannel: 1, key: "a" }),
			b = new InputChannelTrigger({ songChannel: 2, key: "s" })
		inputs.push(a, b)
		const first = vi.fn(),
			second = vi.fn()
		a.addEventListener(INPUT_EVENT, first)
		b.addEventListener(INPUT_EVENT, second)
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }))
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", repeat: true }))
		expect(first).toHaveBeenCalledOnce()
		expect(second).not.toHaveBeenCalled()
		window.dispatchEvent(new Event(EVENT_BLUR))
		expect(first).toHaveBeenCalledTimes(2)
		const text = document.createElement("input")
		document.body.append(text)
		text.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true }))
		expect(second).not.toHaveBeenCalled()
	})
	it("isolates gamepad slots and shares one polling manager between channel inputs", () => {
		const frames = vi.fn(() => 1)
		const cancel = vi.fn()
		vi.stubGlobal("requestAnimationFrame", frames)
		vi.stubGlobal("cancelAnimationFrame", cancel)
		const pads = [0, 1].map((index) => ({
			index,
			id: "same model",
			connected: true,
			mapping: "standard",
			axes: [],
			buttons: [{ pressed: false }]
		}))
		vi.stubGlobal("navigator", { getGamepads: () => pads })
		const a = new InputChannelTrigger({ songChannel: 1, gamepadIndex: 0 }),
			b = new InputChannelTrigger({ songChannel: 2, gamepadIndex: 1 })
		inputs.push(a, b)
		expect(frames).toHaveBeenCalledOnce()
		const first = vi.fn(),
			second = vi.fn()
		a.addEventListener(INPUT_EVENT, first)
		b.addEventListener(INPUT_EVENT, second)
		// The single shared poll callback observes only pad 1 changing.
		pads[1].buttons[0].pressed = true
		;(frames.mock.calls[0] as unknown as [() => void])[0]()
		expect(first).not.toHaveBeenCalled()
		expect(second).toHaveBeenCalledOnce()
		a.destroy()
		expect(cancel).not.toHaveBeenCalled()
		b.destroy()
		expect(cancel).toHaveBeenCalledOnce()
	})
})

describe("automatic song setup", () => {
	it("selects arbitrary songs from the surface library and rebuilds the same setup", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url) =>
				String(url).endsWith("index.json")
					? new Response(
							JSON.stringify([
								{ name: "First song", file: "first.mid" },
								{ name: "Second song", file: "second.mid" }
							])
						)
					: new Response(file(String(url).endsWith("second.mid") ? [1, 9] : [0, 2]))
			)
		)
		const { m, timer } = manager()
		const chain = new IOChain(timer)
		const t = new TransformerEnsemble({ autoInputs: "keyboard", autoJoin: false })
		chain.setTransformers([t])
		m.addChain(chain)
		await t.loadSongLibrary()
		expect(chain.inputs).toHaveLength(0)
		const binding = (await componentBindings(t, `transformer:${t.midiControlId}`)).find(
			(b) => b.descriptor.id === "songLibrary"
		)!
		expect(binding.descriptor.choices?.map((choice) => choice.label)).toContain("Second song")
		await binding.write("midi/first.mid")
		await vi.waitFor(() =>
			expect(t.automaticParts?.map((part) => part.channel)).toEqual([1, 3])
		)
		expect(chain.inputs).toHaveLength(2)
		await binding.write("midi/second.mid")
		await vi.waitFor(() =>
			expect(t.automaticParts?.map((part) => part.channel)).toEqual([2, 10])
		)
		expect(
			chain.inputs.map((input) => (input as InputChannelTrigger).options.songChannel)
		).toEqual([2, 10])
		expect(
			chain.options.controlSurfaces![0].widgets.slice(0, 2).map((w) => JSON.parse(w.key)[1])
		).toEqual(["uploadSong", "songLibrary"])
	})
	it("creates one labelled input and surface pad for every playable channel, including drums", async () => {
		const { chain, t } = await ensemble()
		expect(chain.inputs.map((i) => i.name)).toEqual([
			"Channel 1 · Part 1",
			"Channel 3 · Part 3",
			"Channel 10 · Part 10"
		])
		expect(chain.inputs.map((i) => (i as InputChannelTrigger).options.key)).toEqual([
			"a",
			"s",
			"d"
		])
		expect(t.options.players.map((p) => p.channels)).toEqual([[1], [3], [10]])
		const surface = chain.options.controlSurfaces![0]
		expect(surface.widgets.filter((w) => w.widget === "pad")).toHaveLength(3)
		expect(
			surface.widgets.filter((w) => w.widget === "pad").map((w) => w.trigger?.key)
		).toEqual(["a", "s", "d"])
		for (const connection of surface.connections) {
			const component = connection.componentId.startsWith("transformer:")
				? t
				: chain.inputs.find((i) => deviceId(i) === connection.componentId)!
			const bindings = await componentBindings(component, connection.componentId)
			expect(bindings.map((b) => b.descriptor.id)).toEqual(
				expect.arrayContaining(connection.controlIds)
			)
		}
	})
	it("plays only the channel assigned to a surface pad, without learning any input IDs", async () => {
		const { chain } = await ensemble()
		const delivered = new Promise<void>((resolve) =>
			chain.addEventListener(INPUT_EVENT, () => resolve(), { once: true })
		)
		;(chain.inputs[1] as InputChannelTrigger).setControlValue("trigger", 1)
		await delivered
		expect(
			chain
				.executeQueueAndClearComplete(0)
				.filter((c) => c.type === NOTE_ON)
				.map((c) => c.channel)
		).toEqual([3])
	})
	it("uses surface keyboard triggers without also firing the input keyboard listener", async () => {
		const { m, chain } = await ensemble()
		cleanups.push(installSurfaceTriggers(m))
		const input = chain.inputs[0] as InputChannelTrigger
		const on = vi.fn()
		input.addEventListener(INPUT_EVENT, on)
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }))
		await vi.waitFor(() => expect(on).toHaveBeenCalledOnce())
		window.dispatchEvent(new KeyboardEvent("keyup", { key: "a", bubbles: true }))
		await vi.waitFor(() => expect(on).toHaveBeenCalledTimes(2))
	})
	it("rebuilds for another song, reuses surviving inputs and preserves unrelated controls", async () => {
		const { chain, t } = await ensemble()
		const survivor = chain.inputs[1]
		const custom = {
			id: "custom",
			name: "My surface",
			theme: "neon",
			connections: [],
			widgets: []
		}
		chain.setGraphOptions({ controlSurfaces: [...chain.options.controlSurfaces!, custom] })
		fetchSong([2, 4])
		await t.loadMIDIFile("replacement.mid")
		expect(chain.inputs).toHaveLength(2)
		expect(chain.inputs[0]).toBe(survivor)
		expect(t.options.players.map((p) => p.channels)).toEqual([[3], [5]])
		expect(chain.options.controlSurfaces?.find((s) => s.id === "custom")).toEqual(custom)
		expect(
			chain.options.controlSurfaces
				?.find((s) => s.id.startsWith("ensemble-"))
				?.widgets.filter((w) => w.widget === "pad")
		).toHaveLength(2)
	})
	it("changes to gamepad assignments without rewinding an active performance", async () => {
		const { chain, t } = await ensemble()
		t.transform(
			[
				{
					type: NOTE_ON,
					inputId: deviceId(chain.inputs[0]),
					velocity: 127,
					from: "pad",
					startAt: 0
				} as any
			],
			{ now: 0 } as any
		)
		t.tick(0.25, {} as any)
		t.setConfig("autoInputs", "gamepads")
		expect(t.performanceState.position).toBe(0.25)
		expect(chain.inputs.map((i) => (i as InputChannelTrigger).options.gamepadIndex)).toEqual([
			0, 1, 2
		])
		expect(chain.inputs.map((i) => (i as InputChannelTrigger).options.key)).toEqual([
			"",
			"",
			""
		])
	})
	it("supports all sixteen MIDI channels rather than a six-player limit", async () => {
		const { chain, t } = await ensemble()
		fetchSong(Array.from({ length: 16 }, (_, i) => i))
		await t.loadMIDIFile("sixteen.mid")
		expect(chain.inputs).toHaveLength(16)
		expect(new Set(chain.inputs.map((i) => (i as InputChannelTrigger).options.key)).size).toBe(
			16
		)
		expect(t.options.players).toHaveLength(16)
	})
	it("removes managed inputs and the generated surface when the Ensemble is removed", async () => {
		const { chain, t } = await ensemble()
		chain.transformerManager.removeTransformer(t)
		expect(chain.inputs).toHaveLength(0)
		expect(chain.options.controlSurfaces).toEqual([])
	})
	it("restores uploaded songs and generated input IDs without duplicates", async () => {
		const { m, chain, t } = await ensemble()
		await t.loadMIDIUpload(new File([file()], "uploaded.mid"))
		const original = chain.inputs.map(deviceId)
		const saved = m.exportWorkspace()
		await m.restoreWorkspace(saved)
		const restored = m.activeChain!
		await vi.waitFor(() =>
			expect((restored.transformers[0] as TransformerEnsemble).automaticParts).toHaveLength(3)
		)
		expect(m.restoreWarnings).toEqual([])
		expect(restored.inputs.map(deviceId)).toEqual(original)
		expect(restored.inputs).toHaveLength(3)
		expect(restored.options.controlSurfaces).toHaveLength(1)
	})
})

describe("published ensemble presets", () => {
	it.each([
		"songs/ensemble-ode-keyboard",
		"songs/ensemble-ode-gamepads",
		"songs/ensemble-never-gonna-keyboard",
		"activities/ensemble-any-song",
		"activities/ensemble-any-song-gamepads"
	])("loads %s with matching channel controls and usable song-source controls", async (route) => {
		const page = parsePresetPage(await readFile(`presets/${route}.json`, "utf8"))
		const config = JSON.parse(JSON.parse(page.workspace.chains[0].transformers)[0])
		const surface = page.workspace.chains[0].options.controlSurfaces[0]
		expect(config.autoInputs).toBe(route.includes("gamepads") ? "gamepads" : "keyboard")
		expect(config.assist).toBe(false)
		expect(surface.connections.at(-1).controlIds).toContain("uploadSong")
		if (config.midiFileUrl) {
			const midi = new Midi(await readFile(`public/${config.midiFileUrl}`))
			const channels = [
				...new Set(
					midi.tracks
						.filter((track: any) => track.notes.length)
						.map((track: any) => track.channel + 1)
				)
			].sort((a: any, b: any) => a - b)
			expect(config.players.map((p: any) => p.channels[0])).toEqual(channels)
			expect(surface.widgets.filter((w: any) => w.widget === "pad")).toHaveLength(
				channels.length
			)
		} else {
			expect(page.workspace.chains[0].inputs).toEqual([])
		}
		fetchSong()
		const { m } = manager()
		// No real audio device is needed to validate complete workspace restoration.
		page.workspace.devices = page.workspace.devices.filter((d: any) => d.direction === "input")
		page.workspace.chains[0].outputs = []
		await m.restoreWorkspace(presetWorkspace(page))
		const t = m.activeChain!.transformers[0] as TransformerEnsemble
		await t.loadMIDIFile("arbitrary.mid")
		expect(m.activeChain!.inputs).toHaveLength(3)
		expect(m.restoreWarnings).toEqual([])
	})
})