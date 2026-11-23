// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import OutputLyria from "../../../packages/audiobus/io/outputs/output-lyria"
import { generateLyriaTrack, MAX_TRACK_BYTES } from "../../../packages/audiobus/io/lyria"
import {
	readBackingTrack,
	saveBackingTrack
} from "../../../packages/audiobus/io/backing-track-store"
import { OUTPUT_FACTORIES } from "../../../packages/audiobus/io/output-factory"
import { defineDevice, deviceDefinition } from "../../../packages/audiobus/io/device-definition"

vi.mock("../../../packages/audiobus/io/backing-track-store", () => ({
	readBackingTrack: vi.fn(),
	saveBackingTrack: vi.fn()
}))

const outputs: OutputLyria[] = []
beforeEach(() => {
	vi.mocked(saveBackingTrack).mockResolvedValue("saved")
	vi.mocked(readBackingTrack).mockResolvedValue(undefined)
})
afterEach(() => {
	outputs.splice(0).forEach((output) => output.destroy())
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
	vi.clearAllMocks()
})

function context() {
	return {
		currentTime: 10,
		state: "running",
		destination: {},
		resume: vi.fn(async () => {}),
		createGain: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
		decodeAudioData: vi.fn(async (_bytes: ArrayBuffer) => ({ duration: 60 })),
		createBufferSource: vi.fn(() => ({
			buffer: null,
			loop: false,
			connect: vi.fn(),
			disconnect: vi.fn(),
			start: vi.fn(),
			stop: vi.fn(),
			addEventListener: vi.fn()
		}))
	}
}
function player(options: Record<string, any> = {}) {
	const audioContext = context()
	const output = new OutputLyria({ audioContext, mixer: {}, ...options })
	outputs.push(output)
	return { output, audioContext }
}
const bytes = () => new Uint8Array([1, 2, 3]).buffer
const response = () => ({
	steps: [
		{
			type: "model_output",
			content: [
				{ type: "text", text: "A jazz backing track" },
				{ type: "audio", data: "AQID", mime_type: "audio/mp3" }
			]
		}
	]
})
const tick = (step: number, triggerAt = 10 + step / 8) => ({
	step,
	bpm: 120,
	triggerAt,
	stepDuration: 0.125
})

describe("Lyria API", () => {
	it("uses the documented request and reads audio from model output steps", async () => {
		const fetcher = vi.fn(async () => new Response(JSON.stringify(response())))
		vi.stubGlobal("fetch", fetcher)
		const signal = new AbortController().signal
		const track = await generateLyriaTrack("session-key", "jazz", "lyria-3.5", signal)
		expect(new Uint8Array(track.bytes)).toEqual(new Uint8Array([1, 2, 3]))
		expect(track.text).toBe("A jazz backing track")
		const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
		expect(url).not.toContain("session-key")
		expect(init.headers).toMatchObject({
			"x-goog-api-key": "session-key",
			"Api-Revision": "2026-05-20"
		})
		expect(JSON.parse(init.body as string)).toEqual({
			model: "lyria-3.5",
			input: "jazz",
			store: false
		})
		expect(init.signal).toBe(signal)
	})
	it.each([401, 403, 429, 500])(
		"reports HTTP %s without echoing sensitive provider details",
		async (status) => {
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => new Response("sensitive-key", { status }))
			)
			await expect(
				generateLyriaTrack("key", "jazz", "lyria-3.5", new AbortController().signal)
			).rejects.toThrow(`HTTP ${status}`)
			await expect(
				generateLyriaTrack("key", "jazz", "lyria-3.5", new AbortController().signal)
			).rejects.not.toThrow("sensitive-key")
		}
	)
	it("rejects empty credentials before fetching and reports missing audio", async () => {
		const fetcher = vi.fn(async () => new Response(JSON.stringify({ steps: [] })))
		vi.stubGlobal("fetch", fetcher)
		await expect(
			generateLyriaTrack("", "jazz", "lyria-3.5", new AbortController().signal)
		).rejects.toThrow("key")
		expect(fetcher).not.toHaveBeenCalled()
		await expect(
			generateLyriaTrack("key", "jazz", "lyria-3.5", new AbortController().signal)
		).rejects.toThrow("no audio")
	})
})

describe("Lyria backing track", () => {
	it("is discoverable and generates with current tempo and harmony without saving credentials", async () => {
		expect(OUTPUT_FACTORIES.some(({ id }) => id === "lyria")).toBe(true)
		const fetcher = vi.fn(async () => new Response(JSON.stringify(response())))
		vi.stubGlobal("fetch", fetcher)
		const { output } = player({ prompt: "Warm jazz", getBpm: () => 93 })
		output.setHarmony({ root: 0, scale: 2741, chord: 145 })
		defineDevice(output, { factory: "output", type: "lyria" })
		await output.generate("never-save-this-key")
		const body = JSON.parse(
			(fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string
		)
		expect(body.input).toContain("93 BPM")
		expect(body.input).toContain("C major")
		expect(body.input).toContain("without vocals")
		expect(saveBackingTrack).toHaveBeenCalled()
		const saved = JSON.stringify(deviceDefinition(output))
		expect(saved).toContain("trackId")
		expect(saved).not.toContain("never-save-this-key")
		expect(saved).not.toContain("AQID")
	})
	it("starts once on transport, seeks, stops, and rewinds without note triggers", async () => {
		const { output, audioContext } = player()
		await output.loadTrack(bytes(), "backing.mp3")
		output.noteOn(60, 100)
		expect(audioContext.createBufferSource).not.toHaveBeenCalled()
		output.onClockTick(tick(8))
		const first = audioContext.createBufferSource.mock.results[0].value
		expect(first.start).toHaveBeenCalledWith(11, 1)
		expect(first.loop).toBe(false)
		output.onClockTick(tick(8))
		output.onClockTick(tick(9))
		expect(audioContext.createBufferSource).toHaveBeenCalledTimes(1)
		output.onClockTick(tick(20))
		expect(first.stop).toHaveBeenCalled()
		expect(audioContext.createBufferSource.mock.results[1].value.start).toHaveBeenCalledWith(
			12.5,
			2.5
		)
		output.stopClock()
		output.onClockTick(tick(0))
		expect(audioContext.createBufferSource.mock.results[2].value.start).toHaveBeenCalledWith(
			10,
			0
		)
		await output.disconnect()
		output.onClockTick(tick(1))
		expect(audioContext.createBufferSource).toHaveBeenCalledTimes(3)
	})
	it("does not restart a finished track; looping wraps the seek position", async () => {
		const { output, audioContext } = player()
		await output.loadTrack(bytes(), "backing.mp3")
		output.onClockTick(tick(480))
		expect(audioContext.createBufferSource).not.toHaveBeenCalled()
		output.options.loop = true
		output.stopClock()
		output.onClockTick(tick(488))
		expect(audioContext.createBufferSource.mock.results[0].value.start).toHaveBeenCalledWith(
			71,
			1
		)
		expect(audioContext.createBufferSource.mock.results[0].value.loop).toBe(true)
	})
	it("restores locally stored audio and gives recovery instructions for a shared workspace", async () => {
		vi.mocked(readBackingTrack).mockResolvedValueOnce(bytes())
		const { output, audioContext } = player({ trackId: "local-track", fileName: "saved.mp3" })
		await vi.waitFor(() => expect(audioContext.decodeAudioData).toHaveBeenCalled())
		output.onClockTick(tick(0))
		expect(audioContext.createBufferSource).toHaveBeenCalledTimes(1)
		const missing = player({ trackId: "missing" }).output
		const panel = await missing.createGui()
		await vi.waitFor(() => expect(panel.textContent).toContain("Load the downloaded file"))
	})
	it("retains playable audio and download when local storage is full", async () => {
		vi.mocked(saveBackingTrack).mockRejectedValueOnce(new Error("Quota exceeded"))
		const { output, audioContext } = player()
		await output.loadTrack(bytes(), "backing.mp3")
		const panel = await output.createGui()
		expect(panel.textContent).toContain("download before closing")
		expect(output.options.trackId).toBeUndefined()
		output.onClockTick(tick(0))
		expect(audioContext.createBufferSource).toHaveBeenCalledTimes(1)
		expect(
			[...panel.querySelectorAll("button")].find(
				(button) => button.textContent === "Download audio"
			)?.disabled
		).toBe(false)
	})
	it("ignores stale file decodes and rejects oversized files before decoding", async () => {
		const { output, audioContext } = player()
		let resolve!: (value: { duration: number }) => void
		audioContext.decodeAudioData.mockImplementationOnce(
			() =>
				new Promise((done) => {
					resolve = done
				})
		)
		const stale = output.loadTrack(bytes(), "old.mp3")
		await output.loadTrack(bytes(), "new.mp3")
		resolve({ duration: 60 })
		await stale
		expect(output.options.fileName).toBe("new.mp3")
		expect(saveBackingTrack).toHaveBeenCalledTimes(1)
		await expect(
			output.loadTrack(new ArrayBuffer(MAX_TRACK_BYTES + 1), "big.wav")
		).rejects.toThrow("32 MB")
		expect(audioContext.decodeAudioData).toHaveBeenCalledTimes(2)
	})
	it("cancels generation, ignores late responses, and clears the key when the panel closes", async () => {
		let resolve!: (value: Response) => void
		const fetcher = vi.fn(
			() =>
				new Promise<Response>((done) => {
					resolve = done
				})
		)
		vi.stubGlobal("fetch", fetcher)
		const { output, audioContext } = player({ prompt: "jazz" })
		const panel = await output.createGui()
		const key = panel.querySelector<HTMLInputElement>('input[type="password"]')!
		key.value = "private-key"
		const pending = output.generate(key.value)
		await output.generate(key.value)
		expect(fetcher).toHaveBeenCalledTimes(1)
		await output.destroyGui()
		expect(key.value).toBe("")
		resolve(new Response(JSON.stringify(response())))
		await pending
		expect(audioContext.decodeAudioData).not.toHaveBeenCalled()
		expect(saveBackingTrack).not.toHaveBeenCalled()
	})
	it("reports decode failures during generation instead of leaving a generating status", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify(response())))
		)
		const { output, audioContext } = player({ prompt: "jazz" })
		audioContext.decodeAudioData.mockRejectedValueOnce(new Error("Invalid audio"))
		const panel = await output.createGui()
		await output.generate("key")
		expect(panel.querySelector('[role="status"]')?.textContent).toBe("Invalid audio")
	})
})