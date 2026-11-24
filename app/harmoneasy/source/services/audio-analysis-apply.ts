import { analyseAudioBuffer, type TrackAnalysis } from "audiobus/analysis/essentia-client"
import { EVENT_CLICK, EVENT_CONFIGURATION_CHANGED } from "audiobus/events/event-constants"
import type IOChain from "audiobus/io/IO-chain"
import { alignLoopToBeats } from "audiobus/io/outputs/loop-alignment"
import type OutputLoopPlayer from "audiobus/io/outputs/output-loop-player"
import { applyKeyToTransformers, countKeyTransformers } from "audiobus/io/transformers/apply-key"
import { sameHarmony, type HarmonicState } from "audiobus/io/harmony"
import { mapPitchSet } from "audiobus/tuning/pitch-class-set"
import { announceLive, openModalDialog } from "../libs/dialog-utils"

/** Reads and sets the project tempo; setting is unavailable under an external clock. */
export interface TempoControl {
	get(): number
	canSet(): boolean
	set(bpm: number): void
}

/** The app-wide harmony that chord tracks, shared-source transformers and outputs follow. */
export interface HarmonyControl {
	get(): HarmonicState
	/** True while a remote or external source owns the harmony. */
	external(): boolean
	/** True while playing song sections, which set the harmony on every beat. */
	sections(): boolean
	set(harmony: HarmonicState): void
}

export interface AnalysisChoices {
	tempo: boolean
	align: boolean
	key: boolean
	harmony: boolean
}

export interface AnalysisOption {
	label: string
	checked: boolean
	/** Why the option cannot be chosen; its presence disables the checkbox */
	reason?: string
}

export interface AnalysisPlan {
	summary: string
	/** Where the tempo and key came from, so nobody wonders why the app changed key. */
	source: string
	tempo: AnalysisOption
	align: AnalysisOption
	key: AnalysisOption
	harmony: AnalysisOption
}

/** RhythmExtractor2013 reads 1 and above as at least fair. */
export const MIN_TEMPO_CONFIDENCE = 1
/** Below this the key estimate is close to a guess, so it does not change transformers unasked. */
export const MIN_KEY_STRENGTH = 0.5
const ANALYSED_SECONDS = 180
const MIN_PROJECT_BPM = 10
const MAX_PROJECT_BPM = 303

// Pitch-class masks relative to C; HarmonicState masks are absolute, so they are rotated to the tonic
const SCALE_MASKS = { major: 2741, minor: 1453 }
const TRIAD_MASKS = { major: 145, minor: 137 }

/** The shared harmony for a detected key: its scale with the tonic triad as the current chord. */
export function harmonyForKey(analysis: Pick<TrackAnalysis, "key" | "scale">): HarmonicState {
	return {
		root: analysis.key,
		scale: mapPitchSet(SCALE_MASKS[analysis.scale], 1, analysis.key),
		chord: mapPitchSet(TRIAD_MASKS[analysis.scale], 1, analysis.key)
	}
}

const confidenceName = (confidence: number) =>
	confidence > 3.5 ? "excellent" : confidence >= 1.5 ? "good" : confidence >= 1 ? "fair" : "poor"
/** Whole and tenths only: a tempo estimate is not better than that, and it keeps labels readable. */
export const roundBpm = (bpm: number) => Math.round(bpm * 10) / 10

export function describeAnalysis(analysis: TrackAnalysis): string {
	return (
		`Detected ${roundBpm(analysis.bpm)} BPM (${confidenceName(analysis.bpmConfidence)} confidence)` +
		` · ${analysis.keyName} ${analysis.scale} (strength ${analysis.keyStrength.toFixed(2)})`
	)
}

/** What the dialog offers, and which choices start ticked. */
export function planAnalysis(
	analysis: TrackAnalysis,
	context: {
		tempo?: TempoControl
		harmony?: HarmonyControl
		duration: number
		keyTransformers: number
		fileName?: string
	}
): AnalysisPlan {
	const bpm = roundBpm(analysis.bpm)
	const reliable = analysis.bpmConfidence >= MIN_TEMPO_CONFIDENCE
	const keyName = `${analysis.keyName} ${analysis.scale}`
	let tempoReason: string | undefined
	if (!context.tempo?.canSet()) {
		tempoReason = "The tempo follows an external clock, so it cannot be set here."
	} else if (bpm < MIN_PROJECT_BPM || bpm > MAX_PROJECT_BPM) {
		tempoReason = `The detected tempo is outside ${MIN_PROJECT_BPM}–${MAX_PROJECT_BPM} BPM.`
	} else if (Math.abs(context.tempo.get() - bpm) < 0.05) {
		tempoReason = `The project tempo is already ${bpm} BPM.`
	}
	const alignReason = alignLoopToBeats(analysis, context.duration)
		? undefined
		: "The audio is too short to hold a beat."
	const keyReason = context.keyTransformers
		? undefined
		: "No transformer in this chain has a key setting."
	const file = context.fileName ? `“${context.fileName}”` : "the dropped audio"
	// analyseAudioBuffer measures at most its default 180 seconds
	const portion = context.duration > ANALYSED_SECONDS ? "the first 3 minutes of " : ""
	let harmonyReason: string | undefined
	if (!context.harmony) {
		harmonyReason = "The shared harmony is unavailable here."
	} else if (context.harmony.external()) {
		harmonyReason = "The shared harmony follows an external source, so it cannot be set here."
	} else if (context.harmony.sections()) {
		harmonyReason = "Song sections set the shared harmony while they play."
	} else if (sameHarmony(context.harmony.get(), harmonyForKey(analysis))) {
		harmonyReason = `The shared harmony is already ${keyName}.`
	}
	return {
		summary: describeAnalysis(analysis),
		source:
			`Measured from ${portion}${file} by Essentia: the tempo from its beat tracker, ` +
			"the key by matching the audio’s pitch content against major and minor key profiles.",
		tempo: {
			label: `Set project tempo to ${bpm} BPM`,
			checked: !tempoReason && reliable,
			reason: tempoReason
		},
		align: {
			label: "Align loop to detected beats",
			checked: !alignReason && reliable,
			reason: alignReason
		},
		key: {
			label: context.keyTransformers
				? `Set key of ${context.keyTransformers} transformer${context.keyTransformers === 1 ? "" : "s"} to ${keyName}`
				: `Set key of transformers to ${keyName}`,
			checked: !keyReason && analysis.keyStrength >= MIN_KEY_STRENGTH,
			reason: keyReason
		},
		// App-wide, so it is always an explicit choice rather than a default
		harmony: {
			label: `Set the shared harmony to ${keyName}, the key detected in ${file} (affects every chain)`,
			checked: false,
			reason: harmonyReason
		}
	}
}

let dialogCount = 0

/** Show what was detected with the actions on offer; resolves with the choices on Apply, or undefined. */
export async function askAnalysisChoices(plan: AnalysisPlan): Promise<AnalysisChoices | undefined> {
	const id = ++dialogCount
	const dialog = document.createElement("dialog")
	const title = document.createElement("h2")
	const summary = document.createElement("p")
	const source = document.createElement("p")
	title.id = `analysis-title-${id}`
	title.textContent = "Audio analysed"
	summary.textContent = plan.summary
	source.textContent = plan.source
	dialog.className = "analysis-dialog"
	dialog.setAttribute("aria-labelledby", title.id)
	dialog.append(title, summary, source)

	const boxes = {} as Record<keyof AnalysisChoices, HTMLInputElement>
	for (const name of ["tempo", "align", "key", "harmony"] as const) {
		const option = plan[name]
		const row = document.createElement("div")
		const label = document.createElement("label")
		const box = document.createElement("input")
		box.type = "checkbox"
		box.checked = option.checked
		box.disabled = Boolean(option.reason)
		label.append(box, ` ${option.label}`)
		row.append(label)
		if (option.reason) {
			const reason = document.createElement("small")
			reason.id = `analysis-${name}-reason-${id}`
			reason.textContent = option.reason
			box.setAttribute("aria-describedby", reason.id)
			row.append(document.createElement("br"), reason)
		}
		boxes[name] = box
		dialog.append(row)
	}

	let choices: AnalysisChoices | undefined
	const apply = document.createElement("button"),
		dismiss = document.createElement("button")
	apply.type = dismiss.type = "button"
	apply.textContent = "Apply"
	dismiss.textContent = "Dismiss"
	apply.autofocus = true
	apply.addEventListener(EVENT_CLICK, () => {
		choices = {
			tempo: boxes.tempo.checked,
			align: boxes.align.checked,
			key: boxes.key.checked,
			harmony: boxes.harmony.checked
		}
		dialog.close()
	})
	dismiss.addEventListener(EVENT_CLICK, () => dialog.close())
	dialog.append(apply, dismiss)
	document.body.append(dialog)
	// Escape closes the dialog without choices, as Dismiss does
	await openModalDialog(dialog, { removeOnClose: true })
	return choices
}

export interface LoopAnalysisTarget {
	output: OutputLoopPlayer
	chain: IOChain
	tempo?: TempoControl
	harmony?: HarmonyControl
}

/**
 * Measure a freshly loaded loop, keep the result with the Loop Player, then offer to apply it.
 * Callers run this beside the import: analysis is slow and optional, so its failures never fail a load.
 */
export async function analyseImportedLoop(
	{ output, chain, tempo, harmony }: LoopAnalysisTarget,
	ask: typeof askAnalysisChoices = askAnalysisChoices
): Promise<void> {
	const buffer = output.audioBuffer
	if (!buffer) {
		return
	}
	const analysis = await analyseAudioBuffer(buffer)
	// The file may have been replaced, or the device removed, while the worker ran
	if (output.audioBuffer !== buffer) {
		return
	}
	output.applyAnalysis(analysis, { align: false })
	const plan = planAnalysis(analysis, {
		tempo,
		harmony,
		duration: buffer.duration,
		keyTransformers: countKeyTransformers(chain.transformers),
		fileName: output.options?.fileName
	})
	if (![plan.tempo, plan.align, plan.key, plan.harmony].some((option) => !option.reason)) {
		announceLive(`${plan.summary}. ${plan.source}`)
		return
	}
	const choices = await ask(plan)
	if (!choices || output.audioBuffer !== buffer) {
		return
	}
	const applied: string[] = []
	if (choices.tempo && tempo?.canSet()) {
		tempo.set(roundBpm(analysis.bpm))
		applied.push(`tempo ${roundBpm(analysis.bpm)} BPM`)
	}
	if (choices.align && output.applyAnalysis(analysis)) {
		applied.push("loop aligned")
	}
	if (choices.key && !chain.isDestroyed) {
		const changed = applyKeyToTransformers(chain.transformers, {
			key: analysis.key,
			scale: analysis.scale
		})
		if (changed.length) {
			// The chain saves the workspace when told its configuration changed
			chain.dispatchEvent(new Event(EVENT_CONFIGURATION_CHANGED))
			applied.push(`key ${analysis.keyName} ${analysis.scale}`)
		}
	}
	if (choices.harmony && harmony && !harmony.external() && !harmony.sections()) {
		harmony.set(harmonyForKey(analysis))
		applied.push(
			`shared harmony ${analysis.keyName} ${analysis.scale} (detected in ${output.options?.fileName ?? "the dropped audio"})`
		)
	}
	if (applied.length) {
		announceLive(`Applied ${applied.join(", ")}`)
	}
}