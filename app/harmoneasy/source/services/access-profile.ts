import type { ClassroomRole } from "./classroom-session"
import {
	DEFAULT_ACCESSIBILITY,
	type AccessibilityPreferences,
	type ContrastMode,
	type MotionPreference,
	type PaletteMode,
	type TargetSize
} from "./accessibility"
import type { FocusStageMode, FocusStagePadCount } from "./focus-stage"
import { createPartsUrl } from "./parts-url"
import { roomName } from "./room-url"
import type {
	AuditoryCueMode,
	SwitchReleaseMode,
	SwitchScanMode
} from "./switch-scanner"

export const ACCESS_PROFILE_PARAM = "access"

export interface AccessProfile extends AccessibilityPreferences {
	version: 1
	label?: string
	openFocusStage: boolean
	stageMode: FocusStageMode
	padCount: FocusStagePadCount
	scanMode: SwitchScanMode
	scanMs: number
	releaseMode: SwitchReleaseMode
	auditoryCue: AuditoryCueMode
	dwellMs: number
	micThreshold?: number
}

export const DEFAULT_ACCESS_PROFILE: AccessProfile = {
	version: 1,
	...DEFAULT_ACCESSIBILITY,
	openFocusStage: true,
	stageMode: "scale",
	padCount: 8,
	scanMode: "off",
	scanMs: 1000,
	releaseMode: "timed",
	auditoryCue: "off",
	dwellMs: 0
}

export interface TapSample {
	downMs: number
	upMs: number
}

export interface TapCalibrationResult {
	stabilizerEnabled: boolean
	debounceMs: number
	holdThresholdMs: number
	minDurationMs: number
	scanMs: number
	summary: string
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
	const num = Number(value)
	return Number.isFinite(num) ? Math.min(max, Math.max(min, num)) : fallback
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b)
	const mid = Math.floor(sorted.length / 2)
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function snapOption(value: number, options: readonly number[]): number {
	return options.reduce((best, candidate) =>
		Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best
	)
}

/** Measure comfortable tap cadence, bounce risk, and hold stability from 2+ tap samples. */
export function calibrateTapTiming(samples: readonly TapSample[]): TapCalibrationResult {
	const clean = samples
		.filter(
			(s) =>
				Number.isFinite(s.downMs) &&
				Number.isFinite(s.upMs) &&
				s.upMs >= s.downMs
		)
		.sort((a, b) => a.downMs - b.downMs)

	if (clean.length < 2) {
		return {
			stabilizerEnabled: false,
			debounceMs: 120,
			holdThresholdMs: 0,
			minDurationMs: 0,
			scanMs: 1000,
			summary: "Tap at least twice to measure comfortable timing."
		}
	}

	const holds = clean.map((s) => Math.max(10, s.upMs - s.downMs))
	const gaps: number[] = []
	for (let i = 1; i < clean.length; i++) {
		gaps.push(Math.max(0, clean[i].downMs - clean[i - 1].downMs))
	}

	const bounceGaps = gaps.filter((gap) => gap < 140)
	const intentionalGaps = gaps.filter((gap) => gap >= 140)
	const medianGap = intentionalGaps.length ? median(intentionalGaps) : median(gaps)
	const minHold = Math.min(...holds)
	const medianHold = median(holds)

	const hasBounce = bounceGaps.length > 0
	const debounceMs = hasBounce
		? snapOption(Math.max(...bounceGaps) + 60, [120, 200, 350])
		: 0

	// Short tremor spike mixed with longer holds suggests a hold filter helps.
	const hasTremorSpikes = minHold < 65 && medianHold > minHold * 1.8
	const holdThresholdMs = hasTremorSpikes ? snapOption(minHold + 20, [50, 100, 180]) : 0

	// Very short releases benefit from a gentle minimum sustain duration.
	const minDurationMs = medianHold < 95 ? 120 : 0
	const stabilizerEnabled = debounceMs > 0 || holdThresholdMs > 0 || minDurationMs > 0

	// Choose comfortable auto-scan interval from natural tap rhythm.
	const scanMs = medianGap <= 750 ? 600 : medianGap <= 1250 ? 1000 : 1500

	const notes: string[] = [`scan ${(scanMs / 1000).toFixed(1)}s`]
	if (debounceMs > 0) {
		notes.push(`lockout ${debounceMs}ms`)
	}
	if (holdThresholdMs > 0) {
		notes.push(`tremor filter ${holdThresholdMs}ms`)
	}
	if (minDurationMs > 0) {
		notes.push(`min sustain ${minDurationMs}ms`)
	}
	return {
		stabilizerEnabled,
		debounceMs: debounceMs || 120,
		holdThresholdMs,
		minDurationMs,
		scanMs,
		summary: `Calibrated from ${clean.length} taps: ${notes.join(", ")}.`
	}
}

/** Snap measured comfortable hover hold times to supported dwell durations. */
export function calibrateDwellTiming(holdDurationsMs: readonly number[]): {
	dwellMs: number
	summary: string
} {
	const valid = holdDurationsMs.filter((ms) => Number.isFinite(ms) && ms > 100)
	if (!valid.length) {
		return { dwellMs: 600, summary: "Default dwell set to 0.6s." }
	}
	const snapped = snapOption(median(valid), [400, 600, 900, 1200])
	return {
		dwellMs: snapped,
		summary: `Calibrated dwell time: ${(snapped / 1000).toFixed(1)}s.`
	}
}

/** Compute a microphone clap trigger threshold safely above the ambient floor. */
export function calibrateMicThreshold(
	ambientRms: number,
	clapPeakRms: number
): { micThreshold: number; summary: string } {
	const floor = clamp(ambientRms, 0.02, 0.01, 0.5)
	const peak = clamp(clapPeakRms, floor + 0.2, floor + 0.05, 1)
	const threshold = Number(clamp(floor + (peak - floor) * 0.45, 0.15, 0.04, 0.75).toFixed(2))
	return {
		micThreshold: threshold,
		summary: `Calibrated microphone threshold: ${threshold.toFixed(2)} (floor ${floor.toFixed(2)}, peak ${peak.toFixed(2)}).`
	}
}

/** Validate and normalize an untrusted profile object into a safe AccessProfile. */
export function parseAccessProfile(value: unknown): AccessProfile {
	const raw = value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {}
	const padRaw = Number(raw.padCount)
	const padCount: FocusStagePadCount = padRaw === 1 || padRaw === 4 || padRaw === 8 ? padRaw : 8
	const label =
		typeof raw.label === "string" && raw.label.trim()
			? raw.label.trim().slice(0, 80)
			: undefined
	const micThreshold =
		raw.micThreshold !== undefined
			? Number(clamp(raw.micThreshold, 0.15, 0.02, 0.8).toFixed(2))
			: undefined

	return {
		version: 1,
		...(label ? { label } : {}),
		contrast: (raw.contrast === "high" ? "high" : "standard") as ContrastMode,
		palette: (raw.palette === "colorblind-safe" ? "colorblind-safe" : "default") as PaletteMode,
		targetSize: (["default", "large", "xlarge"].includes(String(raw.targetSize))
			? raw.targetSize
			: "default") as TargetSize,
		reducedMotion: (raw.reducedMotion === "reduce" ? "reduce" : "system") as MotionPreference,
		beatFlash: raw.beatFlash === true,
		stabilizerEnabled: raw.stabilizerEnabled === true,
		debounceMs: Math.round(clamp(raw.debounceMs, DEFAULT_ACCESS_PROFILE.debounceMs, 0, 500)),
		holdThresholdMs: Math.round(
			clamp(raw.holdThresholdMs, DEFAULT_ACCESS_PROFILE.holdThresholdMs, 0, 400)
		),
		minDurationMs: Math.round(
			clamp(raw.minDurationMs, DEFAULT_ACCESS_PROFILE.minDurationMs, 0, 1000)
		),
		openFocusStage: raw.openFocusStage !== false,
		stageMode: (["scale", "chords", "step"].includes(String(raw.stageMode))
			? raw.stageMode
			: "scale") as FocusStageMode,
		padCount,
		scanMode: (["off", "auto-1-switch", "step-2-switch"].includes(String(raw.scanMode))
			? raw.scanMode
			: "off") as SwitchScanMode,
		scanMs: Math.round(clamp(raw.scanMs, 1000, 300, 3000)),
		releaseMode: (raw.releaseMode === "latch" ? "latch" : "timed") as SwitchReleaseMode,
		auditoryCue: (["off", "speech", "tone"].includes(String(raw.auditoryCue))
			? raw.auditoryCue
			: "off") as AuditoryCueMode,
		dwellMs: Math.round(clamp(raw.dwellMs, 0, 0, 2000)),
		...(micThreshold !== undefined ? { micThreshold } : {})
	}
}

function toBase64Url(text: string): string {
	const bytes = new TextEncoder().encode(text)
	let binary = ""
	for (const byte of bytes) {
		binary += String.fromCharCode(byte)
	}
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function fromBase64Url(token: string): string {
	const padded = token.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((token.length + 3) % 4)
	const binary = atob(padded)
	const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
	return new TextDecoder().decode(bytes)
}

/** Encode an AccessProfile into a compact URL-safe token containing non-default fields. */
export function encodeAccessProfile(profile: Partial<AccessProfile>): string {
	const normalized = parseAccessProfile(profile)
	const compact: Record<string, unknown> = { version: 1 }
	for (const [key, value] of Object.entries(normalized)) {
		if (key === "version" || value === undefined) {
			continue
		}
		if (value !== DEFAULT_ACCESS_PROFILE[key as keyof AccessProfile]) {
			compact[key] = value
		}
	}
	return toBase64Url(JSON.stringify(compact))
}

/** Decode a URL-safe token into a validated AccessProfile, or undefined if malformed. */
export function decodeAccessProfile(token: string): AccessProfile | undefined {
	if (!token || token.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(token)) {
		return undefined
	}
	try {
		const parsed = JSON.parse(fromBase64Url(token))
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return undefined
		}
		for (const forbidden of ["__proto__", "prototype", "constructor"]) {
			if (Object.hasOwn(parsed, forbidden)) {
				return undefined
			}
		}
		return parseAccessProfile(parsed)
	} catch {
		return undefined
	}
}

/** Read an AccessProfile from a URL's query string or hash fragment if present. */
export function readAccessProfileFromUrl(location: string): AccessProfile | undefined {
	try {
		const url = new URL(location)
		const token =
			url.searchParams.get(ACCESS_PROFILE_PARAM) ??
			new URLSearchParams(url.hash.slice(1)).get(ACCESS_PROFILE_PARAM)
		return token ? decodeAccessProfile(token) : undefined
	} catch {
		return undefined
	}
}

export interface AccessProfileUrlOptions {
	location: string
	base?: string
	profile: Partial<AccessProfile>
	inputs?: string[]
	outputs?: string[]
	transformers?: string[]
	bpm?: number
	roomId?: string
	role?: ClassroomRole
	sensoryPreset?: "none" | "low-vision" | "deaf-tactile"
}

/**
 * Build a bookmarkable `/parts/v1/` learner link carrying both the calibrated
 * AccessProfile and matching Harmoneasy inputs/outputs (and optional classroom room).
 */
export function buildAccessProfileUrl(options: AccessProfileUrlOptions): string {
	const profile = parseAccessProfile(options.profile)
	const base = options.base ?? "/"

	const inputs = new Set<string>(options.inputs?.length ? options.inputs : ["pads", "keyboard"])
	if (profile.micThreshold !== undefined) {
		inputs.add("microphone-trigger")
	}

	const outputs = new Set<string>(options.outputs?.length ? options.outputs : ["moog"])
	if (options.sensoryPreset === "low-vision") {
		outputs.add("describe")
		outputs.add("speech-synthesis")
	} else if (options.sensoryPreset === "deaf-tactile") {
		outputs.add("notation")
		outputs.add("vibrator")
	}

	const title = profile.label ? `${profile.label} — Access Profile` : "Calibrated Access Profile"
	const params: Record<string, string | string[]> = {
		inputs: [...inputs].join(","),
		outputs: [...outputs].join(","),
		name: title,
		description: `Accessible Harmoneasy profile (${profile.stageMode} mode, ${profile.padCount} pads).`
	}

	if (options.transformers?.length) {
		params.transformers = options.transformers.join(",")
	}
	if (Number.isFinite(options.bpm) && options.bpm! >= 10 && options.bpm! <= 303) {
		params.bpm = String(Math.round(options.bpm!))
	}
	if (profile.micThreshold !== undefined) {
		params.config = JSON.stringify({
			devices: {
				"url-input-microphone-trigger": { threshold: profile.micThreshold }
			}
		})
	}

	const href = createPartsUrl(options.location, base, params)
	const url = new URL(href)
	url.searchParams.set(ACCESS_PROFILE_PARAM, encodeAccessProfile(profile))
	if (options.roomId?.trim()) {
		const slug = options.roomId
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9._-]+/g, "-")
			.replace(/^[^a-z0-9]+|-+$/g, "")
			.slice(0, 64)
		if (slug) {
			const fragment = new URLSearchParams(url.hash.slice(1))
			fragment.set("room", roomName(slug))
			url.hash = fragment.toString()
		}
	}
	return url.href
}
