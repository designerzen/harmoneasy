import { EVENT_CHANGE, EVENT_CLICK } from "audiobus/events/event-constants"
import {
	encodeSamples,
	waveHeader,
	type RecordingBits
} from "audiobus/io/recording/recording-format"
import type { TrackAnalysis } from "audiobus/analysis/essentia-features"

export const DEFAULT_TARGET_LUFS = -14
/** Normalised peaks stay at or below this sample level. */
export const PEAK_CEILING_DB = -1
const MIN_TARGET_LUFS = -50
const MAX_TARGET_LUFS = -5
/** Integrated loudness at or below this means the gate found nothing to measure. */
const SILENCE_LUFS = -70
const ANALYSIS_SECONDS = 180

/** Takes are exported as 32-bit float stereo WAV, so the header and sample layout are fixed. */
const WAVE_HEADER_BYTES = 92
const FRAME_BYTES = 8
const CHUNK_FRAMES = 1 << 19

export interface TakeAnalysis extends TrackAnalysis {
	/** Highest absolute sample (0–1+) over the whole take, not only the analysed part. */
	peak: number
	/** Length of the whole take in seconds; `duration` is the part that was analysed. */
	takeDuration: number
}

export interface NormalisationGain {
	gainDb: number
	/** Linear multiplier for the samples. */
	gain: number
	limitedByPeak: boolean
}

interface TakeSource {
	wave(bits: RecordingBits): Promise<Blob>
}

export function bpmConfidenceLabel(confidence: number): "poor" | "fair" | "good" | "excellent" {
	return confidence > 3.5
		? "excellent"
		: confidence > 1.5
			? "good"
			: confidence > 1
				? "fair"
				: "poor"
}

const decibels = (value: number, digits = 1) => value.toFixed(digits).replace(/^-0\.0$/, "0.0")

/** Compact label/value rows for the summary list. */
export function formatTakeAnalysis(analysis: TrackAnalysis): { label: string; value: string }[] {
	const silent = analysis.loudness <= SILENCE_LUFS
	return [
		{
			label: "Tempo",
			value: analysis.bpm
				? `${analysis.bpm.toFixed(1)} BPM (${bpmConfidenceLabel(analysis.bpmConfidence)} confidence)`
				: "Not detected"
		},
		{
			label: "Key",
			value: `${analysis.keyName} ${analysis.scale} (${Math.round(analysis.keyStrength * 100)}% strength)`
		},
		{
			label: "Loudness",
			value: silent
				? "Silent"
				: `${decibels(analysis.loudness)} LUFS · range ${decibels(analysis.loudnessRange)} LU`
		},
		{ label: "Danceability", value: analysis.danceability.toFixed(2) }
	]
}

/** Gain that brings the take to the target loudness without its peak passing the ceiling. */
export function normalisationGain(
	analysis: Pick<TakeAnalysis, "loudness" | "peak">,
	targetLufs = DEFAULT_TARGET_LUFS,
	ceilingDb = PEAK_CEILING_DB
): NormalisationGain {
	if (!Number.isFinite(analysis.loudness) || analysis.loudness <= SILENCE_LUFS) {
		return { gainDb: 0, gain: 1, limitedByPeak: false }
	}
	const wanted = targetLufs - analysis.loudness
	const peakDb = analysis.peak > 0 ? 20 * Math.log10(analysis.peak) : -Infinity
	const allowed = ceilingDb - peakDb
	const gainDb = Math.min(wanted, allowed)
	return { gainDb, gain: 10 ** (gainDb / 20), limitedByPeak: allowed < wanted }
}

export function describeGain(result: NormalisationGain, targetLufs = DEFAULT_TARGET_LUFS): string {
	if (!result.gainDb) {
		return "No change needed"
	}
	const sign = result.gainDb > 0 ? "+" : ""
	return result.limitedByPeak
		? `${sign}${decibels(result.gainDb)} dB (limited to keep peaks at ${PEAK_CEILING_DB} dBFS; target ${targetLufs} LUFS)`
		: `${sign}${decibels(result.gainDb)} dB to reach ${targetLufs} LUFS`
}

async function readTakeHeader(blob: Blob) {
	const bytes = await blob.slice(0, WAVE_HEADER_BYTES).arrayBuffer()
	const view = new DataView(bytes)
	const tag = (offset: number) =>
		bytes.byteLength >= offset + 4
			? String.fromCharCode(...new Uint8Array(bytes, offset, 4))
			: ""
	if (
		bytes.byteLength < WAVE_HEADER_BYTES ||
		tag(8) !== "WAVE" ||
		tag(WAVE_HEADER_BYTES - 8) !== "data" ||
		view.getUint16(56, true) !== 3 ||
		view.getUint16(58, true) !== 2 ||
		view.getUint16(70, true) !== 32
	) {
		throw new Error("The take is not in the expected audio format.")
	}
	return { sampleRate: view.getUint32(60, true) }
}

/** Streams the whole take for its peak while keeping only the first seconds as an AudioBuffer. */
async function readTake(blob: Blob, maxSeconds: number) {
	const { sampleRate } = await readTakeHeader(blob)
	const frames = Math.floor((blob.size - WAVE_HEADER_BYTES) / FRAME_BYTES)
	if (frames < 1) {
		throw new Error("The take contains no audio.")
	}
	const kept = Math.min(frames, Math.max(1, Math.round(maxSeconds * sampleRate)))
	const left = new Float32Array(kept)
	const right = new Float32Array(kept)
	let peak = 0
	for (let start = 0; start < frames; start += CHUNK_FRAMES) {
		const count = Math.min(CHUNK_FRAMES, frames - start)
		const offset = WAVE_HEADER_BYTES + start * FRAME_BYTES
		const samples = new Float32Array(
			await blob.slice(offset, offset + count * FRAME_BYTES).arrayBuffer()
		)
		for (let i = 0; i < count; i++) {
			const l = samples[i * 2]
			const r = samples[i * 2 + 1]
			if (Math.abs(l) > peak) {
				peak = Math.abs(l)
			}
			if (Math.abs(r) > peak) {
				peak = Math.abs(r)
			}
			if (start + i < kept) {
				left[start + i] = Number.isFinite(l) ? l : 0
				right[start + i] = Number.isFinite(r) ? r : 0
			}
		}
	}
	const buffer = new AudioBuffer({ numberOfChannels: 2, length: kept, sampleRate })
	buffer.copyToChannel(left, 0)
	buffer.copyToChannel(right, 1)
	return { buffer, peak: Number.isFinite(peak) ? peak : 0, takeDuration: frames / sampleRate }
}

// Keyed by the recording's own cached WAV, which is replaced when a new take starts.
const analyses = new WeakMap<Blob, Promise<TakeAnalysis>>()

/** Analyse the retained take once; later calls for the same take share the result. */
export async function analyseTake(
	recording: TakeSource,
	{ maxSeconds = ANALYSIS_SECONDS }: { maxSeconds?: number } = {}
): Promise<TakeAnalysis> {
	const blob = await recording.wave(32)
	let pending = analyses.get(blob)
	if (!pending) {
		pending = (async () => {
			const { buffer, peak, takeDuration } = await readTake(blob, maxSeconds)
			const { analyseAudioBuffer } = await import("audiobus/analysis/essentia-client")
			return { ...(await analyseAudioBuffer(buffer, { maxSeconds })), peak, takeDuration }
		})()
		analyses.set(blob, pending)
		// A failed attempt is not remembered, so Analyse can be tried again.
		pending.catch(() => analyses.delete(blob))
	}
	return pending
}

/** A scaled copy of a 32-bit take WAV, produced chunk by chunk so a long take is never decoded at once. */
export async function normaliseWave(
	source: Blob,
	bits: RecordingBits,
	gain: number
): Promise<Blob> {
	const { sampleRate } = await readTakeHeader(source)
	const frames = Math.floor((source.size - WAVE_HEADER_BYTES) / FRAME_BYTES)
	const parts: BlobPart[] = [waveHeader((frames * 2 * bits) / 8, sampleRate, bits)]
	for (let start = 0; start < frames; start += CHUNK_FRAMES) {
		const count = Math.min(CHUNK_FRAMES, frames - start)
		const offset = WAVE_HEADER_BYTES + start * FRAME_BYTES
		const samples = new Float32Array(
			await source.slice(offset, offset + count * FRAME_BYTES).arrayBuffer()
		)
		for (let i = 0; i < samples.length; i++) {
			samples[i] *= gain
		}
		parts.push(encodeSamples(samples, bits))
	}
	return new Blob(parts, { type: "audio/wav" })
}

export interface AnalysisPanel {
	/** Target loudness when "Normalise" is ticked, otherwise undefined. */
	normaliseTarget(): number | undefined
	showResult(analysis: TakeAnalysis): void
	showMessage(message: string): void
	reset(): void
	update(state: { canAnalyse: boolean; busy: boolean }): void
}

/** Wires the optional analysis section of the recording dialog; absent markup means no analysis UI. */
export function createAnalysisPanel(
	root: Document,
	onAnalyse: () => void
): AnalysisPanel | undefined {
	const analyse = root.querySelector<HTMLButtonElement>("#recording-analyse")
	const summary = root.querySelector<HTMLElement>("#recording-analysis-summary")
	const status = root.querySelector<HTMLElement>("#recording-analysis-status")
	const normalise = root.querySelector<HTMLInputElement>("#recording-normalise")
	const target = root.querySelector<HTMLInputElement>("#recording-normalise-target")
	if (!analyse || !summary || !status || !normalise || !target) {
		return undefined
	}
	let result: TakeAnalysis | undefined
	const targetLufs = () => {
		const value = Number(target.value)
		return Math.min(
			MAX_TARGET_LUFS,
			Math.max(
				MIN_TARGET_LUFS,
				Number.isFinite(value) && target.value !== "" ? value : DEFAULT_TARGET_LUFS
			)
		)
	}
	const renderResult = () => {
		summary.replaceChildren()
		summary.hidden = !result
		if (!result) {
			return
		}
		const rows = formatTakeAnalysis(result)
		rows.push({
			label: "Suggested gain",
			value: describeGain(normalisationGain(result, targetLufs()), targetLufs())
		})
		for (const { label, value } of rows) {
			const term = root.createElement("dt")
			term.textContent = label
			const description = root.createElement("dd")
			description.textContent = value
			summary.append(term, description)
		}
	}
	analyse.addEventListener(EVENT_CLICK, onAnalyse)
	target.addEventListener(EVENT_CHANGE, renderResult)
	return {
		normaliseTarget: () => (normalise.checked ? targetLufs() : undefined),
		showResult(analysis) {
			result = analysis
			renderResult()
			status.textContent =
				analysis.takeDuration - analysis.duration > 1
					? `Analysis complete, based on the first ${Math.round(analysis.duration)} seconds of the take.`
					: "Analysis complete."
		},
		showMessage(message) {
			status.textContent = message
		},
		reset() {
			result = undefined
			renderResult()
			status.textContent = ""
		},
		update({ canAnalyse, busy }) {
			analyse.disabled = !canAnalyse
			normalise.disabled = busy
			target.disabled = busy
		}
	}
}