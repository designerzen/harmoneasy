import type AudioEventRecorder from "audiobus/events/audio-event-recorder.ts"
import type IOChainManager from "audiobus/io/IO-chain-manager.ts"
import { TIMER_TYPES } from "netronome"
import type AudioBus from "../audio.ts"
import type State from "../libs/state.ts"
import type UI from "../ui.ts"

export interface TransportWiringOptions {
	frontEnd: UI
	audioBus: AudioBus
	timer: any
	state: State
	recorder: AudioEventRecorder
	getIOManager: () => IOChainManager | undefined
	getNetronomeLink: () => { silence(): void; tempoChanged(): void } | undefined
	onMetronomeToggle: () => Promise<void>
}

/** Parse persisted volume percent safely, preserving explicit 0%. */
export function parseInitialVolumePercent(volumeState: unknown, fallback = 50): number {
	const parsed =
		volumeState != null && volumeState !== "" ? parseFloat(String(volumeState)) : NaN
	return Number.isFinite(parsed) ? parsed : fallback
}

/** Parse persisted tempo safely, falling back when unset or invalid. */
export function parseInitialTempo(tempoState: unknown, fallback = 99): number {
	const parsed = parseFloat(String(tempoState ?? ""))
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/** Wire front-end transport, tempo, swing, volume, timer, reset, and panic controls. */
export function wireFrontEndControls({
	frontEnd,
	audioBus,
	timer,
	state,
	recorder,
	getIOManager,
	getNetronomeLink,
	onMetronomeToggle
}: TransportWiringOptions): void {
	frontEnd.whenMetronomeRequestedRun(onMetronomeToggle)

	// Panic button - kill all playing notes.
	frontEnd.whenKillSwitchRequestedRun(async () => {
		getNetronomeLink()?.silence()
		console.info("[Kill Switch] All notes off requested")
		getIOManager()?.chains.forEach((chain) => {
			chain.allNotesOff()
		})
	})

	// Reset Recorder - clear all played notes.
	frontEnd.whenResetRequestedRun(async () => {
		recorder.clear()
		frontEnd.noteTimeline.clear()
		timer.resetTimer()
	})

	frontEnd.whenTempoChangesRun((tempo: number) => {
		timer.BPM = tempo
		getNetronomeLink()?.tempoChanged()
		state.set("tempo", tempo)
	})

	frontEnd.whenSwingChangesRun((swing: number) => {
		timer.swing = swing
		getNetronomeLink()?.tempoChanged()
		state.set("swing", swing)
	})

	frontEnd.whenTempoUpRequestedRun(() => {
		const newTempo = Math.min(303, timer.BPM + 1)
		timer.BPM = newTempo
		getNetronomeLink()?.tempoChanged()
		frontEnd.setTempo(newTempo)
		state.set("tempo", newTempo)
	})

	frontEnd.whenTempoDownRequestedRun(() => {
		const newTempo = Math.max(10, timer.BPM - 1)
		timer.BPM = newTempo
		getNetronomeLink()?.tempoChanged()
		frontEnd.setTempo(newTempo)
		state.set("tempo", newTempo)
	})

	// Settings - Timer Type Selection.
	frontEnd.whenSettingsRequestedRun(() => {
		const currentTimerType = state.get("timerType") || TIMER_TYPES.AUDIO_CONTEXT
		frontEnd.setTimerType(currentTimerType as string)
	})

	frontEnd.whenTimerTypeChangesRun(async (timerType: string) => {
		console.info("Timer type change requested:", timerType)
		try {
			const success = await timer.switchTimerType(timerType, audioBus.audioContext)
			if (success) {
				state.set("timerType", timerType)
				console.info("Timer type switched successfully to:", timerType)
			} else {
				console.warn("Failed to switch timer type to:", timerType)
				frontEnd.showError("Timer Switch Failed", `Could not switch to ${timerType}`)
			}
		} catch (error) {
			console.error("Error switching timer type:", error)
			frontEnd.showError(
				"Timer Switch Error",
				error instanceof Error ? error.message : "Unknown error"
			)
		}
	})

	frontEnd.whenVolumeChangesRun((volume: number) => {
		audioBus.volume = volume / 100
		state.set("volume", volume)
	})

	frontEnd.whenVolumeUpRequestedRun(() => {
		const volumeElement = frontEnd.elementVolume as HTMLInputElement
		const currentVolume = parseInt(volumeElement.value, 10)
		const newVolume = Math.min(100, currentVolume + 5)
		volumeElement.value = String(newVolume)
		audioBus.volume = newVolume / 100
		if (frontEnd.elementVolumeOutput) {
			frontEnd.elementVolumeOutput.textContent = String(newVolume)
		}
		state.set("volume", newVolume)
	})

	frontEnd.whenVolumeDownRequestedRun(() => {
		const volumeElement = frontEnd.elementVolume as HTMLInputElement
		const currentVolume = parseInt(volumeElement.value, 10)
		const newVolume = Math.max(0, currentVolume - 5)
		volumeElement.value = String(newVolume)
		audioBus.volume = newVolume / 100
		if (frontEnd.elementVolumeOutput) {
			frontEnd.elementVolumeOutput.textContent = String(newVolume)
		}
		state.set("volume", newVolume)
	})
}
