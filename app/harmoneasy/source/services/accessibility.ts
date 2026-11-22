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
export type MotionPreference = "system" | "reduce" | "allow"
export type FontScale = "default" | "large" | "xlarge" | "xxlarge"
export type TextSpacing = "default" | "comfortable" | "wide"
export type ReadableFont = "default" | "sans" | "mono"
export type FocusIndicatorMode = "default" | "enhanced" | "maximum"
export type AnnouncementMode = "normal" | "minimal"

export interface AccessibilityPreferences {
	contrast: ContrastMode
	palette: PaletteMode
	targetSize: TargetSize
	fontScale: FontScale
	textSpacing: TextSpacing
	readableFont: ReadableFont
	focusIndicator: FocusIndicatorMode
	underlineLinks: boolean
	reducedMotion: MotionPreference
	announcements: AnnouncementMode
	beatFlash: boolean
	characterShortcuts: boolean
	stabilizerEnabled: boolean
	debounceMs: number
	holdThresholdMs: number
	minDurationMs: number
}

export const DEFAULT_ACCESSIBILITY: AccessibilityPreferences = {
	contrast: "standard",
	palette: "default",
	targetSize: "default",
	fontScale: "default",
	textSpacing: "default",
	readableFont: "default",
	focusIndicator: "default",
	underlineLinks: false,
	reducedMotion: "system",
	announcements: "normal",
	beatFlash: false,
	characterShortcuts: true,
	stabilizerEnabled: false,
	debounceMs: 120,
	holdThresholdMs: 0,
	minDurationMs: 0
}

export function extractAccessibilityPreferences(
	source: AccessibilityPreferences
): AccessibilityPreferences {
	return {
		contrast: source.contrast,
		palette: source.palette,
		targetSize: source.targetSize,
		fontScale: source.fontScale,
		textSpacing: source.textSpacing,
		readableFont: source.readableFont,
		focusIndicator: source.focusIndicator,
		underlineLinks: source.underlineLinks,
		reducedMotion: source.reducedMotion,
		announcements: source.announcements,
		beatFlash: source.beatFlash,
		characterShortcuts: source.characterShortcuts,
		stabilizerEnabled: source.stabilizerEnabled,
		debounceMs: source.debounceMs,
		holdThresholdMs: source.holdThresholdMs,
		minDurationMs: source.minDurationMs
	}
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
			fontScale: ["default", "large", "xlarge", "xxlarge"].includes(saved?.fontScale)
				? (saved.fontScale as FontScale)
				: "default",
			textSpacing: ["default", "comfortable", "wide"].includes(saved?.textSpacing)
				? (saved.textSpacing as TextSpacing)
				: "default",
			readableFont: ["default", "sans", "mono"].includes(saved?.readableFont)
				? (saved.readableFont as ReadableFont)
				: "default",
			focusIndicator: ["default", "enhanced", "maximum"].includes(saved?.focusIndicator)
				? (saved.focusIndicator as FocusIndicatorMode)
				: "default",
			underlineLinks: saved?.underlineLinks === true,
			reducedMotion: ["system", "reduce", "allow"].includes(saved?.reducedMotion)
				? (saved.reducedMotion as MotionPreference)
				: "system",
			announcements: saved?.announcements === "minimal" ? "minimal" : "normal",
			beatFlash: saved?.beatFlash === true,
			characterShortcuts: saved?.characterShortcuts !== false,
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
	if (prefs.fontScale !== "default") {
		root.dataset.fontScale = prefs.fontScale
	} else {
		delete root.dataset.fontScale
	}
	if (prefs.textSpacing !== "default") {
		root.dataset.textSpacing = prefs.textSpacing
	} else {
		delete root.dataset.textSpacing
	}
	if (prefs.readableFont !== "default") {
		root.dataset.readableFont = prefs.readableFont
	} else {
		delete root.dataset.readableFont
	}
	if (prefs.focusIndicator !== "default") {
		root.dataset.focusIndicator = prefs.focusIndicator
	} else {
		delete root.dataset.focusIndicator
	}
	if (prefs.underlineLinks) {
		root.dataset.underlineLinks = "on"
	} else {
		delete root.dataset.underlineLinks
	}
	if (prefs.reducedMotion === "reduce" || prefs.reducedMotion === "allow") {
		root.dataset.reducedMotion = prefs.reducedMotion
	} else {
		delete root.dataset.reducedMotion
	}
	if (prefs.announcements === "minimal") {
		root.dataset.announcements = "minimal"
	} else {
		delete root.dataset.announcements
	}
	if (prefs.beatFlash) {
		root.dataset.beatFlash = "on"
	} else {
		delete root.dataset.beatFlash
	}
	if (prefs.characterShortcuts === false) {
		root.dataset.shortcuts = "off"
	} else {
		delete root.dataset.shortcuts
	}
}

export interface AccessibilityControlsOptions {
	onSensoryPreset?: (preset: SensoryPresetId) => string | void | Promise<string | void>
}

export interface AccessibilityController extends EventTarget {
	getPreferences(): AccessibilityPreferences
	update(patch: Partial<AccessibilityPreferences>): void
	reset(): void
	destroy(): void
}

export const SENSORY_PRESET_PREFERENCES: Record<SensoryPresetId, Partial<AccessibilityPreferences>> =
	{
		"low-vision": {
			contrast: "high",
			targetSize: "xlarge",
			palette: "colorblind-safe",
			fontScale: "large",
			focusIndicator: "enhanced"
		},
		"deaf-tactile": {
			beatFlash: true,
			palette: "colorblind-safe",
			targetSize: "large"
		}
	}

export function createAccessibilityControls(
	doc: Document,
	options: AccessibilityControlsOptions = {}
): AccessibilityController {
	const events = new EventTarget()
	const abort = new AbortController()
	let prefs = readAccessibilityPreferences(doc)

	const contrast = doc.getElementById("a11y-contrast") as HTMLSelectElement | null
	const palette = doc.getElementById("a11y-palette") as HTMLSelectElement | null
	const targetSize = doc.getElementById("a11y-target-size") as HTMLSelectElement | null
	const fontScale = doc.getElementById("a11y-font-scale") as HTMLSelectElement | null
	const textSpacing = doc.getElementById("a11y-text-spacing") as HTMLSelectElement | null
	const readableFont = doc.getElementById("a11y-readable-font") as HTMLSelectElement | null
	const focusIndicator = doc.getElementById("a11y-focus-indicator") as HTMLSelectElement | null
	const underlineLinks = doc.getElementById("a11y-underline-links") as HTMLInputElement | null
	const motion = doc.getElementById("a11y-reduced-motion") as HTMLSelectElement | null
	const announcements = doc.getElementById("a11y-announcements") as HTMLSelectElement | null
	const beatFlash = doc.getElementById("a11y-beat-flash") as HTMLInputElement | null
	const shortcuts = doc.getElementById("a11y-shortcuts") as HTMLInputElement | null
	const stabilizer = doc.getElementById("a11y-stabilizer") as HTMLInputElement | null
	const debounce = doc.getElementById("a11y-debounce") as HTMLSelectElement | null
	const holdThreshold = doc.getElementById("a11y-hold-threshold") as HTMLSelectElement | null
	const minDuration = doc.getElementById("a11y-min-duration") as HTMLSelectElement | null
	const lowVisionBtn = doc.getElementById("a11y-preset-low-vision") as HTMLButtonElement | null
	const deafTactileBtn = doc.getElementById("a11y-preset-deaf-tactile") as HTMLButtonElement | null
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
		if (fontScale) {
			fontScale.value = prefs.fontScale
		}
		if (textSpacing) {
			textSpacing.value = prefs.textSpacing
		}
		if (readableFont) {
			readableFont.value = prefs.readableFont
		}
		if (focusIndicator) {
			focusIndicator.value = prefs.focusIndicator
		}
		if (underlineLinks) {
			underlineLinks.checked = prefs.underlineLinks
		}
		if (motion) {
			motion.value = prefs.reducedMotion
		}
		if (announcements) {
			announcements.value = prefs.announcements
		}
		if (beatFlash) {
			beatFlash.checked = prefs.beatFlash
		}
		if (shortcuts) {
			shortcuts.checked = prefs.characterShortcuts
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

	const persist = (statusMessage?: string) => {
		render()
		try {
			doc.defaultView?.localStorage.setItem(ACCESSIBILITY_STORAGE_KEY, JSON.stringify(prefs))
			if (status) {
				status.textContent = statusMessage ?? "Accessibility preferences saved in this browser."
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
		persist("Accessibility preferences reset to defaults.")
	}

	const triggerSensoryPreset = async (preset: SensoryPresetId) => {
		prefs = { ...prefs, ...SENSORY_PRESET_PREFERENCES[preset] }
		const defaultSummary =
			preset === "low-vision"
				? "Low-vision preset applied: high contrast, large text, enhanced focus ring, and extra-large targets."
				: "Deaf & tactile preset applied: visual beat flash, colorblind-safe palette, and large targets."
		persist(defaultSummary)
		if (options.onSensoryPreset) {
			try {
				const summary = await options.onSensoryPreset(preset)
				if (summary && status) {
					status.textContent = summary
				}
			} catch (error) {
				if (status) {
					status.textContent = error instanceof Error ? error.message : String(error)
				}
			}
		}
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
	fontScale?.addEventListener(
		EVENT_CHANGE,
		() => {
			if (["default", "large", "xlarge", "xxlarge"].includes(fontScale.value)) {
				update({ fontScale: fontScale.value as FontScale })
			}
		},
		{ signal: abort.signal }
	)
	textSpacing?.addEventListener(
		EVENT_CHANGE,
		() => {
			if (["default", "comfortable", "wide"].includes(textSpacing.value)) {
				update({ textSpacing: textSpacing.value as TextSpacing })
			}
		},
		{ signal: abort.signal }
	)
	readableFont?.addEventListener(
		EVENT_CHANGE,
		() => {
			if (["default", "sans", "mono"].includes(readableFont.value)) {
				update({ readableFont: readableFont.value as ReadableFont })
			}
		},
		{ signal: abort.signal }
	)
	focusIndicator?.addEventListener(
		EVENT_CHANGE,
		() => {
			if (["default", "enhanced", "maximum"].includes(focusIndicator.value)) {
				update({ focusIndicator: focusIndicator.value as FocusIndicatorMode })
			}
		},
		{ signal: abort.signal }
	)
	underlineLinks?.addEventListener(
		EVENT_CHANGE,
		() => update({ underlineLinks: underlineLinks.checked }),
		{ signal: abort.signal }
	)
	motion?.addEventListener(
		EVENT_CHANGE,
		() => {
			if (["system", "reduce", "allow"].includes(motion.value)) {
				update({ reducedMotion: motion.value as MotionPreference })
			}
		},
		{ signal: abort.signal }
	)
	announcements?.addEventListener(
		EVENT_CHANGE,
		() =>
			update({
				announcements: announcements.value === "minimal" ? "minimal" : "normal"
			}),
		{ signal: abort.signal }
	)
	beatFlash?.addEventListener(EVENT_CHANGE, () => update({ beatFlash: beatFlash.checked }), {
		signal: abort.signal
	})
	shortcuts?.addEventListener(
		EVENT_CHANGE,
		() => update({ characterShortcuts: shortcuts.checked }),
		{ signal: abort.signal }
	)
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
	lowVisionBtn?.addEventListener(EVENT_CLICK, () => void triggerSensoryPreset("low-vision"), {
		signal: abort.signal
	})
	deafTactileBtn?.addEventListener(EVENT_CLICK, () => void triggerSensoryPreset("deaf-tactile"), {
		signal: abort.signal
	})
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
	accessibility.update(SENSORY_PRESET_PREFERENCES[preset])

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
