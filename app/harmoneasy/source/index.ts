import "./assets/style/index.scss"

// Polyfills : https://github.com/webrtc/adapter
import "webrtc-adapter"

import { DEFAULT_OPTIONS } from "./options.ts"
import State from "./libs/state.ts"

// Front End
import UI from "./ui.ts"
import { createAboutDialog } from "./services/about-dialog"
import { createCommandPalette } from "./services/command-palette"
import { createThemeControls } from "./services/theme"
import { createEmptySetup, createStartContexts } from "./services/start-contexts"
import { applySetup } from "./components/graph/saved-presets"
import type { PresetSetup } from "audiobus/io/preset-library"
import { createNetronomeLink } from "./services/netronome-link"
import { readRoomUrl } from "./services/room-url"
import { createMidiControlPanel } from "./services/midi-control-panel"
import { startKnownMidiInputs } from "audiobus/midi/hardware/known-midi-inputs"
import { showMidiDeviceDisconnected } from "./services/midi-device-errors"
import { createMidiDevicesDialog } from "./services/midi-devices-dialog"
import { createRecordingControls } from "./services/recording-dialog"
import { createMusicTools } from "./services/music-tools-panel"
import { createClockSourceControls } from "./services/clock-source-controls"
import { createMediaImporter } from "./services/media-import"
import { isClockSource, clockMidiPorts, type ClockSourceController } from "./services/clock-source"

// Import Data
import { importDawProjectFile } from "audiobus/importers/import-dawproject"
import { importMusicXMLFile } from "audiobus/importers/import-musicxml-import"
import { importMIDIFile } from "audiobus/importers/import-midi-file"
import { importTrackerFile } from "audiobus/importers/import-tracker-file"

// Integration
import { captureAudioToolTake, createAudioToolPanel } from "audiotool"
import { createOpenDAWProjectFromAudioEventRecording } from "opendaw"

// Export Data as a file to another service
import {
	createMIDIFileFromAudioEventRecording,
	saveBlobToLocalFileSystem
} from "audiobus/exporters/adapter-midi-file.ts"
import {
	createMEDFileFromAudioEventRecording,
	saveMEDToLocalFileSystem
} from "audiobus/exporters/adapter-med-file.ts"
import {
	createMIDIMarkdownFromAudioEventRecording,
	saveMarkdownToLocalFileSystem
} from "audiobus/exporters/adapter-midi-markdown.ts"
import {
	createMusicXMLFromAudioEventRecording,
	saveBlobToLocalFileSystem as saveMusicXMLBlobToLocalFileSystem
} from "audiobus/exporters/adapter-musicxml.ts"
import {
	renderVexFlowToContainer,
	createVexFlowHTMLFromAudioEventRecording,
	saveBlobToLocalFileSystem as saveVexFlowBlobToLocalFileSystem
} from "audiobus/exporters/adapter-vexflow.ts"
import {
	createDawProjectFromAudioEventRecording,
	saveDawProjectToLocalFileSystem
} from "audiobus/exporters/adapter-dawproject.ts"

// Timing
import { AudioTimer, TIMER_TYPES } from "netronome"

// Audio
import AudioBus from "./audio.ts"
import "audiobus/audio-event.ts"
import AudioEventRecorder from "audiobus/audio-event-recorder.ts"
import IOChainManager from "audiobus/io/IO-chain-manager.ts"
import OutputMetronome from "audiobus/io/outputs/output-metronome.ts"
import * as Commands from "audiobus/commands"

// IAudioInputs
import { ALL_KEYBOARD_NOTES } from "audiobus/io/inputs/input-onscreen-keyboard.ts"

// Back End
import OPFSStorage, { hasOPFS } from "audiobus/storage/opfs-storage.ts"

// Types
import type { IAudioCommand } from "audiobus/audio-command-interface.ts"

createThemeControls(document)
createAboutDialog(document)
createCommandPalette(document)

const storage = hasOPFS() ? new OPFSStorage() : null
const recorder: AudioEventRecorder = new AudioEventRecorder()
let timer: any = null
let bus: AudioBus
let state: State
let ui: UI
let ioManager: IOChainManager
let metronome: OutputMetronome | null = null
let metronomeEnabled = false
let netronomeLink: ReturnType<typeof createNetronomeLink> | undefined
let clockSource: ClockSourceController | undefined
let musicTools: ReturnType<typeof createMusicTools> | undefined

/**
 * Universal import handler - routes to appropriate importer based on file type
 */
const importFile = async (
	file: File
): Promise<{ commands: IAudioCommand[]; noteCount: number }> => {
	const fileName = file.name.toLowerCase()

	// MIDI formats
	if (fileName.endsWith(".mid") || fileName.endsWith(".midi") || file.type.includes("midi")) {
		return importMIDIFile(file)
	}

	// MusicXML formats
	if (fileName.endsWith(".musicxml") || fileName.endsWith(".xml")) {
		return importMusicXMLFile(file)
	}

	// DawProject format
	if (fileName.endsWith(".dawproject")) {
		return importDawProjectFile(file)
	}

	// Tracker formats (MOD, XM, IT, S3M, etc.)
	const trackerExtensions = [
		".mod",
		".xm",
		".it",
		".s3m",
		".669",
		".far",
		".stm",
		".ult",
		".mtm",
		".dmf",
		".ptm",
		".okt",
		".mptm",
		".nst"
	]
	if (trackerExtensions.some((ext) => fileName.endsWith(ext))) {
		return importTrackerFile(file)
	}

	throw new Error(
		`Unsupported file type: ${file.type || fileName}. Supported formats: MIDI (.mid, .midi), MusicXML (.musicxml, .xml), DawProject (.dawproject), and Tracker formats (.mod, .xm, .it, .s3m, .669, .far, .stm, .ult, .mtm, .dmf, .ptm, .okt, .mptm, .nst)`
	)
}

/**
 * Create the UI and front end
 * TODO: Condense and optimise
 */
const initialiseFrontEnd = async (audioBus: AudioBus, initialVolumePercent: number = 100) => {
	// const keyboard:SVGKeyboard = new SVGKeyboard(ALL_KEYBOARD_NOTES, onNoteOn, onNoteOff)
	const frontEnd = new UI(ALL_KEYBOARD_NOTES)
	frontEnd.setTempo(timer.BPM)
	frontEnd.setSwing(timer.swing)
	frontEnd.setVolume(initialVolumePercent)
	frontEnd.setMetronomeEnabled(metronomeEnabled)
	frontEnd.whenMetronomeRequestedRun(async () => {
		metronomeEnabled = !metronomeEnabled
		frontEnd.setMetronomeEnabled(metronomeEnabled)
		if (!metronomeEnabled) {
			return
		}
		try {
			await bus.audioContext.resume()
			metronome ??= new OutputMetronome(bus.audioContext)
			if (metronomeEnabled && clockSource?.source === "internal") {
				await ioManager.transport("start")
			}
		} catch (error) {
			metronomeEnabled = false
			frontEnd.setMetronomeEnabled(false)
			frontEnd.showError(
				"Metronome unavailable",
				error instanceof Error ? error.message : String(error)
			)
		}
	})
	// frontEnd.setUIKeyboard( keyboard )

	// Panic button  - kill all playing notes
	frontEnd.whenKillSwitchRequestedRun(async () => {
		netronomeLink?.silence()
		console.info("[Kill Switch] All notes off requested")
		ioManager.chains.forEach((chain) => {
			chain.allNotesOff()
		})
	})

	// Reset Recorder - kill all played notes
	frontEnd.whenResetRequestedRun(async () => {
		recorder.clear()
		frontEnd.noteTimeline.clear()
		timer.resetTimer()
	})

	// FIXME: Random timbre button
	// ui.whenRandomTimbreRequestedRun(e => synthesizer.setRandomTimbre())

	frontEnd.whenTempoChangesRun((tempo: number) => {
		timer.BPM = tempo
		netronomeLink?.tempoChanged()
		state.set("tempo", tempo)
	})

	frontEnd.whenSwingChangesRun((swing: number) => {
		timer.swing = swing
		netronomeLink?.tempoChanged()
		state.set("swing", swing)
	})

	frontEnd.whenTempoUpRequestedRun(() => {
		const newTempo = Math.min(303, timer.BPM + 1)
		timer.BPM = newTempo
		netronomeLink?.tempoChanged()
		frontEnd.setTempo(newTempo)
		state.set("tempo", newTempo)
	})

	frontEnd.whenTempoDownRequestedRun(() => {
		const newTempo = Math.max(10, timer.BPM - 1)
		timer.BPM = newTempo
		netronomeLink?.tempoChanged()
		frontEnd.setTempo(newTempo)
		state.set("tempo", newTempo)
	})

	// Settings - Timer Type Selection
	frontEnd.whenSettingsRequestedRun(() => {
		const currentTimerType = state.get("timerType") || TIMER_TYPES.AUDIO_CONTEXT
		frontEnd.setTimerType(currentTimerType as string)
	})

	frontEnd.whenTimerTypeChangesRun(async (timerType: string) => {
		console.info("Timer type change requested:", timerType)
		try {
			const success = await timer.switchTimerType(timerType, bus.audioContext)
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

	frontEnd.whenMIDIFileExportRequestedRun(async () => {
		const blob = await createMIDIFileFromAudioEventRecording(recorder, timer)
		saveBlobToLocalFileSystem(blob, recorder.name)
		console.info("Exporting Data to MIDI File", { recorder, blob })
	})
	frontEnd.whenMEDExportRequestedRun(async () => {
		const buffer = await createMEDFileFromAudioEventRecording(recorder, timer)
		saveMEDToLocalFileSystem(buffer, recorder.name)
		console.info("Exporting Data to ProTracker MED File", { recorder, buffer })
	})
	frontEnd.whenMIDIMarkdownExportRequestedRun(async () => {
		const markdown = createMIDIMarkdownFromAudioEventRecording(recorder, timer)
		saveMarkdownToLocalFileSystem(markdown, recorder.name)
		console.info("Exporting Data to MIDI Markdown", { recorder, markdown })
	})
	frontEnd.whenMusicXMLExportRequestedRun(async () => {
		const blob = await createMusicXMLFromAudioEventRecording(recorder, timer)
		saveMusicXMLBlobToLocalFileSystem(blob, recorder.name)
		console.info("Exporting Data to MusicXML", { recorder, blob })
		frontEnd.showInfoDialog("MusicXML File created and saved", "musicxml.org")
	})
	frontEnd.whenVexFlowExportRequestedRun(async () => {
		await frontEnd.renderVexFlowModal(
			renderVexFlowToContainer,
			recorder,
			timer,
			createVexFlowHTMLFromAudioEventRecording,
			saveVexFlowBlobToLocalFileSystem
		)
	})

	const importScore = async (file: File) => {
		const { commands } = await importFile(file)
		const chain = ioManager.activeChain ?? ioManager.getChain(ioManager.createEmptyChain())!
		chain.addCommandToFuture(commands, timer, true)
	}
	let importMedia: ReturnType<typeof createMediaImporter> | undefined
	let importQueue = Promise.resolve()
	const loadMedia = (media: File | string) => {
		importQueue = importQueue.then(async () => {
			try {
				frontEnd.showExportOverlay(
					`Loading ${typeof media === "string" ? "WAM plugin" : media.name}…`
				)
				if (!ioManager) {
					throw new Error(
						"Audio is still starting. Try dropping the file again in a moment."
					)
				}
				importMedia ??= createMediaImporter(ioManager, importScore)
				await importMedia(media)
			} catch (error) {
				frontEnd.showError(
					"Failed to load media",
					error instanceof Error ? error.message : String(error)
				)
			} finally {
				frontEnd.hideExportOverlay()
			}
		})
	}
	frontEnd.whenFileImportRequestedRun(loadMedia)
	frontEnd.whenMediaDroppedRun(loadMedia)

	// Exports --------------------------------------------------
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
		const script = await createOpenDAWProjectFromAudioEventRecording(recorder, timer)
		console.info("Exporting Data to OpenDAW", { recorder, script })
		frontEnd.showOpenDAWExportDialog(script)
	})
	frontEnd.whenDawProjectExportRequestedRun(async () => {
		const blob = await createDawProjectFromAudioEventRecording(recorder, timer)
		const filename = (recorder.name ?? "project").replace(/\s+/g, "_")
		await saveDawProjectToLocalFileSystem(blob, filename)
		console.info("Exporting Data to .dawProject", { recorder, blob })
	})

	// TODO: Global scale?
	// frontEnd.whenNewScaleIsSelected( (scaleNName:string, select:HTMLElement ) => {
	//     console.log("New scale selected:", scaleNName)
	//     // state.set( scaleNName, true )

	//     // ensure we turn all notes off before we change
	//     // otherwise any currently active notes may stick fprever

	//     intervalFormula = INTERVALS.MODAL_SCALES[TUNING_MODE_NAMES.indexOf(scaleNName) ]
	// })

	// frontEnd.whenNoteVisualiserDoubleClickedRun(() => {
	//     synthesizer.setRandomTimbre()
	// })

	return frontEnd
}

/**
 * Connect the parts of our application and watches for
 * any events to alter behaviour
 *
 * @param onEveryTimingTick
 * @returns
 */
const initialiseApplication = async (
	onEveryTimingTick: Function,
	autoConnect: boolean = false,
	startupSetup?: PresetSetup
) => {
	const roomInvitation = readRoomUrl(window.location.href)
	const hasWorkspaceBookmark = new URLSearchParams(window.location.hash.slice(1)).has(
		"harmoneasy-state"
	)

	// Get state from session and URL & update GUI
	const elementMain = document.querySelector("main")
	state = State.getInstance(elementMain)
	state.addEventListener((event?: string) => {
		const bookmark = state.asURI
		console.info(bookmark, "State Changed", { event, bookmark })
		// update onscreen QR code
	})
	state.loadFromLocation(DEFAULT_OPTIONS)
	const roomSetup = hasWorkspaceBookmark && state.get("io") ? undefined : roomInvitation.setup
	if (roomSetup) {
		state.set("tempo", roomSetup.bpm)
		state.set("swing", roomSetup.swing)
	}
	state.updateLocation()

	// Volume initialization (needed before UI setup)
	const volumeState = state.get("volume")
	const initialVolumePercent: number = volumeState ? parseFloat(volumeState as string) : 50
	const initialVolume: number = Math.max(0, Math.min(1, initialVolumePercent / 100))

	bus = new AudioBus(initialVolume)
	await bus.loaded

	timer = new AudioTimer(bus.audioContext, bus.hasAudioWorklets)
	await timer.loaded
	if (roomInvitation.setup) {
		timer.divisions = roomInvitation.setup.divisions
		timer.bars = roomInvitation.setup.bars
	}

	ui = await initialiseFrontEnd(bus, initialVolumePercent)

	// IO Chain Manager Setup -----
	ioManager = new IOChainManager({
		timer,
		outputMixer: bus.mixer,
		audioContext: bus.audioContext,
		autoConnect,
		externalDevices: { ui }
	})
	const audioRecording = createRecordingControls(
		bus.audioContext,
		bus.output,
		document,
		ioManager
	)

	const transportError = (error: unknown) => {
		console.error("Shared MIDI transport failed", error)
		ui.setPlaying(ioManager.transportRunning)
		ui.showError("Transport failed", error instanceof Error ? error.message : String(error))
	}
	ioManager.addEventListener("transportChanged", () => {
		ui.setPlaying(ioManager.transportRunning)
		netronomeLink?.transportChanged()
	})
	ioManager.transportHandler = (type) => {
		void ioManager.handleTransportCommand(type).catch(transportError)
	}
	ui.whenTransportRequestedRun((action) => {
		void ioManager
			.transport(action)
			.then(() => {
				if (action === "reset") {
					ui.resetClock()
				}
			})
			.catch(transportError)
	})

	// Check if there are saved IO configurations in state
	const savedIOState = state.get("io") as string | null
	if (roomSetup) {
		await ioManager.restoreWorkspace(roomSetup.workspace)
		state.set("io", ioManager.exportWorkspace())
	} else if (startupSetup) {
		await applySetup(ioManager, startupSetup)
		state.set("io", ioManager.exportWorkspace())
	} else if (savedIOState) {
		try {
			await ioManager.restoreWorkspace(savedIOState)
		} catch (error) {
			console.error("Failed to restore IO workspace:", error)
			await ioManager.createDefaultChain([], [ui])
		}
	} else {
		await ioManager.createDefaultChain([], [ui])
	}

	// Listen to every chain, including chains created after startup.
	ioManager.addEventListener(Commands.INPUT_EVENT, (event) => {
		const inputEvent = event as CustomEvent
		const { chain, command } = inputEvent.detail
		switch (command.type) {
			case Commands.TEMPO_TAP:
				ui.setTempo(timer.BPM)
				state.set("tempo", timer.BPM)
				break

			case Commands.TEMPO_INCREASE:
				ui.setTempo(timer.BPM)
				state.set("tempo", timer.BPM)
				break

			case Commands.TEMPO_DECREASE:
				ui.setTempo(timer.BPM)
				state.set("tempo", timer.BPM)
				break

			case Commands.PITCH_BEND:
				break

			case Commands.NOTE_ON:
				if (!chain.isQuantised && clockSource?.source === "internal") {
					timer.retrigger()
				}
				break

			case Commands.NOTE_OFF:
				if (!chain.isQuantised && clockSource?.source === "internal") {
					timer.retrigger()
				}
				break
		}
	})

	// Persist IO configuration when chains are updated
	const persistIOState = async () => {
		try {
			const ioExport = ioManager.exportWorkspace()
			state.set("io", ioExport)
			console.info("IO chain configuration saved to state")
		} catch (error) {
			console.error("Failed to save IO chain configuration:", error)
		}
	}

	ioManager.addEventListener("chainsUpdated", persistIOState)
	ioManager.addEventListener("chainActiveChanged", persistIOState)

	const { createGraph } = await import("./components/transformers-graph")
	createGraph("graph", ioManager)
	createMidiDevicesDialog()
	const midiControls = createMidiControlPanel(
		ioManager,
		state.get("midiControls") as string | undefined,
		(serialized) => state.set("midiControls", serialized)
	)
	void startKnownMidiInputs(ioManager, {
		onDeviceDisconnected: (loss) => showMidiDeviceDisconnected(ui, loss)
	}).catch((error) => console.warn("MIDI instrument discovery unavailable", error))

	// start the clock going
	timer.bpm = parseFloat(state.get("tempo") ?? 99)
	const savedSwing = Number(state.get("swing") ?? 0)
	timer.swing = Number.isFinite(savedSwing) ? savedSwing : 0
	ui.setSwing(timer.swing)
	timer.setCallback(onEveryTimingTick)
	const savedClockSource = state.get("clockSource")
	const savedClockDevice = state.get("clockMidiDevice")
	const incomingRoom = new URLSearchParams(window.location.hash.slice(1)).has("sync-bundle")
	const initialClockSource = incomingRoom
		? "shared"
		: roomInvitation.roomId || roomInvitation.setup
			? "internal"
			: isClockSource(savedClockSource)
				? savedClockSource
				: "internal"
	netronomeLink = createNetronomeLink(timer, () => ioManager.transportRunning, {
		manager: ioManager,
		roomId: roomInvitation.roomId,
		onConductorChanged: (conductor) => clockSource?.adoptRoomRole(conductor),
		onLeaveRequested: () => clockSource!.setSource("internal"),
		source: initialClockSource,
		autoStart: false,
		onSharedRequested: () => clockSource!.setSource("shared", false)
	})
	clockSource = createClockSourceControls(
		timer,
		ioManager,
		netronomeLink,
		(source, device) => {
			if (state.get("clockSource") !== source) {
				state.set("clockSource", source)
			}
			if (state.get("clockMidiDevice") !== device) {
				state.set("clockMidiDevice", device)
			}
		},
		() => ui.setPlaying(ioManager.transportRunning)
	)
	if (savedClockDevice != null && savedClockDevice !== "") {
		clockSource.midiDevice = String(savedClockDevice)
	}
	await clockSource.setSource(
		initialClockSource === "midi" && !clockMidiPorts(ioManager).length
			? "internal"
			: initialClockSource
	)
	await netronomeLink.initialize()
	ui.setPlaying(ioManager.transportRunning)
	musicTools = createMusicTools({
		manager: ioManager,
		context: bus.audioContext,
		master: bus.output,
		recorder,
		recording: audioRecording,
		midi: midiControls,
		getBpm: () => timer.BPM,
		getSwing: () => timer.swing,
		getNow: () => timer.now,
		beatsPerBar: () => timer.syncOptions.beatsPerBar ?? 4,
		canFollow: () => clockSource?.source === "internal" && !netronomeLink?.isFollower,
		setTempo: (bpm, swing) => {
			timer.BPM = bpm
			ui.setTempo(bpm)
			state.set("tempo", bpm)
			if (swing !== undefined) {
				timer.swing = swing
				ui.setSwing(swing)
				state.set("swing", swing)
			}
			netronomeLink?.tempoChanged()
		},
		persistMidi: (value) => state.set("midiControls", value)
	})

	// Update UI - this will check all the inputs according to our state
	state.updateFrontEnd()

	return state
}

/**
 * EVENT:
 * Bar TICK - 24 divisions per quarter note
 * received from Timer.
 * Handles scheduling commands and converting to events
 * @param values
 */
const onTick = (values: Record<string, any>) => {
	ioManager.recordTimerPerformance({
		drift: values.drift,
		lag: values.lag,
		timePassed: values.timePassed,
		expected: values.expected
	})

	const { divisionsElapsed, barsElapsed, bar, bars } = values

	const options = {
		grid: false
	}
	const now = timer.now
	if (clockSource?.source !== "internal" || netronomeLink?.isFollower) {
		ui.setTempo(Math.round(timer.BPM * 100) / 100)
	}
	if (clockSource?.source === "shared" || netronomeLink?.isFollower) {
		ui.setSwing(timer.swing)
	}
	if (clockSource?.source === "shared") {
		ui.setPlaying(ioManager.transportRunning)
	}
	// The timer wraps divisions once per quarter note; its bar counter counts beats.
	if (metronomeEnabled && divisionsElapsed === 0) {
		metronome?.playBeat(
			barsElapsed * bars + bar,
			timer.syncOptions.beatsPerBar ?? 4,
			values.scheduledContextTimeSeconds
		)
	}
	musicTools?.tick(barsElapsed * bars + bar + divisionsElapsed / timer.divisions)
	const capturedEvents = ioManager.updateTime(now, divisionsElapsed, options)
	if (capturedEvents.length) {
		recorder.addEvents(capturedEvents)
	}
	const ticksPerStep = timer.divisions / 4
	if (divisionsElapsed % ticksPerStep === 0) {
		ioManager.updateClock({
			step: (barsElapsed * bars + bar) * 4 + divisionsElapsed / ticksPerStep,
			bpm: timer.BPM,
			triggerAt: values.scheduledContextTimeSeconds ?? bus.audioContext.currentTime,
			stepDuration: 60 / timer.BPM / 4
		})
	}

	// Loop through all Chains managed by the IOManager and process events
	// ioManager.chains.forEach(chain => {

	//     // Always process the queue, with or without quantisation
	//     const activeCommands: IAudioCommand[] = chain.updateTimeForCommandQueue(now, divisionsElapsed, state)

	//     // Act upon any command that has now been executed
	//     if (activeCommands && activeCommands.length > 0) {
	//         const events: AudioEvent[] = IOChain.convertAudioCommandsToAudioEvents(activeCommands, now)
	//         const allEvents = recorder.addEvents(events)
	//         const triggers = chain.triggerAudioCommandsOnDevice(events)	// send to Outputs!
	//     }
	// })

	ui.updateClock(values, recorder.quantity)
}

/**
 * AudioContext is now available
 * This is the main initialisation routine
 * @param event
 */
// Background data load from any stored sessions
// If we have OPFS backend, initialize and load any previously recorded data
if (storage) {
	recorder.setStorage(storage)
	// Initialize storage and load existing commands on app startup
	storage
		.prepare("harmoneasy-commands.bin")
		.then(async (success) => {
			if (success) {
				// console.info('OPFS storage initialized, loading existing commands...')
				await recorder.loadDataFromStorage()
				// TODO: add timer starts at position from recorder.duration
				// TODO: SET AS LOADED
				// ui.setLoaded()
			} else {
				console.warn("Failed to initialize OPFS storage")
			}
		})
		.catch((error) => {
			console.error("Error initializing OPFS storage:", error)
		})
}

// Keep context browsing available until the explicit audio activation gesture.
const startDialog = document.querySelector<HTMLDialogElement>("#start-dialog")!
try {
	const invitation = readRoomUrl(window.location.href)
	if (invitation.setup) {
		document.getElementById("start-room-context")!.hidden = false
		document.getElementById("start-room-description")!.textContent = invitation.roomId
			? `This link includes the setup for room “${invitation.roomId}”. Start it, then complete QR/reply pairing to connect to other players.`
			: "This link includes a shared setup. Start it to create a new room with those instruments and chains."
	}
} catch (error) {
	const message = document.getElementById("start-error")!
	message.hidden = false
	message.textContent = error instanceof Error ? error.message : "Invalid room setup link."
}
createStartContexts(startDialog, (setup) =>
	startApplication(startDialog.querySelector<HTMLButtonElement>(".preset-apply-button")!, setup)
)
startDialog.removeAttribute("open")
startDialog.showModal()
startDialog.addEventListener("cancel", (event) => event.preventDefault())
async function startApplication(button: HTMLButtonElement, setup?: PresetSetup) {
	if (startDialog.inert) {
		return
	}
	startDialog.inert = true
	const buttons = startDialog.querySelectorAll<HTMLButtonElement>(
		'button[type="submit"], .preset-apply-button'
	)
	buttons.forEach((button) => {
		button.disabled = true
	})
	button.textContent = "Starting…"
	const errorMessage = startDialog.querySelector<HTMLElement>("#start-error")!
	errorMessage.hidden = true
	try {
		await initialiseApplication(onTick, false, setup)
		startDialog.close()
	} catch (error) {
		startDialog.inert = false
		console.error("Failed to start application:", error)
		errorMessage.textContent =
			error instanceof Error
				? error.message
				: "Could not start the application. Please reload and try again."
		errorMessage.hidden = false
		button.textContent = "Reload to try again"
		button.disabled = false
		button.onclick = (event) => {
			event.preventDefault()
			window.location.reload()
		}
	}
}

document.querySelector<HTMLFormElement>("#start-form")!.addEventListener("submit", (event) => {
	event.preventDefault()
	const button = event.submitter as HTMLButtonElement | null
	if (!button || button.disabled) {
		return
	}
	void startApplication(button, button.value === "empty" ? createEmptySetup() : undefined)
})