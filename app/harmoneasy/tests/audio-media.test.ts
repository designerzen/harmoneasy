import { afterEach, expect, it, vi } from "vitest"
import {
	decodeAudioMedia,
	canExportAudio,
	convertAudioMedia
} from "../../../packages/audiobus/io/media/audio-media"
import { encodeWave } from "../../../packages/audiobus/io/recording/recording-format"

class TestAudioBuffer {
	readonly sampleRate: number
	readonly length: number
	readonly numberOfChannels: number
	private channels: Float32Array[]
	constructor(options: { sampleRate: number; length: number; numberOfChannels: number }) {
		Object.assign(this, options)
		this.sampleRate = options.sampleRate
		this.length = options.length
		this.numberOfChannels = options.numberOfChannels
		this.channels = Array.from(
			{ length: options.numberOfChannels },
			() => new Float32Array(options.length)
		)
	}
	get duration() {
		return this.length / this.sampleRate
	}
	getChannelData(channel: number) {
		return this.channels[channel]
	}
	copyToChannel(source: Float32Array, channel: number, offset = 0) {
		this.channels[channel].set(source, offset)
	}
}

afterEach(() => vi.unstubAllGlobals())

it("keeps native decoding and gives it a copy so a failed decoder cannot detach the fallback input", async () => {
	const bytes = new Uint8Array([1, 2, 3]).buffer
	const buffer = {} as AudioBuffer
	const decodeAudioData = vi.fn(async (copy: ArrayBuffer) => {
		expect(copy).not.toBe(bytes)
		expect(new Uint8Array(copy)).toEqual(new Uint8Array(bytes))
		return buffer
	})
	expect(await decodeAudioMedia({ decodeAudioData } as unknown as AudioContext, bytes)).toBe(
		buffer
	)
})

it.each([16, 32] as const)(
	"decodes real %i-bit stereo WAV with Mediabunny when native decoding fails",
	async (bits) => {
		vi.stubGlobal("AudioBuffer", TestAudioBuffer)
		const left = Float32Array.from({ length: 12000 }, (_, index) => Math.sin(index / 20) * 0.5)
		const right = Float32Array.from(left, (value) => -value)
		const bytes = await encodeWave([left, right], 48000, bits).arrayBuffer()
		const context = {
			decodeAudioData: vi.fn().mockRejectedValue(new Error("Native decoder unavailable")),
			createBuffer: (numberOfChannels: number, length: number, sampleRate: number) =>
				new TestAudioBuffer({ numberOfChannels, length, sampleRate })
		} as unknown as AudioContext
		const decoded = await decodeAudioMedia(context, bytes)
		expect(decoded.numberOfChannels).toBe(2)
		expect(decoded.sampleRate).toBe(48000)
		expect(decoded.length).toBe(left.length)
		for (const index of [0, 100, 5999, 11999]) {
			expect(decoded.getChannelData(0)[index]).toBeCloseTo(left[index], 4)
			expect(decoded.getChannelData(1)[index]).toBeCloseTo(right[index], 4)
		}
	}
)

it("preserves the native error for unrecognized files", async () => {
	const error = new Error("Invalid audio")
	const context = { decodeAudioData: vi.fn().mockRejectedValue(error) } as unknown as AudioContext
	await expect(decodeAudioMedia(context, new Uint8Array([1, 2, 3]).buffer)).rejects.toBe(error)
})

it("always allows WAV and hides compressed exports when the browser has no encoders", async () => {
	vi.stubGlobal("AudioEncoder", undefined)
	expect(await canExportAudio("16", 48000)).toBe(true)
	expect(await canExportAudio("32", 48000)).toBe(true)
	expect(await canExportAudio("webm", 48000)).toBe(false)
	expect(await canExportAudio("m4a", 48000)).toBe(false)
})

it("aborts a compressed save when no encoder is available and keeps the source readable", async () => {
	vi.stubGlobal("AudioEncoder", undefined)
	const wave = encodeWave([new Float32Array(4800)], 48000, 32)
	const destination = {
		write: vi.fn(),
		close: vi.fn(),
		abort: vi.fn().mockResolvedValue(undefined)
	}
	await expect(
		convertAudioMedia(
			wave,
			"m4a",
			undefined,
			destination as unknown as FileSystemWritableFileStream
		)
	).rejects.toThrow("Choose WAV instead")
	expect(destination.abort).toHaveBeenCalledOnce()
	expect(destination.close).not.toHaveBeenCalled()
	expect((await wave.arrayBuffer()).byteLength).toBe(wave.size)
})