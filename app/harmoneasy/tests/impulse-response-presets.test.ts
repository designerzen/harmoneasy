// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import OutputImpulseResponse from "../../../packages/audiobus/io/outputs/output-impulse-response"
import { deviceDefinition, defineDevice } from "../../../packages/audiobus/io/device-definition"
import { EVENT_CHANGE } from "../../../packages/audiobus/events/event-constants"
import {
	BUILTIN_ROOM_PRESET,
	IMPULSE_RESPONSE_PRESETS
} from "../../../packages/audiobus/io/outputs/impulse-response-presets"

afterEach(() => vi.unstubAllGlobals())

function setup() {
	const node = (): any => ({
		gain: { value: 1 },
		connect(target: any) {
			return target
		},
		disconnect() {}
	})
	const convolver = node()
	const context: any = {
		sampleRate: 100,
		createGain: node,
		createConvolver: () => convolver,
		createBuffer: () => ({ getChannelData: () => new Float32Array(100) }),
		decodeAudioData: vi.fn(async () => ({ duration: 2 }))
	}
	const fetcher = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }))
	vi.stubGlobal("fetch", fetcher)
	return { context, convolver, fetcher, output: new OutputImpulseResponse(context) }
}

it("ships every preset as a valid, unchanged WAV with an openly licensed attribution notice", () => {
	expect(IMPULSE_RESPONSE_PRESETS.length).toBeGreaterThanOrEqual(25)
	expect(new Set(IMPULSE_RESPONSE_PRESETS.map((preset) => preset.id)).size).toBe(
		IMPULSE_RESPONSE_PRESETS.length
	)
	for (const preset of IMPULSE_RESPONSE_PRESETS) {
		const base = join(
			dirname(fileURLToPath(import.meta.url)),
			"../public/audio/impulse-responses",
			preset.id
		)
		const bytes = readFileSync(`${base}.wav`)
		expect(bytes.toString("ascii", 0, 4)).toBe("RIFF")
		expect(bytes.toString("ascii", 8, 12)).toBe("WAVE")
		expect(bytes.readUInt32LE(4) + 8).toBe(bytes.length)
		let channels = 0
		for (let position = 12; position + 8 <= bytes.length; ) {
			const length = bytes.readUInt32LE(position + 4)
			if (bytes.toString("ascii", position, position + 4) === "fmt ") {
				channels = bytes.readUInt16LE(position + 10)
			}
			position += 8 + length + (length % 2)
		}
		expect([1, 2, 4]).toContain(channels)
		const attribution = readFileSync(`${base}.attribution.txt`, "utf8")
		expect(attribution).not.toMatch(/non.commercial|no derivatives/i)
		expect(attribution).toMatch(/Public Domain|Attribution/)
	}
})

it("loads presets on demand and persists their ID without embedding bundled audio", async () => {
	const { output, context, fetcher } = setup()
	expect(fetcher).not.toHaveBeenCalled()
	await output.loadImpulse("AQID", "custom.wav")
	await output.loadPreset("InsidePiano")
	expect(output.options).toEqual({ mix: 0.5, preset: "InsidePiano" })
	const saved = deviceDefinition(
		defineDevice(output, { factory: "output", type: "impulse-response" })
	)
	const restored = await OutputImpulseResponse.create({ ...saved.options, audioContext: context })
	expect(restored.options).toEqual(output.options)
	expect(fetcher).toHaveBeenCalledTimes(2)
	await restored.loadPreset(BUILTIN_ROOM_PRESET)
	expect(restored.options).toEqual({ mix: 0.5 })
	await output.destroy()
	await restored.destroy()
})

it("retains the selected filter when a preset cannot be fetched or decoded", async () => {
	const { output, convolver, fetcher, context } = setup()
	await output.loadPreset("InsidePiano")
	const previous = convolver.buffer
	fetcher.mockResolvedValueOnce({ ok: false, status: 404 } as any)
	await expect(output.loadPreset("YorkMinster")).rejects.toThrow("Could not load")
	context.decodeAudioData.mockRejectedValueOnce(new Error("Invalid audio"))
	await expect(output.loadPreset("YorkMinster")).rejects.toThrow("Invalid audio")
	expect(output.options.preset).toBe("InsidePiano")
	expect(convolver.buffer).toBe(previous)
	await output.destroy()
})

it("ignores a slow preset decode after a newer selection or custom upload", async () => {
	const { output, context, fetcher } = setup()
	let finish!: (buffer: any) => void
	context.decodeAudioData.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve
			})
	)
	const pending = output.loadPreset("YorkMinster")
	await vi.waitFor(() => expect(finish).toBeTypeOf("function"))
	await output.loadImpulse("AQID", "new.wav")
	finish({ duration: 10 })
	await pending
	expect(output.options.filename).toBe("new.wav")
	expect(output.options.preset).toBeUndefined()
	const count = fetcher.mock.calls.length
	await expect(output.loadPreset("unknown")).rejects.toThrow("Unknown impulse response preset")
	expect(fetcher).toHaveBeenCalledTimes(count)
	await output.destroy()
})

it("offers grouped presets and attribution links, and rolls the dropdown back on failure", async () => {
	const { output, fetcher } = setup()
	const panel = await output.createGui()
	const select = panel.querySelector("select")!
	expect(select.querySelectorAll("optgroup")).toHaveLength(5)
	expect(select.querySelectorAll("option")).toHaveLength(IMPULSE_RESPONSE_PRESETS.length + 2)
	select.value = "InsidePiano"
	select.dispatchEvent(new Event(EVENT_CHANGE))
	await vi.waitFor(() => expect(output.options.preset).toBe("InsidePiano"))
	expect(panel.querySelector("small")?.textContent).toContain("Andi · CC BY-SA 3.0")
	expect(panel.querySelector("small a")?.getAttribute("href")).toBe(
		"/audio/impulse-responses/InsidePiano.attribution.txt"
	)
	fetcher.mockRejectedValueOnce(new Error("Offline"))
	select.value = "YorkMinster"
	select.dispatchEvent(new Event(EVENT_CHANGE))
	await vi.waitFor(() => expect(panel.querySelector("output")?.textContent).toBe("Offline"))
	expect(select.value).toBe("InsidePiano")
	await output.destroy()
})