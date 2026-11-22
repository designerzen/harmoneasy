import "./assets/style/index.scss"
import "./assets/style/harmony.scss"

// Polyfills : https://github.com/webrtc/adapter
import "webrtc-adapter"

import { DEFAULT_OPTIONS } from "./options.ts"
import State from "./libs/state.ts"

// Front End
import UI from "./ui.ts"
import { createAboutDialog } from "./services/about-dialog"
import { createCommandPalette } from "./services/command-palette"
import { registerInterfaceCommands } from "./services/interface-commands"
import { registerApplicationCommands } from "./services/application-commands"
import { createRemoteControlButton } from "./services/remote-control-window"
import { createThemeControls } from "./services/theme"
import {
	applySensoryPreset,
	createAccessibilityControls,
	extractAccessibilityPreferences,
	type SensoryPresetId
} from "./services/accessibility"
import { createCalibrationDialog } from "./services/access-calibration-dialog"
import { readAccessProfileFromUrl, type AccessProfile } from "./services/access-profile"
import { createFocusStage } from "./services/focus-stage"
import { installMotorStabilizer } from "./services/motor-stabilizer"
import { createEmptySetup, createStartContexts } from "./services/start-contexts"
import { nextPaint, setButtonBusy, showLoadingVeil } from "./libs/loader"
import { createSetupWizard } from "./services/setup-wizard"
import { applySetup } from "./components/graph/saved-presets"
import type { PresetSetup } from "audiobus/io/preset-library"
import { createNetronomeLink } from "./services/netronome-link"
import { readRoomUrl } from "./services/room-url"
import { loadPresetPage, presetWorkspace } from "./services/preset-page"
import { PLAY_REDIRECT_KEY, playRoute, playUrl } from "./services/play-page"
import { restorePartsUrl } from "./services/parts-url"
import { createMidiControlPanel } from "./services/midi-control-panel"
import { startKnownMidiInputs } from "audiobus/hardware/midi-devices/known-midi-inputs"
import { showMidiDeviceDisconnected } from "./services/midi-device-errors"
import { chooseChainsForMidiDevice } from "./services/midi-device-connected-dialog"
import { createMidiDevicesDialog } from "./services/midi-devices-dialog"
import { createMixer } from "./services/mixer"
import { configureAudiobus } from "./audiobus-host"
import { createRecordingControls } from "./services/recording-dialog"
import { createMusicalFeatureControls } from "./services/musical-feature-controls"
import {
	EVENT_CANCEL,
	EVENT_CHAIN_ACTIVE_CHANGED,
	EVENT_CHAINS_UPDATED,
	EVENT_CLICK,
	EVENT_HARMONY_CHANGED,
	EVENT_HARMONY_SETTINGS_CHANGED,
	EVENT_PAGE_HIDE,
	EVENT_SUBMIT,
	EVENT_TRANSPORT_CHANGED
} from "audiobus/events/event-constants"
import { createClockSourceControls } from "./services/clock-source-controls"
import { createMediaImporter } from "./services/media-import"
import { wireExportControls } from "./services/export-wiring"
import {
	parseInitialTempo,
	parseInitialVolumePercent,
	wireFrontEndControls
} from "./services/transport-wiring"
import {
	isClockSource,
	clockDvsInputs,
	clockMidiPorts,
	type ClockSourceController
} from "./services/clock-source"

// Timing
import { AudioTimer } from "netronome"

// Audio
import AudioBus from "./audio.ts"
import "audiobus/models/audio-event.ts"
import AudioEventRecorder from "audiobus/events/audio-event-recorder.ts"
import IOChainManager from "audiobus/io/IO-chain-manager.ts"
import OutputMetronome from "audiobus/io/outputs/output-metronome.ts"
import * as Commands from "audiobus/commands/commands"

// IAudioInputs
import { ALL_KEYBOARD_NOTES } from "audiobus/io/inputs/input-onscreen-keyboard.ts"

// Back End
import OPFSStorage, { hasOPFS } from "audiobus/storage/opfs-storage.ts"

configureAudiobus()

createThemeControls(document)
let pendingSensoryPreset: SensoryPresetId | undefined
const accessibilityControls = createAccessibilityControls(document, {
	onSensoryPreset: async (preset) => {
		if (ioManager) {
			const result = await applySensoryPreset(ioManager, preset, accessibilityControls)
			return result.summary
		}
		pendingSensoryPreset = preset
		return preset === "low-vision"
			? "Low-vision preset applied. Speech & description outputs will attach when you start."
			: "Deaf & tactile preset applied. Notation & haptic outputs will attach when you start."
	}
})
let pendingAccessProfile: AccessProfile | undefined = readAccessProfileFromUrl(window.location.href)
if (pendingAccessProfile) {
	accessibilityControls.update(extractAccessibilityPreferences(pendingAccessProfile))
}
createAboutDialog(document)
createCommandPalette(document)
registerInterfaceCommands(document)
createRemoteControlButton(document)

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
let musicalFeatureControls: ReturnType<typeof createMusicalFeatureControls> | undefined
let focusStage: ReturnType<typeof createFocusStage> | undefined

/**
 * Create the UI and front end.
 */
const initialiseFrontEnd = async (audioBus: AudioBus, initialVolumePercent: number = 100) => {
	const frontEnd = new UI(ALL_KEYBOARD_NOTES)
	frontEnd.setTempo(timer.BPM)
	frontEnd.setSwing(timer.swing)
	frontEnd.setVolume(initialVolumePercent)
	frontEnd.setMetronomeEnabled(metronomeEnabled)

	wireFrontEndControls({
		frontEnd,
		audioBus,
		timer,
		state,
		recorder,
		getIOManager: () => ioManager,
		getNetronomeLink: () => netronomeLink,
		onMetronomeToggle: async () => {
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
		}
	})

	wireExportControls({
		frontEnd,
		audioBus,
		recorder,
		getTimer: () => timer,
		getIOManager: () => ioManager
	})

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
				importMedia ??= createMediaImporter(ioManager)
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
	const hasSavedWorkspace = hasWorkspaceBookmark && Boolean(state.get("io"))
	const pageResult = await presetPageResult
	if (pageResult.error && !startupSetup && !roomSetup && !hasSavedWorkspace) {
		throw pageResult.error
	}
	const pageSetup =
		!startupSetup && !roomSetup && !hasSavedWorkspace ? pageResult.preset : undefined
	const presetClock = startupSetup?.clock ?? pageSetup?.clock
	if (presetClock) {
		state.set("tempo", presetClock.bpm)
		state.set("swing", presetClock.swing)
		state.set("divisions", presetClock.divisions)
		state.set("bars", presetClock.bars)
	}
	if (pageSetup) {
		state.set("midiControls", JSON.stringify(pageSetup.midiControls))
	}
	if (roomSetup) {
		state.set("tempo", roomSetup.bpm)
		state.set("swing", roomSetup.swing)
	}
	state.updateLocation()

	// Volume initialization (needed before UI setup)
	const initialVolumePercent: number = parseInitialVolumePercent(state.get("volume"), 50)
	const initialVolume: number = Math.max(0, Math.min(1, initialVolumePercent / 100))

	bus = new AudioBus(initialVolume)
	await bus.loaded

	timer = new AudioTimer(bus.audioContext, bus.hasAudioWorklets)
	await timer.loaded
	if (roomSetup) {
		timer.divisions = roomSetup.divisions
		timer.bars = roomSetup.bars
	} else {
		timer.divisions = Number(state.get("divisions") ?? timer.divisions)
		timer.bars = Number(state.get("bars") ?? timer.bars)
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
	createMixer(ioManager, bus.output)
	installMotorStabilizer(ioManager, () => {
		const prefs = accessibilityControls.getPreferences()
		return {
			enabled: prefs.stabilizerEnabled,
			debounceMs: prefs.debounceMs,
			holdThresholdMs: prefs.holdThresholdMs,
			minDurationMs: prefs.minDurationMs
		}
	})
	focusStage = createFocusStage({
		manager: ioManager,
		doc: document,
		accessibility: accessibilityControls,
		audioContext: bus.audioContext,
		outputNode: bus.output,
		getNow: () => timer.now,
		onCalibrate: () => calibrationDialog.open()
	})
	if (pendingAccessProfile) {
		focusStage.applyProfile(pendingAccessProfile)
	}
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
	ioManager.addEventListener(EVENT_TRANSPORT_CHANGED, () => {
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
	} else if (pageSetup) {
		await ioManager.restoreWorkspace(presetWorkspace(pageSetup))
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

	ioManager.addEventListener(EVENT_CHAINS_UPDATED, persistIOState)
	ioManager.addEventListener(EVENT_HARMONY_CHANGED, persistIOState)
	ioManager.addEventListener(EVENT_HARMONY_SETTINGS_CHANGED, persistIOState)
	ioManager.addEventListener(EVENT_CHAIN_ACTIVE_CHANGED, persistIOState)

	const { createGraph } = await import("./components/transformers-graph")
	createMidiDevicesDialog(document, (port) =>
		ioManager.chains
			.map((chain, index) => ({
				chain,
				name: chain.options.name ?? `Chain ${index + 1}`
			}))
			.filter(({ chain }) =>
				(port.type === "input" ? chain.inputs : chain.outputs).some((node: any) => {
					const options = node.options ?? {}
					const devices = port.type === "input" ? node.inputDevices : node.outputDevices
					if (!Array.isArray(devices)) {
						return false
					}
					// Outputs list every port, so only an explicit choice or "all" counts
					const everyPort =
						port.type === "input" ||
						options.sendToAllDevices === true ||
						options.selectedDevice === ""
					return (
						String(options.selectedDevice) === port.id ||
						(everyPort &&
							devices.some((device: { id: string }) => device.id === port.id))
					)
				})
			)
			.map(({ name }) => name)
	)
	const midiControls = createMidiControlPanel(
		ioManager,
		state.get("midiControls") as string | undefined,
		(serialized) => state.set("midiControls", serialized)
	)
	void startKnownMidiInputs(ioManager, {
		onDeviceDisconnected: (loss) => showMidiDeviceDisconnected(ui, loss),
		onDeviceConnected: (device) => chooseChainsForMidiDevice(ioManager, device)
	}).catch((error) => console.warn("MIDI instrument discovery unavailable", error))

	// start the clock going
	timer.BPM = parseInitialTempo(state.get("tempo"), 99)
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
		getAccessProfile: () => ({
			...accessibilityControls.getPreferences(),
			...focusStage?.getStageConfig()
		}),
		onConductorChanged: (conductor) => clockSource?.adoptRoomRole(conductor),
		onLeaveRequested: () => clockSource?.setSource("internal") ?? Promise.resolve(),
		source: initialClockSource,
		autoStart: false,
		onSharedRequested: () => clockSource?.setSource("shared", false) ?? Promise.resolve()
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
		() => ui.setPlaying(ioManager.transportRunning),
		async (enabled) => {
			await musicalFeatureControls?.followMicrophone(enabled)
		},
		(bpm) => state.set("dvsReferenceBpm", bpm),
		(enabled) => state.set("dvsRestartOnStart", enabled)
	)
	const savedDvsRestart = state.get("dvsRestartOnStart")
	clockSource.dvsRestartOnStart = savedDvsRestart === true || savedDvsRestart === "true"
	const savedDvsBpm = Number(state.get("dvsReferenceBpm"))
	if (Number.isFinite(savedDvsBpm) && savedDvsBpm > 0) {
		clockSource.setDvsReferenceBPM(savedDvsBpm)
	}
	if (savedClockDevice != null && savedClockDevice !== "") {
		clockSource.midiDevice = String(savedClockDevice)
	}
	await clockSource.setSource(
		(initialClockSource === "midi" && !clockMidiPorts(ioManager).length) ||
			(initialClockSource === "dvs" && !clockDvsInputs(ioManager).length)
			? "internal"
			: initialClockSource
	)
	await netronomeLink.initialize()
	const removeApplicationCommands = registerApplicationCommands({
		getTransport: () => ({
			bpm: timer.BPM,
			running: ioManager.transportRunning,
			clockSource: clockSource?.source ?? "internal"
		}),
		canSetTempo: () => clockSource?.source === "internal" && !netronomeLink?.isFollower,
		setTempo: (bpm) => {
			timer.BPM = bpm
			ui.setTempo(bpm)
			state.set("tempo", bpm)
			netronomeLink?.tempoChanged()
		},
		transport: async (action) => {
			await ioManager.transport(action)
			ui.setPlaying(ioManager.transportRunning)
		},
		panic: () => {
			netronomeLink?.silence()
			ioManager.chains.forEach((chain) => chain.allNotesOff())
		},
		presets: async () => {
			const { PUBLISHED_PRESETS } = await import("./services/preset-files")
			return PUBLISHED_PRESETS.map(({ preset, page }) => ({
				id: preset.id,
				name: preset.name,
				category: preset.category,
				description: preset.useCase,
				// Loading a preset without a protocol Input ends remote control.
				remote: page.workspace.devices.some(
					(device: { direction?: string; definition?: { type?: string } }) =>
						device.direction === "input" && device.definition?.type === "protocol"
				)
			}))
		},
		loadPreset: async (id) => {
			const { publishedPreset } = await import("./services/preset-files")
			const entry = publishedPreset(id)
			if (!entry) {
				return
			}
			if (clockSource?.source === "internal" && !netronomeLink?.isFollower) {
				timer.BPM = entry.page.clock.bpm
				ui.setTempo(entry.page.clock.bpm)
				state.set("tempo", entry.page.clock.bpm)
				netronomeLink?.tempoChanged()
			}
			await ioManager.restoreWorkspace(presetWorkspace(entry.page))
			state.set("io", ioManager.exportWorkspace())
		}
	})
	window.addEventListener(EVENT_PAGE_HIDE, (event) => {
		if (!event.persisted) {
			removeApplicationCommands()
		}
	})
	ui.setPlaying(ioManager.transportRunning)
	musicalFeatureControls = createMusicalFeatureControls({
		manager: ioManager,
		context: bus.audioContext,
		master: bus.output,
		recorder,
		recording: audioRecording,
		midi: midiControls,
		getBpm: () => timer.BPM,
		getSwing: () => timer.swing,
		getClock: () => ({ divisions: timer.divisions, bars: timer.bars }),
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

	createGraph("graph", ioManager, Boolean(pageSetup || startupSetup))

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
	if (divisionsElapsed === 0) {
		const beatIndex = barsElapsed * bars + bar
		const beatsPerBar = timer.syncOptions.beatsPerBar ?? 4
		focusStage?.pulseBeat(beatIndex, beatsPerBar)
		if (metronomeEnabled) {
			metronome?.playBeat(beatIndex, beatsPerBar, values.scheduledContextTimeSeconds)
		}
	}
	musicalFeatureControls?.tick(barsElapsed * bars + bar + divisionsElapsed / timer.divisions)
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
const startContexts = createStartContexts(startDialog, (setup) =>
	startApplication(startDialog.querySelector<HTMLButtonElement>(".preset-apply-button")!, setup)
)
try {
	const restored = restorePartsUrl(window.location.href, import.meta.env.BASE_URL)
	if (restored.href !== window.location.href) {
		history.replaceState(history.state, "", restored)
	}
	const play = playRoute(window.location.href, import.meta.env.BASE_URL)
	if (play && new URLSearchParams(window.location.search).has(PLAY_REDIRECT_KEY)) {
		const url = playUrl(play, import.meta.env.BASE_URL, window.location.origin)
		const options = new URLSearchParams(window.location.search)
		options.delete(PLAY_REDIRECT_KEY)
		url.search = options.toString()
		url.hash = window.location.hash
		history.replaceState(history.state, "", url)
	}
} catch {
	// loadPresetPage reports invalid play links in the start dialog.
}
// Fetch before the audio activation gesture, and retain failures for the start dialog.
const presetPageResult = loadPresetPage(window.location.href, import.meta.env.BASE_URL)
	.then((preset) => {
		if (preset) {
			startContexts.setPresetPage(preset)
		}
		return { preset, error: undefined }
	})
	.catch((error: unknown) => {
		const message = document.getElementById("start-error")!
		message.hidden = false
		message.textContent = error instanceof Error ? error.message : "Could not load preset."
		return { preset: undefined, error }
	})
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
const calibrationDialog = createCalibrationDialog({
	doc: document,
	accessibility: accessibilityControls,
	getStageConfig: () => focusStage?.getStageConfig() ?? {},
	baseUrl: import.meta.env.BASE_URL,
	onApply: (profile, sensoryPreset) => {
		pendingAccessProfile = profile
		accessibilityControls.update(extractAccessibilityPreferences(profile))
		if (ioManager && sensoryPreset !== "none") {
			void applySensoryPreset(ioManager, sensoryPreset, accessibilityControls)
		} else if (sensoryPreset !== "none") {
			pendingSensoryPreset = sensoryPreset
		}
		if (focusStage) {
			focusStage.applyProfile(profile)
			if (profile.openFocusStage) {
				focusStage.open()
			}
		}
	}
})
document.getElementById("a11y-calibrate")?.addEventListener(EVENT_CLICK, () => {
	calibrationDialog.open()
})
startDialog.removeAttribute("open")
const wizardButton = startDialog.querySelector<HTMLButtonElement>("#start-wizard")!
createSetupWizard(
	wizardButton,
	(setup) => {
		void startApplication(wizardButton, setup)
	},
	{
		onCalibrate: () => calibrationDialog.open()
	}
)
startDialog.showModal()
startDialog.addEventListener(EVENT_CANCEL, (event) => event.preventDefault())
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
	setButtonBusy(button, true)
	const errorMessage = startDialog.querySelector<HTMLElement>("#start-error")!
	errorMessage.hidden = true
	// Paint the veil before initialisation blocks the main thread, and keep it
	// until the graph has rendered and the application responds to input.
	const veil = await showLoadingVeil("Starting Harmoneasy…")
	try {
		await initialiseApplication(onTick, false, setup)
		startDialog.close()
		await nextPaint()
		veil.hide()
		if (pendingSensoryPreset && ioManager) {
			const presetToApply = pendingSensoryPreset
			pendingSensoryPreset = undefined
			void applySensoryPreset(ioManager, presetToApply, accessibilityControls)
		}
		if (pendingAccessProfile?.openFocusStage && focusStage) {
			focusStage.applyProfile(pendingAccessProfile)
			focusStage.open()
		}
	} catch (error) {
		veil.hide()
		setButtonBusy(button, false)
		startDialog.inert = false
		if (!startDialog.open) {
			startDialog.showModal()
		}
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

document.querySelector<HTMLFormElement>("#start-form")!.addEventListener(EVENT_SUBMIT, (event) => {
	event.preventDefault()
	const button = event.submitter as HTMLButtonElement | null
	if (!button || button.disabled) {
		return
	}
	void startApplication(button, button.value === "empty" ? createEmptySetup() : undefined)
})