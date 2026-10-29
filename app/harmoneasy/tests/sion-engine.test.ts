// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import OutputSiON from "../../../packages/audiobus/io/outputs/output-sion"
import { createSiONSession, type SiONSession } from "../../../packages/sion/SiON.js"

const sessions: SiONSession[] = []
const outputs: OutputSiON[] = []
function setup() {
	const nodes: any[] = []
	const worklets: any[] = []
	const node = () => {
		const result = {
			gain: { value: 1 },
			pan: { value: 0 },
			connect: vi.fn((target: any) => target),
			disconnect: vi.fn(),
			fftSize: 32,
			getFloatTimeDomainData() {}
		}
		nodes.push(result)
		return result
	}
	const context = {
		currentTime: 0,
		sampleRate: 44100,
		destination: {},
		createGain: node,
		createStereoPanner: node,
		createAnalyser: node,
		resume: vi.fn().mockResolvedValue(undefined),
		audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) }
	} as any
	vi.stubGlobal(
		"AudioWorkletNode",
		class {
			port = { postMessage: vi.fn(), close: vi.fn(), onmessage: null }
			constructor() {
				worklets.push(this)
			}
			connect = vi.fn()
			disconnect = vi.fn()
		}
	)
	return { context, nodes, worklets }
}
afterEach(() => {
	outputs.splice(0).forEach((output) => output.destroy())
	sessions.splice(0).forEach((session) => session.dispose())
	vi.unstubAllGlobals()
})

it("renders real SiON instrument samples and keeps concurrent sessions independent", async () => {
	const { context } = setup()
	const first = await createSiONSession(context),
		second = await createSiONSession(context)
	sessions.push(first, second)
	expect(first.driver).not.toBe(second.driver)
	expect(first.voices).toContain("midi.piano1")
	first.driver.play()
	second.driver.play()
	first.driver.noteOn(60, first.presets["midi.piano1"], 0, 0, 0, 1)
	second.driver.noteOn(67, second.presets["midi.piano1"], 0, 0, 0, 1)
	// The preserved engine starts streaming on its first enterFrame callback.
	await new Promise((resolve) => setTimeout(resolve, 40))
	const samples = Array.from({ length: 8 }, () => first.driver.sound.provide()).flat()
	expect(samples.length).toBeGreaterThan(0)
	expect(samples.every(Number.isFinite)).toBe(true)
	expect(samples.some((value) => Math.abs(value) > 0.00001)).toBe(true)
	first.dispose()
	expect(second.driver.isPlaying).toBe(true)
	const survivingSamples = Array.from({ length: 8 }, () => second.driver.sound.provide()).flat()
	expect(survivingSamples.some((value) => Math.abs(value) > 0.00001)).toBe(true)
	await Promise.resolve()
	expect(context.audioWorklet.addModule).toHaveBeenCalledTimes(1)
}, 30000)

it("plays live Output notes through the real SiON streaming worklet", async () => {
	const { context, worklets } = setup()
	const output = new OutputSiON({ audioContext: context, preset: "midi.piano1" })
	outputs.push(output)
	await output.noteOn(60, 100)
	await new Promise((resolve) => setTimeout(resolve, 40))
	expect(worklets.length).toBe(1)
	const worklet = worklets[0]
	for (let index = 0; index < 4; index++) {
		worklet.port.onmessage({ data: { type: "need" } })
	}
	expect(
		worklet.port.postMessage.mock.calls.some(([message]: any[]) =>
			message.data?.some((value: number) => Math.abs(value) > 0.00001)
		)
	).toBe(true)
	output.noteOff(60)
	output.allNotesOff()
	expect(worklet.port.close).toHaveBeenCalled()
}, 30000)