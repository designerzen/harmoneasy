import type { IAudioOutput } from "audiobus/io/outputs/output-interface"
import { surfaceAudioSources } from "./control-surface-audio"

/** Matches the Mixer and control surfaces: declared audio, or a Web Audio node to tap. */
export function hasAudibleOutput(output: IAudioOutput): boolean {
	const node = output.output as AudioNode | undefined
	return Boolean(output.hasAudioOutput?.() || node?.context?.createAnalyser)
}

type LevelListener = (level: number) => void
type LevelTap = ReturnType<typeof surfaceAudioSources> & {
	level: number
	notified: number
	listeners: Set<LevelListener>
}

const FLOOR_DB = -48
const ATTACK_SECONDS = 0.05
const RELEASE_SECONDS = 0.3
const FRAME_MS = 1000 / 30
const NOTIFY_STEP = 0.005

const taps = new Map<IAudioOutput, LevelTap>()
let frame = 0
let previous = 0

/** Perceptual 0–1 level, so quiet but audible signals still move. */
export function loudness(rms: number): number {
	return rms > 0 ? Math.max(0, Math.min(1, 1 - (20 * Math.log10(rms)) / FLOOR_DB)) : 0
}

export function smoothLevel(level: number, target: number, elapsed: number): number {
	const time = target > level ? ATTACK_SECONDS : RELEASE_SECONDS
	const next = level + (target - level) * (1 - Math.exp(-elapsed / time))
	return next < NOTIFY_STEP ? 0 : next
}

const tick = (now: number) => {
	frame = requestAnimationFrame(tick)
	if (previous && now - previous < FRAME_MS) {
		return
	}
	const elapsed = Math.min(0.1, previous ? (now - previous) / 1000 : FRAME_MS / 1000)
	previous = now
	for (const tap of taps.values()) {
		const rms = tap.sources[0]?.read("level")?.level ?? 0
		tap.level = smoothLevel(tap.level, loudness(rms), elapsed)
		const settled = tap.level === 0 && tap.notified !== 0
		if (settled || Math.abs(tap.level - tap.notified) >= NOTIFY_STEP) {
			tap.notified = tap.level
			tap.listeners.forEach((listener) => listener(tap.level))
		}
	}
}

/** Shares one passive tap per output, which exists only while something is watching it. */
export function watchOutputLevel(output: IAudioOutput, listener: LevelListener): () => void {
	let tap = taps.get(output)
	if (!tap) {
		tap = { ...surfaceAudioSources([output]), level: 0, notified: 0, listeners: new Set() }
		taps.set(output, tap)
	}
	const watched = tap
	watched.listeners.add(listener)
	frame ||= requestAnimationFrame(tick)
	return () => {
		watched.listeners.delete(listener)
		if (watched.listeners.size) {
			return
		}
		watched.destroy()
		taps.delete(output)
		if (!taps.size) {
			cancelAnimationFrame(frame)
			frame = previous = 0
		}
	}
}
