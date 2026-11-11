import { engineGain } from "../../../packages/audiobus/instruments/engine-levels"
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import PolySynth from "../../../packages/audiobus/instruments/polyphonic.ts"
import SynthOscillator from "../../../packages/audiobus/instruments/oscillators/synth-oscillator.ts"
import {
	EVENT_CHANGE,
	EVENT_CONFIGURATION_CHANGED,
	EVENT_INPUT,
	EVENT_OUTPUTS_UPDATED
} from "../../../packages/audiobus/events/event-constants.ts"
import { defineDevice, deviceDefinition } from "../../../packages/audiobus/io/device-definition.ts"
import OutputManager from "../../../packages/audiobus/io/output-manager.ts"
import { componentBindings } from "../../../packages/audiobus/io/component-ui"
import { isConfigurationUpdate } from "../../../packages/audiobus/io/configuration-events"

function param(value = 0) {
	return {
		value,
		cancelScheduledValues: vi.fn(),
		linearRampToValueAtTime: vi.fn(),
		setValueAtTime: vi.fn()
	}
}

function setup(options = {}) {
	vi.stubGlobal(
		"BiquadFilterNode",
		class {
			frequency = param()
			Q = param()
			connect = vi.fn()
			constructor(_context: unknown, options: any) {
				this.frequency.value = options.frequency
				this.Q.value = options.Q
			}
		}
	)
	const audio = {
		currentTime: 0,
		createGain: () => ({ gain: param(1), connect: vi.fn() }),
		createWaveShaper: () => ({ curve: null, connect: vi.fn() }),
		createOscillator: () => ({ frequency: param(), connect: vi.fn(), start: vi.fn() })
	} as unknown as AudioContext
	const synth = defineDevice(
		new PolySynth(audio, { class: SynthOscillator, maxPolyphony: 3, ...options }),
		{ factory: "polyphonic" }
	)
	return { synth, audio }
}

afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
	document.body.replaceChildren()
})

describe("PolySynth controls", () => {
	it("groups ADSR into a surface envelope while retaining individual parameter bindings", async () => {
		const { synth } = setup()
		const bindings = await componentBindings(synth, "poly")
		const envelope = bindings.find((binding) => binding.descriptor.widget === "envelope")!
		expect(await envelope.read()).toEqual([0.4, 0.9, 0.85, 0.3])
		await envelope.write([0.12, 0.5, 0.6, 1.2])
		expect(synth.options).toMatchObject({
			attack: 0.12,
			decay: 0.5,
			sustain: 0.6,
			release: 1.2
		})
		const attack = bindings.find((binding) => binding.descriptor.id === "attack")!
		expect(attack.read()).toBe(0.12)
		synth.configure({ sustain: 0.4 })
		expect(await envelope.read()).toEqual([0.12, 0.5, 0.4, 1.2])
	})
	it("binds surface dials directly without constructing or dispatching into the legacy GUI", async () => {
		const { synth } = setup()
		const gui = vi.spyOn(synth, "createGui")
		const bindings = await componentBindings(synth, "poly")
		const attack = bindings.find((binding) => binding.descriptor.id === "attack")!
		expect(attack.descriptor.widget).toBe("dial")
		expect(attack.write(0.75)).toBeUndefined()
		expect(synth.options.attack).toBe(0.75)
		expect(attack.read()).toBe(0.75)
		expect(gui).not.toHaveBeenCalled()
	})
	it("marks continuous sound edits as configuration updates while additions remain structural", () => {
		const { synth } = setup(),
			manager = new OutputManager(),
			events: Event[] = []
		manager.addEventListener(EVENT_OUTPUTS_UPDATED, (event) => events.push(event))
		manager.add(synth)
		synth.configure({ attack: 0.75 })
		expect(isConfigurationUpdate(events[0])).toBe(false)
		expect(isConfigurationUpdate(events[1])).toBe(true)
		manager.remove(synth)
		expect(isConfigurationUpdate(events[2])).toBe(false)
	})
	it("notifies session saving about sound edits and removes the subscription with the output", () => {
		const { synth } = setup()
		const manager = new OutputManager()
		manager.add(synth)
		const save = vi.fn()
		manager.addEventListener(EVENT_OUTPUTS_UPDATED, save)
		synth.configure({ attack: 0.25 })
		expect(save).toHaveBeenCalledTimes(1)
		manager.remove(synth)
		save.mockClear()
		synth.configure({ attack: 0.5 })
		expect(save).not.toHaveBeenCalled()
	})

	it("applies changes made before voice initialization to every new voice", async () => {
		const { synth } = setup()
		synth.configure({ shape: "triangle", attack: 0.12, filterCutOff: 800 })
		await Promise.resolve()
		expect(synth.instruments).toHaveLength(3)
		for (const voice of synth.instruments) {
			expect(voice.options).toMatchObject({
				shape: "triangle",
				attack: 0.12,
				filterCutOff: 800
			})
			expect(voice.filterNode.frequency.value).toBe(800)
		}
	})

	it("edits sound across playing and idle voices without losing held notes", async () => {
		const { synth } = setup()
		await Promise.resolve()
		await synth.noteOn(60)
		const active = synth.instrumentActivity.get(60)
		const changed = vi.fn()
		synth.addEventListener(EVENT_CONFIGURATION_CHANGED, changed)
		synth.configure({
			shape: "square",
			attack: 0.1,
			release: 1.2,
			filterCutOff: 900,
			filterResonance: 4
		})
		for (const voice of synth.instruments) {
			expect(voice.options).toMatchObject({
				shape: "square",
				attack: 0.1,
				release: 1.2,
				filterCutOff: 900,
				filterResonance: 4
			})
			expect(voice.filterNode.frequency.linearRampToValueAtTime).toHaveBeenCalledWith(
				900,
				expect.any(Number)
			)
			expect(voice.filterNode.Q.linearRampToValueAtTime).toHaveBeenCalledWith(
				4,
				expect.any(Number)
			)
		}
		expect(active.oscillator.type).toBe("square")
		expect(active.oscillator.connect).toHaveBeenCalledWith(active.filterNode)
		expect(synth.instrumentActivity.get(60)).toBe(active)
		expect(changed).toHaveBeenCalledTimes(1)
		expect(deviceDefinition(synth).options).toMatchObject({
			shape: "square",
			release: 1.2,
			filterCutOff: 900
		})
	})

	it("keeps volume independent of polyphony headroom and rejects invalid settings", async () => {
		const { synth } = setup()
		synth.configure({
			volume: 0.25,
			attack: -10,
			sustain: 4,
			release: NaN,
			shape: "invalid" as any
		})
		expect((synth.output as GainNode).gain.value).toBeCloseTo(0.25 * engineGain("polyphonic"))
		expect(synth.options).toMatchObject({
			volume: 0.25,
			attack: 0,
			sustain: 1,
			release: 0.3,
			shape: "sine"
		})
		await Promise.resolve()
		await synth.noteOn(60)
		synth.allNotesOff()
		expect((synth.output as GainNode).gain.value).toBeCloseTo(0.25 * engineGain("polyphonic"))
	})

	it("connects labeled controls to sound settings and retains settings when reopened", async () => {
		const { synth } = setup({ shape: "sawtooth", sustain: 0.6 })
		const gui = await synth.createGui()
		document.body.append(gui)
		expect(await synth.createGui()).toBe(gui)
		const shape = gui.querySelector<HTMLSelectElement>('[name="shape"]')!
		expect(shape.value).toBe("sawtooth")
		shape.value = "triangle"
		shape.dispatchEvent(new Event(EVENT_CHANGE))
		const attack = gui
			.querySelector("adsr-shaper")!
			.shadowRoot!.querySelector<HTMLInputElement>('[name="attack"]')!
		attack.value = "0.25"
		attack.dispatchEvent(new Event(EVENT_INPUT))
		expect(synth.options).toMatchObject({ shape: "triangle", attack: 0.25 })
		expect(attack.getAttribute("aria-valuetext")).toBe("0.25 s")
		synth.configure({ sustain: 0.4 })
		expect(
			gui
				.querySelector("adsr-shaper")!
				.shadowRoot!.querySelector<HTMLInputElement>('[name="sustain"]')!.value
		).toBe("40")
		await synth.destroyGui()
		expect(gui.isConnected).toBe(false)
		attack.value = "1"
		attack.dispatchEvent(new Event(EVENT_INPUT))
		expect(synth.options.attack).toBe(0.25)
		const reopened = await synth.createGui()
		expect(reopened).not.toBe(gui)
		expect(
			reopened
				.querySelector("adsr-shaper")!
				.shadowRoot!.querySelector<HTMLInputElement>('[name="attack"]')!.value
		).toBe("0.25")
		await synth.destroyGui()
	})

	it("includes triangle in random timbres and updates the displayed waveform", async () => {
		const { synth } = setup()
		const gui = await synth.createGui()
		vi.spyOn(Math, "random").mockReturnValue(0.999)
		await synth.setRandomTimbre()
		expect(synth.options.shape).toBe("triangle")
		expect(gui.querySelector<HTMLSelectElement>('[name="shape"]')!.value).toBe("triangle")
		await synth.destroyGui()
	})
})