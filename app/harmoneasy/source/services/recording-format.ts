export const RECORDING_PROCESSOR = "harmoneasy-recorder"
export const RECORDING_START = "start"
export const RECORDING_STOP = "stop"
export const RECORDING_DATA = "data"
export const RECORDING_OPEN = "open"
export const RECORDING_EXPORT = "export"
export const RECORDING_RECOVER = "recover"
export const RECORDING_FLUSH = "flush"
export const RECORDING_STATE_CHANGED = "recording-state-changed"
export type RecordingBits = 16 | 32

// Reserve a ds64-sized JUNK chunk so very long takes can become RF64.
export function waveHeader(
	bytes: number,
	sampleRate: number,
	bits: RecordingBits
): Uint8Array<ArrayBuffer> {
	const headerSize = bits === 32 ? 92 : 80
	const header = new Uint8Array(headerSize)
	const view = new DataView(header.buffer)
	const text = (offset: number, value: string) =>
		[...value].forEach((c, i) => (header[offset + i] = c.charCodeAt(0)))
	const riffSize = bytes + headerSize - 8
	const frames = bytes / ((2 * bits) / 8)
	const large = riffSize > 0xffffffff
	text(0, large ? "RF64" : "RIFF")
	view.setUint32(4, large ? 0xffffffff : riffSize, true)
	text(8, "WAVE")
	text(12, large ? "ds64" : "JUNK")
	view.setUint32(16, 28, true)
	if (large) {
		view.setBigUint64(20, BigInt(riffSize), true)
		view.setBigUint64(28, BigInt(bytes), true)
		view.setBigUint64(36, BigInt(frames), true)
	}
	text(48, "fmt ")
	view.setUint32(52, 16, true)
	view.setUint16(56, bits === 32 ? 3 : 1, true)
	view.setUint16(58, 2, true)
	view.setUint32(60, sampleRate, true)
	view.setUint32(64, (sampleRate * 2 * bits) / 8, true)
	view.setUint16(68, (2 * bits) / 8, true)
	view.setUint16(70, bits, true)
	if (bits === 32) {
		text(72, "fact")
		view.setUint32(76, 4, true)
		view.setUint32(80, Math.min(frames, 0xffffffff), true)
	}
	text(headerSize - 8, "data")
	view.setUint32(headerSize - 4, large ? 0xffffffff : bytes, true)
	return header
}

export function encodeSamples(samples: Float32Array, bits: RecordingBits): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array((samples.length * bits) / 8)
	const view = new DataView(bytes.buffer)
	for (let i = 0; i < samples.length; i++) {
		const sample = Number.isFinite(samples[i]) ? samples[i] : 0
		if (bits === 32) {
			view.setFloat32(i * 4, sample, true)
		} else {
			view.setInt16(
				i * 2,
				Math.round(Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767)),
				true
			)
		}
	}
	return bytes
}