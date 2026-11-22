import { captureAudioToolTake, createAudioToolPanel } from "audiotool"
import { createOpenDAWProjectFromAudioEventRecording } from "opendaw"
import type { IAudioCommand } from "audiobus/commands/audio-command-interface.ts"
import type AudioEventRecorder from "audiobus/events/audio-event-recorder.ts"
import {
	createVexFlowHTMLFromAudioEventRecording,
	renderVexFlowToContainer
} from "audiobus/exporters/adapter-vexflow.ts"
import { saveScoreToLocalFileSystem as saveExportToLocalFileSystem } from "audiobus/exporters/download-score"
import { getExportFormat, type ExportFormat } from "audiobus/exporters/registry"
import type { SequenceNote } from "audiobus/formats/note-sequence"
import { songFromRecording, songNotes } from "audiobus/formats/song-source"
import type IOChainManager from "audiobus/io/IO-chain-manager.ts"
import { captureTrackerSamples } from "audiobus/io/recording/capture-instrument-samples"
import type AudioBus from "../audio.ts"
import type UI from "../ui.ts"
import { loadedSongs } from "./media-import"

const MUTE_RAMP_SECONDS = 0.005

/** Smoothly ramp the master gain down during offline-like instrument sampling, then restore it. */
export function createMasterMute(audioBus: Pick<AudioBus, "audioContext" | "output">): () => () => void {
	return () => {
		const output = audioBus.output.gain
		const volume = output.value
		const now = audioBus.audioContext.currentTime
		if (typeof output.cancelScheduledValues === "function") {
			output.cancelScheduledValues(now)
			output.setTargetAtTime(0, now, MUTE_RAMP_SECONDS)
		} else {
			output.value = 0
		}
		return () => {
			const restoreAt = audioBus.audioContext.currentTime
			if (typeof output.cancelScheduledValues === "function") {
				output.cancelScheduledValues(restoreAt)
				output.setTargetAtTime(volume, restoreAt, MUTE_RAMP_SECONDS)
			} else {
				output.value = volume
			}
		}
	}
}

export interface ExportWiringOptions {
	frontEnd: UI
	audioBus: AudioBus
	recorder: AudioEventRecorder
	getTimer: () => any
	getIOManager: () => IOChainManager | undefined
}

/** Connect export menu buttons, tracker instrument sampling, VexFlow, AudioTool, and OpenDAW. */
export function wireExportControls({
	frontEnd,
	audioBus,
	recorder,
	getTimer,
	getIOManager
}: ExportWiringOptions): void {
	const mute = createMasterMute(audioBus)

	// Tracker modules embed a sample of each instrument as it sounds in HarmonEasy.
	const exportOptionsFor = async (
		format: ExportFormat,
		notes: SequenceNote[]
	): Promise<Parameters<ExportFormat["export"]>[1]> => {
		const ioManager = getIOManager()
		if (format.kind !== "tracker" || !ioManager) {
			return undefined
		}
		frontEnd.setExportOverlayText(`Sampling instruments for ${format.label}…`)
		const samples = await captureTrackerSamples({
			audioContext: audioBus.audioContext,
			getChain: (chainId) => ioManager.getChain(chainId) ?? undefined,
			notes,
			mute,
			onProgress: (done, total) =>
				frontEnd.setExportOverlayText(
					`Sampling instruments for ${format.label} (${done}/${total})…`
				)
		})
		frontEnd.setExportOverlayText(`Exporting ${format.label}…`)
		return { samples }
	}

	/** Export the recording, or a loaded song by its id, without playing it into the recorder. */
	const exportRecording = async (id: string, source = "recording") => {
		try {
			const format = getExportFormat(id)
			if (!format) {
				throw new Error(`Unknown export format: ${id}`)
			}
			frontEnd.setExportOverlayText(`Exporting ${format.label}…`)
			frontEnd.showExportOverlay()
			const ioManager = getIOManager()
			const song =
				source === "recording"
					? songFromRecording(recorder, getTimer())
					: ioManager && loadedSongs(ioManager).find((entry) => entry.id === source)?.song
			if (!song) {
				throw new Error("The selected song is no longer loaded")
			}
			const blob = await format.export(song, await exportOptionsFor(format, songNotes(song)))
			saveExportToLocalFileSystem(blob, song.name, format.extension)
		} catch (error) {
			frontEnd.showError(
				"Export failed",
				error instanceof Error ? error.message : String(error)
			)
		} finally {
			frontEnd.hideExportOverlay()
		}
	}

	frontEnd.whenExportRequestedRun(exportRecording, () => {
		const ioManager = getIOManager()
		return ioManager ? loadedSongs(ioManager) : []
	})

	frontEnd.whenVexFlowExportRequestedRun(async () => {
		await frontEnd.renderVexFlowModal(
			renderVexFlowToContainer,
			recorder,
			getTimer(),
			createVexFlowHTMLFromAudioEventRecording,
			(blob: Blob, name: string) => saveExportToLocalFileSystem(blob, name, "html")
		)
	})

	frontEnd.whenExportMenuRequestedRun(() => {
		console.info("Export menu opened")
	})

	let sentThrough = 0
	let lastSentEvent: IAudioCommand | undefined
	const audioTool = createAudioToolPanel(() => {
		// Reset the cursor when the recorder is cleared or replaced.
		if (sentThrough && recorder.events[sentThrough - 1] !== lastSentEvent) {
			sentThrough = 0
		}
		const end = recorder.events.length
		const lastEvent = recorder.events[end - 1]
		const timer = getTimer()
		const take = captureAudioToolTake(
			recorder.events.slice(sentThrough, end),
			timer.BPM,
			timer.now,
			recorder.name
		)
		return {
			take,
			markSent: () => {
				sentThrough = end
				lastSentEvent = lastEvent
			}
		}
	})
	frontEnd.whenAudioToolExportRequestedRun(() => audioTool.open())

	frontEnd.whenOpenDAWExportRequestedRun(async () => {
		const script = await createOpenDAWProjectFromAudioEventRecording(recorder, getTimer())
		console.info("Exporting Data to OpenDAW", { recorder, script })
		frontEnd.showOpenDAWExportDialog(script)
	})
}
