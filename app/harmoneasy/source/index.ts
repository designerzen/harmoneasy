import './assets/style/index.scss'

// Polyfills : https://github.com/webrtc/adapter
import adapter from 'webrtc-adapter'

import { DEFAULT_OPTIONS } from './options.ts'
import State from './libs/state.ts'

// Front End
import UI from './ui.ts'
import { createNetronomeLink } from './services/netronome-link'
import { createGraph } from './components/transformers-graph.tsx'
import SongVisualiser from 'audiobus/ui/song-visualiser.js'

// Import Data
import { importDawProjectFile } from 'audiobus/importers/import-dawproject'
import { importMusicXMLFile } from 'audiobus/importers/import-musicxml-import'
import { importMIDIFile } from 'audiobus/importers/import-midi-file'
import { importTrackerFile } from 'audiobus/importers/import-tracker-file'

// Integration
import { captureAudioToolTake, createAudioToolPanel } from 'audiotool'
import { createOpenDAWProjectFromAudioEventRecording } from 'opendaw'

// Export Data as a file to another service
import { createMIDIFileFromAudioEventRecording, saveBlobToLocalFileSystem } from 'audiobus/exporters/adapter-midi-file.ts'
import { createMEDFileFromAudioEventRecording, saveMEDToLocalFileSystem } from 'audiobus/exporters/adapter-med-file.ts'
import { createMIDIMarkdownFromAudioEventRecording, saveMarkdownToLocalFileSystem } from 'audiobus/exporters/adapter-midi-markdown.ts'
import { createMusicXMLFromAudioEventRecording, saveBlobToLocalFileSystem as saveMusicXMLBlobToLocalFileSystem } from 'audiobus/exporters/adapter-musicxml.ts'
import { renderVexFlowToContainer, createVexFlowHTMLFromAudioEventRecording, saveBlobToLocalFileSystem as saveVexFlowBlobToLocalFileSystem } from 'audiobus/exporters/adapter-vexflow.ts'
import { createDawProjectFromAudioEventRecording, saveDawProjectToLocalFileSystem } from 'audiobus/exporters/adapter-dawproject.ts'

// Timing
import { AudioTimer, TIMER_TYPES } from 'netronome'

// Audio
import AudioBus from './audio.ts'
import AudioEvent from 'audiobus/audio-event.ts'
import AudioEventRecorder from 'audiobus/audio-event-recorder.ts'
import IOChainManager from 'audiobus/io/IO-chain-manager.ts'
import OutputMetronome from 'audiobus/io/outputs/output-metronome.ts'
import * as Commands from 'audiobus/commands'

// IAudioInputs
import { ALL_KEYBOARD_NOTES } from 'audiobus/io/inputs/input-onscreen-keyboard.ts'

// Back End
import OPFSStorage, { hasOPFS } from 'audiobus/storage/opfs-storage.ts'

// Types
import type { IAudioCommand } from 'audiobus/audio-command-interface.ts'
import type InputAudioEvent from 'audiobus/io/events/input-audio-event.ts'


const storage = hasOPFS() ? new OPFSStorage() : null
const recorder: AudioEventRecorder = new AudioEventRecorder()
let timer: any = null
let bus: AudioBus
let state: State
let ui: UI
let songVisualiser: SongVisualiser | null = null
let ioManager: IOChainManager
let metronome: OutputMetronome | null = null
let metronomeEnabled = false
let netronomeLink: ReturnType<typeof createNetronomeLink> | undefined

/**
 * Universal import handler - routes to appropriate importer based on file type
 */
const importFile = async (file: File): Promise<{ commands: IAudioCommand[], noteCount: number }> => {
    const fileName = file.name.toLowerCase()

    // MIDI formats
    if (fileName.endsWith('.mid') || fileName.endsWith('.midi') || file.type.includes('midi')) {
        return importMIDIFile(file)
    }

    // MusicXML formats
    if (fileName.endsWith('.musicxml') || fileName.endsWith('.xml')) {
        return importMusicXMLFile(file)
    }

    // DawProject format
    if (fileName.endsWith('.dawproject')) {
        return importDawProjectFile(file)
    }

    // Tracker formats (MOD, XM, IT, S3M, etc.)
    const trackerExtensions = ['.mod', '.xm', '.it', '.s3m', '.669', '.far', '.stm', '.ult', '.mtm', '.dmf', '.ptm', '.okt', '.mptm', '.nst']
    if (trackerExtensions.some(ext => fileName.endsWith(ext))) {
        return importTrackerFile(file)
    }

    throw new Error(`Unsupported file type: ${file.type || fileName}. Supported formats: MIDI (.mid, .midi), MusicXML (.musicxml, .xml), DawProject (.dawproject), and Tracker formats (.mod, .xm, .it, .s3m, .669, .far, .stm, .ult, .mtm, .dmf, .ptm, .okt, .mptm, .nst)`)
}

/**
 * Create the UI and front end
 * TODO: Condense and optimise
 */
const initialiseFrontEnd = async (mixer: GainNode, initialVolumePercent: number = 100) => {

    // const keyboard:SVGKeyboard = new SVGKeyboard(ALL_KEYBOARD_NOTES, onNoteOn, onNoteOff)
    const frontEnd = new UI(ALL_KEYBOARD_NOTES)
    frontEnd.setTempo(timer.BPM)
    frontEnd.setVolume(initialVolumePercent)
    frontEnd.setMetronomeEnabled(metronomeEnabled)
    frontEnd.whenMetronomeRequestedRun(async () => {
        metronomeEnabled = !metronomeEnabled
        frontEnd.setMetronomeEnabled(metronomeEnabled)
        if (!metronomeEnabled) return
        try {
            await bus.audioContext.resume()
            metronome ??= new OutputMetronome(bus.audioContext)
            if (metronomeEnabled && !netronomeLink?.isFollower) await ioManager.transport('start')
        } catch (error) {
            metronomeEnabled = false
            frontEnd.setMetronomeEnabled(false)
            frontEnd.showError('Metronome unavailable', error instanceof Error ? error.message : String(error))
        }
    })
    // frontEnd.setUIKeyboard( keyboard )

    // Panic button  - kill all playing notes
    frontEnd.whenKillSwitchRequestedRun(async () => {
        console.info('[Kill Switch] All notes off requested')
        ioManager.chains.forEach(chain => {
            chain.allNotesOff()
        })
    })

    // Reset Recorder - kill all played notes
    frontEnd.whenResetRequestedRun(async () => {
        recorder.clear()
        timer.resetTimer()
        if (songVisualiser) {
            songVisualiser.reset()
        }
    })

    // FIXME: Random timbre button
    // ui.whenRandomTimbreRequestedRun(e => synthesizer.setRandomTimbre())

    frontEnd.whenTempoChangesRun((tempo: number) => {
        timer.BPM = tempo
        netronomeLink?.tempoChanged()
        state.set('tempo', tempo)
    })

    frontEnd.whenTempoUpRequestedRun(() => {
        const newTempo = Math.min(303, timer.BPM + 1)
        timer.BPM = newTempo
        netronomeLink?.tempoChanged()
        frontEnd.setTempo(newTempo)
        state.set('tempo', newTempo)
    })

    frontEnd.whenTempoDownRequestedRun(() => {
        const newTempo = Math.max(10, timer.BPM - 1)
        timer.BPM = newTempo
        netronomeLink?.tempoChanged()
        frontEnd.setTempo(newTempo)
        state.set('tempo', newTempo)
    })

    // Settings - Timer Type Selection
    frontEnd.whenSettingsRequestedRun(() => {
        const currentTimerType = state.get('timerType') || TIMER_TYPES.AUDIO_CONTEXT
        frontEnd.setTimerType(currentTimerType as string)
    })

    frontEnd.whenTimerTypeChangesRun(async (timerType: string) => {
        console.info('Timer type change requested:', timerType)
        try {
            const success = await timer.switchTimerType(timerType, bus.audioContext)
            if (success) {
                state.set('timerType', timerType)
                console.info('Timer type switched successfully to:', timerType)
            } else {
                console.warn('Failed to switch timer type to:', timerType)
                frontEnd.showError('Timer Switch Failed', `Could not switch to ${timerType}`)
            }
        } catch (error) {
            console.error('Error switching timer type:', error)
            frontEnd.showError('Timer Switch Error', error instanceof Error ? error.message : 'Unknown error')
        }
    })

    frontEnd.whenVolumeChangesRun((volume: number) => {
        mixer.gain.value = (volume / 100) * 0.5
        state.set('volume', volume)
    })

    frontEnd.whenVolumeUpRequestedRun(() => {
        const volumeElement = frontEnd.elementVolume as HTMLInputElement
        const currentVolume = parseInt(volumeElement.value, 10)
        const newVolume = Math.min(100, currentVolume + 5)
        volumeElement.value = String(newVolume)
        mixer.gain.value = (newVolume / 100) * 0.5
        if (frontEnd.elementVolumeOutput) frontEnd.elementVolumeOutput.textContent = String(newVolume)
        state.set('volume', newVolume)
    })

    frontEnd.whenVolumeDownRequestedRun(() => {
        const volumeElement = frontEnd.elementVolume as HTMLInputElement
        const currentVolume = parseInt(volumeElement.value, 10)
        const newVolume = Math.max(0, currentVolume - 5)
        volumeElement.value = String(newVolume)
        mixer.gain.value = (newVolume / 100) * 0.5
        if (frontEnd.elementVolumeOutput) frontEnd.elementVolumeOutput.textContent = String(newVolume)
        state.set('volume', newVolume)
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

    // Show packages information
    frontEnd.whenPackagesInfoRequestedRun(async () => {
        await frontEnd.showPackagesDialog()
    })

    // Import file from device and interpret
    frontEnd.whenFileImportRequestedRun(async (file: File) => {
        try {
            const fileType = file.name.split('.').pop()?.toUpperCase() || 'file'
            frontEnd.showExportOverlay(`Loading ${fileType} file...`)
            console.info(`Loading ${fileType} file from import:`, file.name)
            const { commands, noteCount } = await importFile(file)
            const activeChain = ioManager.activeChain
            if (activeChain) {
                activeChain.addCommandToFuture(commands, timer, true)
            }
            console.info(`${fileType} file loaded successfully:`, file.name, { commands, noteCount })
            // FIXME: This needs to alter depending on the type of file imported
            frontEnd.showInfoDialog("File Loaded", `Successfully loaded ${file.name} with ${noteCount} notes`)
        } catch (error) {
            console.error("Error loading file from import:", error)
            frontEnd.showError("Failed to load file", error instanceof Error ? error.message : String(error))
        } finally {
            frontEnd.hideExportOverlay()
        }
    })

    frontEnd.whenMIDIFileDroppedRun(async (file: File) => {
        try {
            const fileType = file.name.split('.').pop()?.toUpperCase() || 'file'
            frontEnd.showExportOverlay(`Found ${fileType} File`)
            console.info(`Loading ${fileType} file from drop:`, file.name)
            const { commands, noteCount } = await importFile(file)
            const activeChain = ioManager.activeChain
            if (activeChain) {
                activeChain.addCommandToFuture(commands, timer, true)
            }

        } catch (error) {
            console.error("Error loading file from drop:", error)
            frontEnd.showError("Failed to load file", error instanceof Error ? error.message : String(error))
        } finally {
            frontEnd.hideExportOverlay()
        }
    })

    // Exports --------------------------------------------------
    frontEnd.whenExportMenuRequestedRun(() => {
        console.info("Export menu opened")
    })
    let sentThrough = 0
    let lastSentEvent: IAudioCommand | undefined
    const audioTool = createAudioToolPanel(() => {
        // Reset the cursor when the recorder is cleared or replaced.
        if (sentThrough && recorder.events[sentThrough - 1] !== lastSentEvent) sentThrough = 0
        const end = recorder.events.length
        const lastEvent = recorder.events[end - 1]
        const take = captureAudioToolTake(recorder.events.slice(sentThrough, end), timer.BPM, timer.now, recorder.name)
        return { take, markSent: () => { sentThrough = end; lastSentEvent = lastEvent } }
    })
    frontEnd.whenAudioToolExportRequestedRun(() => audioTool.open())
    frontEnd.whenOpenDAWExportRequestedRun(async () => {
        const script = await createOpenDAWProjectFromAudioEventRecording(recorder, timer)
        console.info("Exporting Data to OpenDAW", { recorder, script })
        frontEnd.setExportOverlayText("Copy and paste this into openDAW script editor")
        frontEnd.showInfoDialog("Exporting Data to OpenDAW", script)
    })
    frontEnd.whenDawProjectExportRequestedRun(async () => {
        const blob = await createDawProjectFromAudioEventRecording(recorder, timer)
        const filename = (recorder.name ?? 'project').replace(/\s+/g, '_')
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

    frontEnd.addSongVisualser(recorder.exportData()).then(e => {
        console.log("Song visualiser added", e)
    })

    return frontEnd
}

/**
 * Connect the parts of our application and watches for
 * any events to alter behaviour
 * 
 * @param onEveryTimingTick 
 * @returns 
 */
const initialiseApplication = async (onEveryTimingTick: Function, autoConnect: boolean = false) => {

    // Get state from session and URL & update GUI
    const elementMain = document.querySelector('main')
    state = State.getInstance(elementMain)
    state.addEventListener((event: Event) => {
        const bookmark = state.asURI
        console.info(bookmark, "State Changed", { event, bookmark })
        // update onscreen QR code
    })
    state.loadFromLocation(DEFAULT_OPTIONS)
    state.updateLocation()

    // Volume initialization (needed before UI setup)
    const volumeState = state.get('volume')
    const initialVolumePercent: number = volumeState ? parseFloat(volumeState as string) : 50
    const initialVolume: number = Math.max(0, Math.min(1, initialVolumePercent / 100))

    bus = new AudioBus(initialVolume)
    await bus.loaded
    
    timer = new AudioTimer(bus.audioContext, bus.hasAudioWorklets)
    await timer.loaded
    
    ui = await initialiseFrontEnd(bus.mixer, initialVolumePercent)

    // IO Chain Manager Setup -----
    ioManager = new IOChainManager({
        timer,
        outputMixer: bus.mixer,
        audioContext: bus.audioContext,
        autoConnect,
        externalDevices: { ui }
    })

    const transportError = (error: unknown) => {
        console.error('Shared MIDI transport failed', error)
        ui.setPlaying(ioManager.transportRunning)
        ui.showError('Transport failed', error instanceof Error ? error.message : String(error))
    }
    ioManager.addEventListener('transportChanged', () => {
        ui.setPlaying(ioManager.transportRunning)
        netronomeLink?.transportChanged()
    })
    ioManager.transportHandler = type => { void ioManager.handleTransportCommand(type).catch(transportError) }
    ui.whenTransportRequestedRun(action => {
        void ioManager.transport(action).then(() => {
            if (action === 'reset') ui.resetClock()
        }).catch(transportError)
    })

    // Check if there are saved IO configurations in state
    const savedIOState = state.get('io') as string | null
    if (savedIOState) {
        try {
            await ioManager.restoreWorkspace(savedIOState)
        } catch (error) {
            console.error('Failed to restore IO workspace:', error)
            await ioManager.createDefaultChain([], [ui])
        }
    } else {
        await ioManager.createDefaultChain([], [ui])
    }

    // Listen to every chain, including chains created after startup.
    ioManager.addEventListener(Commands.INPUT_EVENT, (event: CustomEvent) => {
        const { chain, command } = event.detail
        switch (command.type) {
            case Commands.TEMPO_TAP:
                ui.setTempo(timer.BPM)
                state.set('tempo', timer.BPM)
                break

            case Commands.TEMPO_INCREASE:
                ui.setTempo(timer.BPM)
                state.set('tempo', timer.BPM)
                break

            case Commands.TEMPO_DECREASE:
                ui.setTempo(timer.BPM)
                state.set('tempo', timer.BPM)
                break

            case Commands.PITCH_BEND:
                break

            case Commands.NOTE_ON:
                if (!chain.isQuantised) {
                    timer.retrigger()
                }
                break

            case Commands.NOTE_OFF:
                if (!chain.isQuantised) {
                    timer.retrigger()
                }
                break
        }
    })

    // Persist IO configuration when chains are updated
    const persistIOState = async () => {
        try {
            const ioExport = ioManager.exportWorkspace()
            state.set('io', ioExport)
            state.updateLocation()
            console.info('IO chain configuration saved to state')
        } catch (error) {
            console.error('Failed to save IO chain configuration:', error)
        }
    }

    ioManager.addEventListener('chainsUpdated', persistIOState)
    ioManager.addEventListener('chainActiveChanged', persistIOState)

 
    createGraph('graph', ioManager)

    // start the clock going 
    timer.bpm = parseFloat(state.get('tempo') ?? 99)
    timer.setCallback(onEveryTimingTick)
    await ioManager.transport('start')
    ui.setPlaying(ioManager.transportRunning)

    netronomeLink = createNetronomeLink(timer, () => ioManager.transportRunning)

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

    const {
        divisionsElapsed, barsElapsed, timePassed,
        bar, bars,
        elapsed, expected, drift, level, intervals, lag
    } = values

	const options = {
		grid:false
	}
    const now = timer.now
	if (netronomeLink?.isFollower) ui.setTempo(Math.round(timer.BPM * 100) / 100)
	// The timer wraps divisions once per quarter note; its bar counter counts beats.
	if (metronomeEnabled && divisionsElapsed === 0) {
		metronome?.playBeat(barsElapsed * bars + bar, timer.syncOptions.beatsPerBar ?? 4, values.scheduledContextTimeSeconds)
	}
	const events = ioManager.updateTime(now, divisionsElapsed, options)
	const allEvents = recorder.addEvents(events)

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
const onAudioContextAvailable = async (event: Event) => await initialiseApplication(onTick)

// Background data load from any stored sessions
// If we have OPFS backend, initialize and load any previously recorded data
if (storage) {
    recorder.setStorage(storage)
    // Initialize storage and load existing commands on app startup
    storage.prepare('harmoneasy-commands.bin').then(success => {
        if (success) {
            // console.info('OPFS storage initialized, loading existing commands...')
            recorder.loadDataFromStorage()
            // TODO: add timer starts at position from recorder.duration
            // TODO: SET AS LOADED
            // ui.setLoaded()
        } else {
            console.warn('Failed to initialize OPFS storage')
        }
    }).catch(error => {
        console.error('Error initializing OPFS storage:', error)
    })
}

// Wait for user to initiate an action so that we can use AudioContext
document.addEventListener("mousedown", onAudioContextAvailable, { once: true })
