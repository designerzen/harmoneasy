// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import InputComposer from "../../../packages/audiobus/io/inputs/input-composer"
import { createInputById } from "../../../packages/audiobus/io/input-factory"
import {
	INPUT_EVENT,
	EVENT_CHANGE,
	EVENT_CONFIGURATION_CHANGED
} from "../../../packages/audiobus/events/event-constants"
import { NOTE_OFF, NOTE_ON } from "../../../packages/audiobus/commands/commands"
import { deviceDefinition, defineDevice } from "../../../packages/audiobus/io/device-definition"
import IOChain from "../../../packages/audiobus/io/IO-chain"
import IOChainManager from "../../../packages/audiobus/io/IO-chain-manager"
import { builtinPresetPage } from "../source/services/builtin-preset-pages"

const inputs: InputComposer[] = []
afterEach(() => {
	inputs.splice(0).forEach((input) => input.destroy())
	document.body.replaceChildren()
})

async function setup(bpm = 120) {
	const input = new InputComposer({
		now: () => 0,
		getBpm: () => bpm,
		composer: { seed: "graph" }
	})
	inputs.push(input)
	const received: any[] = []
	input.addEventListener(INPUT_EVENT, (event) => received.push((event as any).command))
	await input.createGui()
	return { input, received }
}

describe("Composer input", () => {
	it("is created by the input factory", async () => {
		const input = await createInputById("composer", {})
		inputs.push(input as InputComposer)
		expect(input.name).toBe("Composer")
	})

	it("plays notes only as the shared transport advances, and releases them on stop", async () => {
		const { input, received } = await setup()
		input.startClock()
		await vi.waitFor(() => expect(received.length).toBeGreaterThan(0))
		const before = received.length
		input.updateTime(10)
		input.updateTime(10.5)
		expect(received.length).toBeGreaterThan(before)
		expect(received.some((command) => command.type === NOTE_ON)).toBe(true)
		input.stopClock()
		const held = received.filter((c) => c.type === NOTE_ON).length
		expect(received.filter((c) => c.type === NOTE_OFF).length).toBe(held)
		const after = received.length
		input.updateTime(20)
		expect(received.length).toBe(after)
	})

	it("follows the host tempo and persists the composer's selections", async () => {
		const { input } = await setup(90)
		input.startClock()
		input.updateTime(1)
		input.updateTime(1.1)
		expect(input.options.composer.tempo).toBe(90)
		expect(input.options.composer.seed).toBe("graph")
	})

	it("mounts the Plutchik panel with host-owned tempo and round-trips saved selections", async () => {
		const { input, received } = await setup(90)
		defineDevice(input, { factory: "input", type: "composer" })
		const changed = vi.fn()
		input.addEventListener(EVENT_CONFIGURATION_CHANGED, changed)
		const panel = await input.createGui()
		document.body.append(panel)
		expect(panel.hostClock).toBe(true)
		const tempo = panel.shadowRoot!.querySelector<HTMLInputElement>('[name="tempo"]')!
		expect(tempo.disabled).toBe(true)
		tempo.value = "200"
		tempo.dispatchEvent(new Event(EVENT_CHANGE, { bubbles: true }))
		expect(panel.options.tempo).toBe(90)
		panel.configure({ emotion: "fear", energy: 0.3, algorithm: "life", seed: "saved-theme" })
		expect(changed).toHaveBeenCalled()
		const definition = JSON.parse(JSON.stringify(deviceDefinition(input)))
		expect(definition.options.composer).toMatchObject({
			emotion: "fear",
			energy: 0.3,
			algorithm: "life",
			seed: "saved-theme"
		})
		const restored = (await createInputById("composer", definition.options)) as InputComposer
		inputs.push(restored)
		expect((await restored.createGui()).options).toMatchObject({
			emotion: "fear",
			energy: 0.3,
			algorithm: "life",
			seed: "saved-theme"
		})
		expect(received).toHaveLength(0)
	})

	it("keeps the engine clocked when its settings panel closes, without losing the graph output", async () => {
		const { input, received } = await setup()
		const panel = await input.createGui()
		document.body.append(panel)
		input.startClock()
		await vi.waitFor(() => expect(panel.playing).toBe(true))
		input.updateTime(0)
		await input.destroyGui()
		expect(panel.isConnected).toBe(false)
		expect(panel.playing).toBe(true)
		const count = received.length
		input.updateTime(0.5)
		expect(received.length).toBeGreaterThan(count)
		expect(await input.createGui()).toBe(panel)
		document.body.append(panel)
		expect(panel.playing).toBe(true)
		input.stopClock()
		expect(panel.playing).toBe(false)
	})

	it("does not resurrect a composer destroyed during its lazy start", async () => {
		const input = new InputComposer({ composer: { seed: "cancelled" } })
		inputs.push(input)
		const received = vi.fn()
		input.addEventListener(INPUT_EVENT, received)
		input.startClock()
		input.destroy()
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(received).not.toHaveBeenCalled()
		await expect(input.createGui()).rejects.toThrow("destroyed")
	})

	it.each([1000, -1])(
		"releases the phrase on a clock discontinuity to %s without a catch-up burst",
		async (time) => {
			const { input, received } = await setup()
			input.startClock()
			await vi.waitFor(() => expect(received.length).toBeGreaterThan(0))
			input.updateTime(0)
			const attacks = received.filter((c) => c.type === NOTE_ON).length
			input.updateTime(time)
			expect(received.filter((c) => c.type === NOTE_ON)).toHaveLength(attacks)
			expect(received.filter((c) => c.type === NOTE_OFF)).toHaveLength(attacks)
			const count = received.length
			input.updateTime(time + 0.1)
			expect(received).toHaveLength(count)
		}
	)

	it("starts a composer added while transport is running and routes its channels through the chain", async () => {
		let now = 0
		const { input } = await setup()
		const panel = await input.createGui()
		input.options.now = () => now
		const start = vi.spyOn(input, "startClock")
		const output = Object.assign(new EventTarget(), {
			uuid: "monitor",
			name: "Monitor",
			isConnected: true,
			getNoteKey: (command: any) => `${command.channel}:${command.number}`,
			sendCommand: vi.fn(),
			noteOn: vi.fn(),
			noteOff: vi.fn(),
			allNotesOff: vi.fn()
		})
		const timer = {
			now: 0,
			BPM: 120,
			isRunning: true,
			stop: vi.fn(async () => {
				timer.isRunning = false
			})
		}
		const manager = new IOChainManager({
			timer: timer as any,
			outputMixer: {} as GainNode,
			externalDevices: { composer: input, monitor: output }
		})
		const chain = new IOChain(timer as any)
		chain.setTransformers([])
		manager.addChain(chain)
		manager.updateTime(0, 0)
		try {
			chain.addInput(input)
			chain.addOutput(output as any)
			now = timer.now = 0.1
			manager.updateTime(now, 1)
			await vi.waitFor(() => expect(panel.playing).toBe(true))
			// Notes carry the genre's timing feel, so some arrive just after the downbeat and are
			// queued asynchronously: keep the clock moving until every channel has been routed.
			let step = 1
			await vi.waitFor(() => {
				step++
				now = timer.now = step / 10
				manager.updateTime(now, step)
				const commands = output.sendCommand.mock.calls.map(([command]) => command)
				for (const channel of [1, 2, 3, 10]) {
					expect(commands.some((c) => c.type === NOTE_ON && c.channel === channel)).toBe(
						true
					)
				}
			})
			expect(start).toHaveBeenCalledTimes(1)
			await manager.transport("stop")
			expect((await input.createGui()).playing).toBe(false)
		} finally {
			manager.destroy()
		}
	})

	it("exposes an immediately playable preset with the Composer controls and a piano output", () => {
		const preset = builtinPresetPage({ id: "emotion-composer" })
		expect(preset.clock.bpm).toBe(104)
		expect(preset.workspace.devices.find((d) => d.id === "composer")?.definition.type).toBe(
			"composer"
		)
		expect(preset.workspace.chains[0].inputs).toContain("composer")
		expect(preset.workspace.chains[0].options.controlSurfaces![0].panels).toContain("composer")
		expect(preset.workspace.devices.find((d) => d.id === "synth")?.definition.type).toBe(
			"rompler"
		)
	})
})