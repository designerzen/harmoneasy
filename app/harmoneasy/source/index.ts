import './assets/style/index.scss'

// Polyfills : https://github.com/webrtc/adapter
import adapter from 'webrtc-adapter'

import { DEFAULT_OPTIONS } from './options.ts'
import State from './libs/state.ts'

import { createAudioToolProjectFromAudioEventRecording } from 'audiotool'
import { createMIDIFileFromAudioEventRecording, saveBlobToLocalFileSystem } from 'audiobus/exporters/adapter-midi-file.ts'
import { createMEDFileFromAudioEventRecording, saveMEDToLocalFileSystem } from 'audiobus/exporters/adapter-med-file.ts'
import { createMIDIMarkdownFromAudioEventRecording, saveMarkdownToLocalFileSystem } from 'audiobus/exporters/adapter-midi-markdown.ts'
import { createMusicXMLFromAudioEventRecording, saveBlobToLocalFileSystem as saveMusicXMLBlobToLocalFileSystem } from 'audiobus/exporters/adapter-musicxml.ts'
import { renderVexFlowToContainer, createVexFlowHTMLFromAudioEventRecording, saveBlobToLocalFileSystem as saveVexFlowBlobToLocalFileSystem } from 'audiobus/exporters/adapter-vexflow.ts'
import { createOpenDAWProjectFromAudioEventRecording } from 'opendaw'
import { createDawProjectFromAudioEventRecording, saveDawProjectToLocalFileSystem } from 'audiobus/exporters/adapter-dawproject.ts'

import { importDawProjectFile } from 'audiobus/importers/import-dawproject.ts'
import { importMusicXMLFile } from 'audiobus/importers/import-musicxml-import.ts'
import { importMIDIFile } from 'audiobus/importers/import-midi-file.ts'
import { importTrackerFile } from 'audiobus/importers/import-tracker-file.ts'

// Front End
import UI from './ui.ts'
import { createGraph } from './components/transformers-graph.tsx'
import SongVisualiser from 'audiobus/ui/song-visualiser.js'

// Back End
import OPFSStorage, { hasOPFS } from 'audiobus/storage/opfs-storage.ts'

// Audio
import AudioBus from './audio.ts'

import AudioEvent from 'audiobus/audio-event.ts'
import AudioTimer from 'audiobus/timing/timer.ts'
import AudioEventRecorder from 'audiobus/audio-event-recorder.ts'
import * as Commands from 'audiobus/commands'

// IAudioInputs
import IOChain from 'audiobus/io/IO-chain.ts'
import { createInputById, getAvailableInputFactories } from 'audiobus/io/input-factory.ts'
import InputOnScreenKeyboard, { ALL_KEYBOARD_NOTES, ONSCREEN_KEYBOARD_INPUT_ID } from 'audiobus/io/inputs/input-onscreen-keyboard.ts'
import * as INPUT_TYPES from 'audiobus/io/inputs/input-types.ts'
import * as OUTPUT_TYPES from 'audiobus/io/outputs/output-types.ts'
import { createOutputById, getAvailableOutputFactories } from 'audiobus/io/output-factory.ts'

// IAudioIn/Outputs 
import SynthOscillator from 'audiobus/instruments/oscillators/synth-oscillator.ts'
import PolySynth from 'audiobus/instruments/poly-synth.ts'
import OutputOnScreenKeyboard from 'audiobus/io/outputs/output-onscreen-keyboard.ts'

import type { IAudioCommand } from 'audiobus/audio-command-interface.ts'
import type { IAudioOutput } from 'audiobus/io/outputs/output-interface.ts'
import type { IAudioInput } from 'audiobus/io/inputs/input-interface.ts'
import type InputAudioEvent from 'audiobus/io/events/input-audio-event.ts'

const storage = hasOPFS() ? new OPFSStorage() : null
const recorder: AudioEventRecorder = new AudioEventRecorder()
const chains: IOChain[] = []
let timer: AudioTimer = null
let bus: AudioBus
let state: State
let ui: UI
let songVisualiser: SongVisualiser | null = null

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
 * Create a IOChain that connects a series of inputs
 * through a transformerManager into an OutputManager
 * @returns 
 */
const createInputOutputChain = async (outputMixer:GainNode, inputDevices:IAudioInput[]=[], outputDevices:IAudioOutput[]=[], autoConnect:boolean=false ) => {
	
	const chain = new IOChain( timer )

	const options = {
		now: () => timer.now
	}

	// Create our desired inputs
	const inputKeyboard = await createInputById(INPUT_TYPES.KEYBOARD, options)
	// FIXME: make MIDI and Gamepad devices work independently as Inputs
	// by ensuring that the connection and disconnection events are monitored
	const inputGamePad = await createInputById(INPUT_TYPES.GAMEPAD, options)
	const inputSVGKeyboard = new InputOnScreenKeyboard(options)

	const inputs:IAudioInput[] = [ inputKeyboard, inputGamePad, inputSVGKeyboard, ...inputDevices]

	// These 3 inputs require special setup - require user click
	if (navigator.mediaDevices && navigator.mediaDevices?.getUserMedia){
		const inputMicrophone = await createInputById(INPUT_TYPES.MICROPHONE_FORMANT, options)
		if (autoConnect)
		{
			try{
				await inputMicrophone.connect()
			}catch(error){
				console.error('Microphone Formant input failed to connect', error)
			}			
		}
		inputs.push(inputMicrophone)
	}
	
	// check to see if web bluetooth is available in this browser
	if (navigator.bluetooth) {
		const inputBluetooth = await createInputById(INPUT_TYPES.BLE_MIDI, options)
		if (autoConnect)
		{
			try{
				await inputBluetooth.connect()
			}catch(error){
				console.error('Bluetooth MIDI input failed to connect', error)
			}			
		}
		inputs.push( inputBluetooth )
	}
	
	// Connect to WebMIDI using options specified
	// check to see if webMIDI is available in this browser
	if (navigator.requestMIDIAccess) {
		const inputWebMIDIDevice = await createInputById(INPUT_TYPES.WEBMIDI, options)
		if (autoConnect)
		{
			try{
				await inputWebMIDIDevice.connect()
			}catch(error){
				console.error('WebMIDI input failed to connect', error)
			}			
		}
		inputs.push(inputWebMIDIDevice)
	}
	
	// Outputs ------------------------------------------------
	const outputOnscreenKeyboard = new OutputOnScreenKeyboard(inputSVGKeyboard.keyboard)
	const outputs:IAudioOutput[] = [ outputOnscreenKeyboard, ...outputDevices ]
	
	// PolySynth - polyphonic synthesizer
	const musicalOutput = new PolySynth(bus.audioContext)
	musicalOutput.output.connect(outputMixer)
	outputs.push(musicalOutput)

	// Notation output - displays notes on a staff
	const outputNotation = await createOutputById(OUTPUT_TYPES.NOTATION)
	outputs.push(outputNotation)

	// Spectrum analyser - FFT visualization
	const outputSpectrumAnalyser = await createOutputById(OUTPUT_TYPES.SPECTRUM_ANALYSER, { mixer: outputMixer })
	outputs.push(outputSpectrumAnalyser)

	// Pink Trombone - vocal synthesis
	const outputPinkTrombone = await createOutputById(OUTPUT_TYPES.PINK_TROMBONE)
	outputs.push(outputPinkTrombone)

	// Speech synthesis - sing note names
	if (typeof window !== "undefined" && !!window.speechSynthesis) {
		const outputSpeech = await createOutputById(OUTPUT_TYPES.SPEECH_SYNTHESIS)
		outputs.push(outputSpeech)
	}

	// Vibrator - haptic feedback
	if (typeof navigator !== "undefined" && (!!navigator?.vibrate || !!navigator?.webkitVibrate || !!navigator?.mozVibrate)) {
		const outputVibrator = await createOutputById(OUTPUT_TYPES.VIBRATOR)
		outputs.push(outputVibrator)
	}

	// WebMIDI output
	if (navigator.requestMIDIAccess) {
		const outputWebMIDIDevice = await createOutputById(OUTPUT_TYPES.WEBMIDI)
		outputs.push(outputWebMIDIDevice)
	}

	// Bluetooth MIDI output
	if (navigator.bluetooth) {
		const outputBluetooth = await createOutputById(OUTPUT_TYPES.BLE_MIDI)
		outputs.push(outputBluetooth)
	}

	// Console output - DEV mode only
	if (import.meta.env.DEV) {
		const outputConsole = await createOutputById(OUTPUT_TYPES.CONSOLE)
		outputs.push(outputConsole)
	}

	chain.addInputs(inputs)
	chain.addOutputs(outputs)
	return chain
}

/**
 * Create the UI and front end
 * TODO: Condense and optimise
 */
const initialiseFrontEnd = async (mixer: GainNode, initialVolumePercent: number=100 ) => {

	// const keyboard:SVGKeyboard = new SVGKeyboard(ALL_KEYBOARD_NOTES, onNoteOn, onNoteOff)
    const frontEnd = new UI( ALL_KEYBOARD_NOTES )
    frontEnd.setTempo( timer.BPM )
	frontEnd.setVolume( initialVolumePercent )
	// frontEnd.setUIKeyboard( keyboard )

	// Panic button  - kill all playing notes
    frontEnd.whenKillSwitchRequestedRun(async () => {
        console.info('[Kill Switch] All notes off requested')
		chains.forEach( chain => {
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
        state.set('tempo', tempo)
    })

	frontEnd.whenTempoUpRequestedRun(() => {
		const newTempo = Math.min(303, timer.BPM + 1)
		timer.BPM = newTempo
		frontEnd.setTempo(newTempo)
		state.set('tempo', newTempo)
	})

	frontEnd.whenTempoDownRequestedRun(() => {
		const newTempo = Math.max(10, timer.BPM - 1)
		timer.BPM = newTempo
		frontEnd.setTempo(newTempo)
		state.set('tempo', newTempo)
	})

    frontEnd.whenVolumeChangesRun((volume: number) =>{
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
        // Create a modal container for the score
        const modalContainer = document.createElement('div')
        modalContainer.style.cssText = 'width: 100%; height: 100%; overflow-y: auto; padding: 20px;'

        try {
            renderVexFlowToContainer(modalContainer, recorder, timer)

            // Create download button
            const downloadBtn = document.createElement('button')
            downloadBtn.textContent = 'Download as HTML'
            downloadBtn.style.cssText = 'margin-top: 20px; padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;'
            downloadBtn.onclick = async () => {
                const blob = await createVexFlowHTMLFromAudioEventRecording(recorder, timer)
                saveVexFlowBlobToLocalFileSystem(blob, recorder.name)
            }

            modalContainer.appendChild(downloadBtn)

            // Show in info dialog - pass the DOM node directly to preserve event listeners
            const infoMessage = document.querySelector("#info-message")
            if (infoMessage) {
                infoMessage.innerHTML = ''
                infoMessage.appendChild(modalContainer)
                document.querySelector("#info-dialog h5").textContent = "Musical Score"
                document.getElementById("info-dialog").hidden = false
                document.getElementById("info-dialog").showModal()
            } else {
                frontEnd.showInfoDialog("Musical Score", modalContainer.innerHTML)
            }
            console.info("Exporting Data to VexFlow", { recorder })
        } catch (error) {
            console.error("Error rendering VexFlow score", error)
            frontEnd.showInfoDialog("Error", "Failed to render VexFlow score. Check console for details.")
        }
    })

	// Import file from device and interpret
	frontEnd.whenFileImportRequestedRun(async (file: File) => {
        try {
            const fileType = file.name.split('.').pop()?.toUpperCase() || 'file'
            frontEnd.showExportOverlay(`Loading ${fileType} file...`)
            console.info(`Loading ${fileType} file from import:`, file.name)
            const { commands, noteCount } = await importFile(file)
            chains[0].addCommandToFuture(commands, timer, true)
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
			chains[0].addCommandToFuture(commands, timer, true)
           
        } catch (error) {
            console.error("Error loading file from drop:", error)
            frontEnd.showError("Failed to load file", error instanceof Error ? error.message : String(error))
       	} finally{
			frontEnd.hideExportOverlay()
		}
    })

	// Exports --------------------------------------------------
    frontEnd.whenExportMenuRequestedRun(() => {
        console.info("Export menu opened")
    })
	frontEnd.whenAudioToolExportRequestedRun(async () => {
        const output = await createAudioToolProjectFromAudioEventRecording(recorder, timer)
        console.info("Exporting Data to AudioTool", { recorder, output })
        frontEnd.setExportOverlayText("Open this project in AudioTool")
        frontEnd.showInfoDialog("Open the file in AudioTool", "audiotool.com")
    })
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

    frontEnd.addSongVisualser(recorder.exportData()).then( e=>{
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
const initialiseApplication = async ( onEveryTimingTick:Function, autoConnect:boolean=false ) => {

    // Get state from session and URL & update GUI
    const elementMain = document.querySelector('main')
    state = State.getInstance(elementMain)
    state.addEventListener((event:Event) => {
        const bookmark = state.asURI
        console.info(bookmark, "State Changed", { event, bookmark })
    })
    //state.setDefaults(defaultOptions)
    state.loadFromLocation(DEFAULT_OPTIONS)
    state.updateLocation()

	// Volume initialization (needed before UI setup)
	const volumeState = state.get('volume')
	const initialVolumePercent:number = volumeState ? parseFloat(volumeState as string) : 50
	const initialVolume:number = Math.max(0, Math.min(1, initialVolumePercent / 100))

	bus = new AudioBus()
	bus.initialise( initialVolume )
	timer = new AudioTimer( bus.audioContext )
	ui = await initialiseFrontEnd( bus.mixer, initialVolumePercent )
	 
	// IO ----------------------------------------------
	const abortController = new AbortController()
	const chain = await createInputOutputChain( bus.mixer, [], [ui], autoConnect )
	//const keyboardInput:InputOnScreenKeyboard = chain.getInput( ONSCREEN_KEYBOARD_INPUT_ID ) as InputOnScreenKeyboard

	// FIXME: This should only occur later
	// listen to the events dispatched from the manager
	// chain.addEventListener(Commands.OUTPUT_EVENT, (event:InputAudioEvent) => {
	chain.addEventListener(Commands.INPUT_EVENT, (event:InputAudioEvent) => {
		
		const command = event.command
		//console.info( "Index:Chain updated",  command.type, Commands.INPUT_EVENT, command )
		switch ( command.type ) {
			 case Commands.PLAYBACK_TOGGLE:
			 	ui.setPlaying(timer.isRunning)
                break

            case Commands.PLAYBACK_START:
                ui.setPlaying(timer.isRunning)
                break

            case Commands.PLAYBACK_STOP:
                ui.setPlaying(timer.isRunning)
                break

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
				if (!chain.isQuantised)
				{
					timer.retrigger()
				}
                break

            case Commands.NOTE_OFF:
				if (!chain.isQuantised)
				{
					timer.retrigger()
				}
                break
		}

	}, { signal: abortController.signal })

	chains.push(chain)

	// expose to global
	// FIXME: this will only ever work with ONE chain :(
	window.chain = chain
    createGraph('graph')

    // start the clock going
	const tempo = parseFloat( state.get('tempo') ?? 99 )
	timer.BPM = tempo
    timer.startTimer(onEveryTimingTick)

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
const onTick = (values:Record<string, any>) => {

    const {
        divisionsElapsed, barsElapsed, timePassed,
        bar, bars,
        elapsed, expected, drift, level, intervals, lag
    } = values

	const now = timer.now

	// Loop through all Chains and process events
	chains.forEach( chain => {
			
		// Always process the queue, with or without quantisation
		const activeCommands:IAudioCommand[] = chain.updateTimeForCommandQueue( now, divisionsElapsed, state )

		// Act upon any command that has now been executed
		if (activeCommands && activeCommands.length > 0)
		{
			const events:AudioEvent[] = IOChain.convertAudioCommandsToAudioEvents(activeCommands, now)
			const allEvents = recorder.addEvents(events)
			const triggers = chain.triggerAudioCommandsOnDevice(events)	// send to Outputs!
			// console.info("onTick", {activeCommands, events, recorded:allEvents, triggers})
		}else{
			//console.info("onTick", {activeCommands})
		}
	})

	// update the UI clock if possible
    ui.updateClock(values, recorder.quantity)
}

/**
 * AudioContext is now available
 * This is the main initialisation routine
 * @param event 
 */
const onAudioContextAvailable = async (event:Event) => await initialiseApplication(onTick)

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

