import { EVENT_CHANGE, EVENT_CLICK } from "audiobus/events/event-constants"
import { deviceDefinition } from "audiobus/io/device-definition"
import type IOChainManager from "audiobus/io/IO-chain-manager"
import { createOutputById } from "audiobus/io/output-factory"
import { DESCRIBE, NOTATION, SPEECH_SYNTHESIS, VIBRATOR } from "audiobus/io/outputs/output-types"

export const ACCESSIBILITY_STORAGE_KEY = "harmoneasy.accessibility"
export const EVENT_ACCESSIBILITY_CHANGED = "accessibilityChanged"

export type ContrastMode = "standard" | "high"
export type PaletteMode = "default" | "colorblind-safe"
export type TargetSize = "default" | "large" | "xlarge"
export type MotionPreference = "system" | "reduce"

export interface AccessibilityPreferences {
	contrast: ContrastMode
	palette: PaletteMode
	targetSize: TargetSize
	reducedMotion: MotionPreference
	beatFlash: boolean
	stabilizerEnabled: boolean
	debounceMs: number
	holdThresholdMs: number
	minDurationMs: number
}

export const DEFAULT_ACCESSIBILITY: AccessibilityPreferences = {
	contrast: "standard",
	palette: "default",
	targetSize: "default",
	reducedMotion: "system",
	beatFlash: false,
	stabilizerEnabled: false,
	debounceMs: 120,
	holdThresholdMs: 0,
	minDurationMs: 0
}

function clampMs(value: unknown, fallback: number, max: number): number {
	const num = Number(value)
	return Number.isFinite(num) && num >= 0 ? Math.min(max, Math.round(num)) : fallback
}

export function readAccessibilityPreferences(doc: Document): AccessibilityPreferences {
	try {
		const saved = JSON.parse(
			doc.defaultView?.localStorage.getItem(ACCESSIBILITY_STORAGE_KEY) ?? "null"
		)
		return {
			contrast: saved?.contrast === "high" ? "high" : "standard",
			palette: saved?.palette === "colorblind-safe" ? "colorblind-safe" : "default",
			targetSize: ["default", "large", "xlarge"].includes(saved?.targetSize)
				? (saved.targetSize as TargetSize)
				: "default",
			reducedMotion: saved?.reducedMotion === "reduce" ? "reduce" : "system",
			beatFlash: saved?.beatFlash === true,
			stabilizerEnabled: saved?.stabilizerEnabled === true,
			debounceMs: clampMs(saved?.debounceMs, DEFAULT_ACCESSIBILITY.debounceMs, 500),
			holdThresholdMs: clampMs(
				saved?.holdThresholdMs,
				DEFAULT_ACCESSIBILITY.holdThresholdMs,
				400
			),
			minDurationMs: clampMs(saved?.minDurationMs, DEFAULT_ACCESSIBILITY.minDurationMs, 1000)
		}
	} catch {
		return { ...DEFAULT_ACCESSIBILITY }
	}
}

export function applyAccessibilityPreferences(
	doc: Document,
	prefs: AccessibilityPreferences
): void {
	const root = doc.documentElement
	if (prefs.contrast === "high") {
		root.dataset.contrast = "high"
	} else {
		delete root.dataset.contrast
	}
	if (prefs.palette === "colorblind-safe") {
		root.dataset.palette = "colorblind-safe"
	} else {
		delete root.dataset.palette
	}
	if (prefs.targetSize !== "default") {
		root.dataset.targetSize = prefs.targetSize
	} else {
		delete root.dataset.targetSize
	}
	if (prefs.reducedMotion === "reduce") {
		root.dataset.reducedMotion = "reduce"
	} else {
		delete root.dataset.reducedMotion
	}
	if (prefs.beatFlash) {
		root.dataset.beatFlash = "on"
	} else {
		delete root.dataset.beatFlash
	}
}

export interface AccessibilityController extends EventTarget {
	getPreferences(): AccessibilityPreferences
	update(patch: Partial<AccessibilityPreferences>): void
	reset(): void
	destroy(): void
}

export function createAccessibilityControls(doc: Document): AccessibilityController {
	const events = new EventTarget()
	const abort = new AbortController()
	let prefs = readAccessibilityPreferences(doc)

	const contrast = doc.getElementById("a11y-contrast") as HTMLSelectElement | null
	const palette = doc.getElementById("a11y-palette") as HTMLSelectElement | null
	const targetSize = doc.getElementById("a11y-target-size") as HTMLSelectElement | null
	const motion = doc.getElementById("a11y-reduced-motion") as HTMLSelectElement | null
	const beatFlash = doc.getElementById("a11y-beat-flash") as HTMLInputElement | null
	const stabilizer = doc.getElementById("a11y-stabilizer") as HTMLInputElement | null
	const debounce = doc.getElementById("a11y-debounce") as HTMLSelectElement | null
	const holdThreshold = doc.getElementById("a11y-hold-threshold") as HTMLSelectElement | null
	const minDuration = doc.getElementById("a11y-min-duration") as HTMLSelectElement | null
	const resetBtn = doc.getElementById("a11y-reset") as HTMLButtonElement | null
	const status = doc.getElementById("a11y-status")

	const render = () => {
		applyAccessibilityPreferences(doc, prefs)
		if (contrast) {
			contrast.value = prefs.contrast
		}
		if (palette) {
			palette.value = prefs.palette
		}
		if (targetSize) {
			targetSize.value = prefs.targetSize
		}
		if (motion) {
			motion.value = prefs.reducedMotion
		}
		if (beatFlash) {
			beatFlash.checked = prefs.beatFlash
		}
		if (stabilizer) {
			stabilizer.checked = prefs.stabilizerEnabled
		}
		if (debounce) {
			debounce.value = String(prefs.debounceMs)
			debounce.disabled = !prefs.stabilizerEnabled
		}
		if (holdThreshold) {
			holdThreshold.value = String(prefs.holdThresholdMs)
			holdThreshold.disabled = !prefs.stabilizerEnabled
		}
		if (minDuration) {
			minDuration.value = String(prefs.minDurationMs)
			minDuration.disabled = !prefs.stabilizerEnabled
		}
	}

	const persist = () => {
		render()
		try {
			doc.defaultView?.localStorage.setItem(ACCESSIBILITY_STORAGE_KEY, JSON.stringify(prefs))
			if (status) {
				status.textContent = "Accessibility preferences saved in this browser."
			}
		} catch {
			if (status) {
				status.textContent =
					"Browser storage is unavailable. Accessibility preferences apply for this visit."
			}
		}
		events.dispatchEvent(new Event(EVENT_ACCESSIBILITY_CHANGED))
	}

	const update = (patch: Partial<AccessibilityPreferences>) => {
		prefs = { ...prefs, ...patch }
		persist()
	}

	const reset = () => {
		prefs = { ...DEFAULT_ACCESSIBILITY }
		persist()
	}

	contrast?.addEventListener(
		EVENT_CHANGE,
		() => update({ contrast: contrast.value === "high" ? "high" : "standard" }),
		{ signal: abort.signal }
	)
	palette?.addEventListener(
		EVENT_CHANGE,
		() =>
			update({
				palette: palette.value === "colorblind-safe" ? "colorblind-safe" : "default"
			}),
		{ signal: abort.signal }
	)
	targetSize?.addEventListener(
		EVENT_CHANGE,
		() => {
			if (["default", "large", "xlarge"].includes(targetSize.value)) {
				update({ targetSize: targetSize.value as TargetSize })
			}
		},
		{ signal: abort.signal }
	)
	motion?.addEventListener(
		EVENT_CHANGE,
		() => update({ reducedMotion: motion.value === "reduce" ? "reduce" : "system" }),
		{ signal: abort.signal }
	)
	beatFlash?.addEventListener(EVENT_CHANGE, () => update({ beatFlash: beatFlash.checked }), {
		signal: abort.signal
	})
	stabilizer?.addEventListener(
		EVENT_CHANGE,
		() => update({ stabilizerEnabled: stabilizer.checked }),
		{ signal: abort.signal }
	)
	debounce?.addEventListener(
		EVENT_CHANGE,
		() => update({ debounceMs: clampMs(debounce.value, 0, 500) }),
		{ signal: abort.signal }
	)
	holdThreshold?.addEventListener(
		EVENT_CHANGE,
		() => update({ holdThresholdMs: clampMs(holdThreshold.value, 0, 400) }),
		{ signal: abort.signal }
	)
	minDuration?.addEventListener(
		EVENT_CHANGE,
		() => update({ minDurationMs: clampMs(minDuration.value, 0, 1000) }),
		{ signal: abort.signal }
	)
	resetBtn?.addEventListener(EVENT_CLICK, reset, { signal: abort.signal })

	render()

	return Object.assign(events, {
		getPreferences: () => ({ ...prefs }),
		update,
		reset,
		destroy: () => abort.abort()
	})
}

export type SensoryPresetId = "low-vision" | "deaf-tactile"

/** Pair adaptive visual/sensory preferences with matching multimodal outputs on the active chain. */
export async function applySensoryPreset(
	manager: IOChainManager,
	preset: SensoryPresetId,
	accessibility: Pick<AccessibilityController, "update">
): Promise<{ addedOutputs: string[]; summary: string }> {
	const targetTypes =
		preset === "low-vision" ? [DESCRIBE, SPEECH_SYNTHESIS] : [NOTATION, VIBRATOR]
	if (preset === "low-vision") {
		accessibility.update({
			contrast: "high",
			targetSize: "xlarge",
			palette: "colorblind-safe"
		})
	} else {
		accessibility.update({
			beatFlash: true,
			palette: "colorblind-safe",
			targetSize: "large"
		})
	}

	const chain = manager.activeChain ?? manager.chains[0]
	const addedOutputs: string[] = []
	if (chain) {
		const existingTypes = new Set<string>()
		for (const output of chain.outputs) {
			try {
				const type = deviceDefinition(output).type
				if (type) {
					existingTypes.add(type)
				}
			} catch {
				const fallbackType = (output as { type?: string }).type
				if (fallbackType) {
					existingTypes.add(fallbackType)
				}
			}
		}
		for (const type of targetTypes) {
			if (existingTypes.has(type)) {
				continue
			}
			const output = await createOutputById(type, manager.deviceOptions)
			manager.addDevice(chain, output, "output")
			if (typeof output.connect === "function") {
				await output.connect()
			}
			addedOutputs.push(type)
		}
	}

	const summary =
		preset === "low-vision"
			? "Low-vision & speech preset active: high contrast, extra-large targets, chord description and speech readout."
			: "Deaf & tactile preset active: visual beat indicator, colorblind-safe palette, staff notation and haptic vibration."
	return { addedOutputs, summary }
}
