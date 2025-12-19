import './assets/style/index.scss'

import { DEFAULT_OPTIONS } from './options.ts'

import * as Commands from './commands.ts'

import State from './libs/state.ts'

import jzz from 'jzz'
import { WebMidi } from 'webmidi'
import {
    sendBLENoteOn, sendBLENoteOff,
    sendBLEControlChange, sendBLEProgramChange,
    sendBLEPolyphonicAftertouch, sendBLEChannelAftertouch,
    sendBLEPitchBend,
    startBLECharacteristicStream,
    sendBLEAllNoteOff
} from './libs/midi-ble/midi-ble.ts'

import { BLE_SERVICE_UUID_DEVICE_INFO, BLE_SERVICE_UUID_MIDI } from './libs/midi-ble/ble-constants.ts'

import {
    connectToBLEDevice, disconnectBLEDevice,
    listCharacteristics, extractCharacteristics, extractMIDICharacteristic, watchCharacteristics,
    describeDevice
} from './libs/midi-ble/ble-connection.ts' // disconnectDevice may be used for cleanup

// audio libs 
import * as MODES from './libs/audiobus/tuning/chords/modal-chords.js'
import * as CHORDS from './libs/audiobus/tuning/chords/chords.js'
import * as INTERVALS from './libs/audiobus/tuning/intervals.js'
import { TUNING_MODE_NAMES } from './libs/audiobus/tuning/scales.ts'

import AudioEvent from './libs/audiobus/audio-event.ts'
import AudioCommand from './libs/audiobus/audio-command.ts'
import AudioTimer from './libs/audiobus/timing/timer.audio.js'
import MIDIDevice from './libs/audiobus/midi/midi-device.ts'
import SynthOscillator from './libs/audiobus/instruments/synth-oscillator.js'
import PolySynth from './libs/audiobus/instruments/poly-synth.js'
import NoteModel from './libs/audiobus/note-model.ts'

import { TransformerManager } from './libs/audiobus/transformers/transformer-manager.ts'
import { TransformerManagerWorker } from './libs/audiobus/transformers/transformer-manager-worker.ts'
import { createAudioCommand } from './libs/audiobus/audio-command-factory.ts'
import { RecorderAudioEvent } from './libs/audiobus/recorder-audio-event.ts'
import { createReverbImpulseResponse } from './libs/audiobus/effects/reverb.ts'
import { createAudioToolProjectFromAudioEventRecording } from './libs/audiotool/adapter-audiotool-audio-events-recording.ts'
import { createMIDIFileFromAudioEventRecording, saveBlobToLocalFileSystem } from './libs/audiobus/midi/adapter-midi-file.ts'
import { createMIDIMarkdownFromAudioEventRecording, saveMarkdownToLocalFileSystem } from './libs/audiobus/midi/adapter-midi-markdown.ts'
import { createMusicXMLFromAudioEventRecording, saveBlobToLocalFileSystem as saveMusicXMLBlobToLocalFileSystem } from './libs/audiobus/midi/adapter-musicxml.ts'
import { renderVexFlowToContainer, createVexFlowHTMLFromAudioEventRecording, saveBlobToLocalFileSystem as saveVexFlowBlobToLocalFileSystem } from './libs/audiobus/midi/adapter-vexflow.ts'
import { Midi } from '@tonejs/midi'
import { createOpenDAWProjectFromAudioEventRecording } from './libs/openDAW/adapter-opendaw-audio-events-recording.ts'
import { createDawProjectFromAudioEventRecording, saveDawProjectToLocalFileSystem } from './libs/audiobus/midi/adapter-dawproject.ts'
import { importDawProjectFile } from './libs/audiobus/midi/adapter-dawproject-import.ts'
import { importMusicXMLFile } from './libs/audiobus/midi/adapter-musicxml-import.ts'

import { addKeyboardDownEvents } from './libs/keyboard.ts'

import type { IAudioCommand } from './libs/audiobus/audio-command-interface.ts'

// Back End
import { createGraph } from './components/transformers-graph.tsx'
import UI from './ui.ts'
import { SongVisualiser } from './components/song-visualiser.ts'
import OPFSStorage, { hasOPFS } from './libs/audiobus/storage/opfs-storage.ts'
import noteModel from './libs/audiobus/note-model.ts'

// import { AudioContext, BiquadFilterNode } from "standardized-audio-context"
const ALL_MIDI_CHANNELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]

// All connected MIDI Devices
const MIDIDevices: MIDIDevice[] = []
let timer: AudioTimer = null
let timeLastBarBegan = 0
let audioContext: AudioContext
let synthesizer: SynthOscillator | PolySynth = null

let transformerManager: TransformerManager

// BLE devices and characteristics
// TODO: Move into a MIDIDevice wrapper to allow for multiple
// MIDI devices simultaneously
let bluetoothMIDICharacteristic: BluetoothRemoteGATTCharacteristic
let bluetoothDevice: BluetoothDevice | null
let bluetoothWatchUnsubscribes: Array<() => Promise<void>> = []
let bluetoothPacketQueue: Array<number> | undefined = []

let webMIDIEnabled: boolean = false
let selectedMIDIChannel: number = 1  // User-selected MIDI output channel (1-16)

// this is just a buffer for the onscreen keyboard
let onscreenKeyboardMIDIDevice: MIDIDevice

// Feed this for X amount of BARS
let audioCommandQueue: IAudioCommand[] = []

const storage = hasOPFS() ? new OPFSStorage() : null
const recorder: RecorderAudioEvent = new RecorderAudioEvent()

// visuals
let ui: UI = null
let songVisualiser: SongVisualiser | null = null

// For onscreen interactive keyboard
const keyboardKeys = (new Array(128)).fill("")
// Full keyboard with all notes including those we do not want the user to play
const ALL_KEYBOARD_NOTES = keyboardKeys.map((keyboardKeys, index) => new NoteModel(index))
// Grab a good sounding part (not too bassy, not too trebly)
// const KEYBOARD_NOTES = ALL_KEYBOARD_NOTES.slice(41, 94)

// Types of MIDI Devices
const ONSCREEN_KEYBOARD_NAME = "SVG Keyboard"
const LETTER_KEYBOARD_NAME = "Keyboard"

let state

let intervalFormula = INTERVALS.IONIAN_INTERVALS

// TODO: this should be set per user
let pausedQueue: number = 0

// Scheduling =====================================================================

const convertAudioCommandsToAudioEvents = (commands: IAudioCommand[]): AudioEvent[] => {
    return (commands ?? []).map((command: IAudioCommand) => new AudioEvent(command, timer.now ))
}

const triggerAudioCommandsOnDevice = (commands: IAudioCommand[]) => {
    commands.forEach(command => {

        switch (command.type) {
            case Commands.NOTE_ON:
                noteOn(new NoteModel(command.number), command.velocity)
                break

            case Commands.NOTE_OFF:
                noteOff(new NoteModel(command.number), command.velocity)
                break

            default:
                console.info("NOT IMPLEMENTED: Audio Command", command.type, Commands)
        }
    })
    return commands
}

/**
 * Actions every single Command with a startAt set in the past
 * and returns the commands in order of creation that are in the
 * future or not yet set to trigger
 * TODO: Add enabled / disabled
 * @param queue
 */
const executeQueueAndClearComplete = (queue: AudioCommand[], accumulatorLimit=24 ) => {

    if (!queue || queue.length === 0) {
        return []
    }

    const now = timer.now

    // only trigger commands started in the past
    // queue = queue.filter(audioCommand => audioCommand.startAt <= now)
    const remainingCommands: AudioCommand[] = []

    // act on all data in the buffer...
	let unplayedAccumulator = 0
	const quantity = queue.length
	for (let i = 0; i < quantity && unplayedAccumulator < accumulatorLimit; i++) {
		const audioCommand: AudioCommand = queue[i]
		   const shouldTrigger = audioCommand.startAt <= now
        if (shouldTrigger) {
            // Transformations already applied at input time, just execute
            const events = convertAudioCommandsToAudioEvents([audioCommand])
            recorder.addEvents(events)
            const triggers = triggerAudioCommandsOnDevice(events)
            // console.info("AudioCommand triggered in time domain", {audioCommand, triggers, timer} )
        } else {
			unplayedAccumulator++
            remainingCommands.push(audioCommand)
        }
	}

    return remainingCommands
}

// Musical Commands =========================================================

/**
 * Play a note
 * Called from MIDI Devices and on screen keyboard and 
 * other augmented devices such as the qwerty keyboard
 * @param noteModel The Note
 * @param velocity How powerfully the note was hit
 * @param fromDevice Dpecify an id for which device created it
 */
const noteOn = (noteModel: NoteModel, velocity: number = 1, fromDevice: string = ONSCREEN_KEYBOARD_NAME) => {
    const now = timer.now

    //console.info("Key pressed - send out MIDI", e )
    ui.noteOn(noteModel)

    // Add note to song visualiser in realtime
    if (songVisualiser) {
        songVisualiser.noteOn(noteModel.noteNumber, velocity)
    }

    onscreenKeyboardMIDIDevice.noteOn(noteModel, now)

    if (synthesizer) {
        //console.log("Note ON", noteModel, velocity, {now} )
        synthesizer.noteOn(noteModel, velocity)
    }

    if (MIDIDevice.length > 0) {
        sendMIDIActionToAllDevices(fromDevice, noteModel, Commands.NOTE_ON, 1)
    }

    // FIXME: Move this into its own device
    if (bluetoothMIDICharacteristic) {
        // Send actual note from keyboard to BLE MIDI device
        sendBLENoteOn(bluetoothMIDICharacteristic, selectedMIDIChannel, noteModel.noteNumber, 127, bluetoothPacketQueue)
            .then(result => {
                console.log('Sent MIDI NOTE ON to BLE device!', { note: noteModel.noteNumber, channel: selectedMIDIChannel, result })
            })
            .catch(err => {
                console.error('Failed to send MIDI NOTE ON to BLE device!', {
                    note: noteModel.noteNumber,
                    channel: selectedMIDIChannel,
                    error: err && err.message ? err.message : String(err),
                    device: bluetoothMIDICharacteristic
                })
            })
    }
}

/**
 * End a playing Note
 * @param noteModel 
 * @param velocity 
 * @param fromDevice 
 */
export const noteOff = (noteModel: NoteModel, velocity: number = 1, fromDevice: string = ONSCREEN_KEYBOARD_NAME) => {
    const now = timer.now
    ui.noteOff(noteModel)

    // Remove note from song visualiser in realtime
    if (songVisualiser) {
        songVisualiser.noteOff(noteModel.noteNumber)
    }

    onscreenKeyboardMIDIDevice.noteOff(noteModel, now)
    if (synthesizer) {
        //console.log("Note OFF", noteModel, velocity, {now} )
        synthesizer.noteOff(noteModel)
    }

    if (MIDIDevice.length > 0) {
        sendMIDIActionToAllDevices(fromDevice, noteModel, Commands.NOTE_OFF, 1)
    }

    if (bluetoothMIDICharacteristic) {
        // Send actual note from keyboard to BLE MIDI device
        sendBLENoteOff(bluetoothMIDICharacteristic, selectedMIDIChannel, noteModel.noteNumber, 0, bluetoothPacketQueue)
            .then(result => {
                console.log('Sent MIDI NOTE OFF to BLE device!', { note: noteModel.noteNumber, channel: selectedMIDIChannel, result })
            })
            .catch(err => {
                console.error('Failed to send MIDI NOTE OFF to BLE device!', {
                    note: noteModel.noteNumber,
                    channel: selectedMIDIChannel,
                    error: err && err.message ? err.message : String(err),
                    device: bluetoothMIDICharacteristic
                })
            })
    }
}

/**
 * Kill Switch - Send note off for all possible MIDI notes (0-127)
 * This cleans up any stuck notes and simulates an "All Notes Off" command
 */
export const allNotesOff = async () => {

    // Clear the audio command queue of pending note commands
    audioCommandQueue = audioCommandQueue.filter(cmd =>
        cmd.type !== Commands.NOTE_ON && cmd.type !== Commands.NOTE_OFF
    )

    // Turn off all notes in the internal synth
    if (synthesizer) {
        synthesizer.allNotesOff()
    }

    // Turn off all actively tracked notes in all MIDI devices
    MIDIDevices.forEach(device => {
        // Clear active notes from the device's tracking
        device.activeNotes.forEach((noteEvent: NoteModel) => {
            const now = timer ? timer.now : audioContext.currentTime
            device.noteOff(noteEvent, now)
        })
        // Also clear any scheduled commands
        device.requestedCommands.clear()
    })

    // Send note off for all 128 MIDI notes to BLE device
    if (bluetoothMIDICharacteristic) {
        try {
            await sendBLEAllNoteOff(bluetoothMIDICharacteristic, selectedMIDIChannel, 123, 0, bluetoothPacketQueue)
            console.log('Sent CC#123 (All Notes Off) to BLE device')
        } catch (err) {
            console.error('Failed to send CC#123 to BLE device:', err)
        }
    }

    ui.allNotesOff()
    console.log("KILL SWITCH: Complete")
}

// MIDI =========================================================

/**
 * Connect to ALL MIDI Devices currently connected
 */
const connectToMIDIDevice = (connectedMIDIDevice, index: number) => {
    const device = new MIDIDevice(`${connectedMIDIDevice.manufacturer} ${connectedMIDIDevice.name}`)

    connectedMIDIDevice.addListener("noteon", event => onMIDIEvent(event, device, connectedMIDIDevice, index), { channels: ALL_MIDI_CHANNELS })
    connectedMIDIDevice.addListener("noteoff", event => onMIDIEvent(event, device, connectedMIDIDevice, index), { channels: ALL_MIDI_CHANNELS })
    connectedMIDIDevice.addListener("controlchange", event => onMIDIEvent(event, device, connectedMIDIDevice, index), { channels: ALL_MIDI_CHANNELS })
    // todo: PITCHBEND AND AFTERTOUCH

    ui.addDevice(connectedMIDIDevice, index)
    console.info("connectToMIDIDevices", { device, connectedMIDIDevice, index })
    return device
}

// Bluetooth MIDI =========================================================

/**
 * Disconnect BLE device and clean up
 */
const disconnectBluetoothDevice = async () => {
    console.info('[BLE] Disconnecting from device...', { device: bluetoothDevice?.name })

    // Unsubscribe from all characteristic watches
    for (const unsub of bluetoothWatchUnsubscribes) {
        try {
            await unsub()
        } catch (err: any) {
            console.warn('[BLE] Error unsubscribing from characteristic:', err)
        }
    }

    // Disconnect the GATT server
    if (bluetoothDevice) {
        disconnectBLEDevice(bluetoothDevice)
    }

    // Clear references
    bluetoothWatchUnsubscribes = []
    bluetoothMIDICharacteristic = undefined as any
    bluetoothDevice = null

    // Update UI
    ui.showBluetoothStatus('✓ Disconnected from device')
    ui.whenBluetoothDeviceRequested(connectBluetoothDevice)
}

/**
 * Connect to BLE device and set up MIDI
 */
const connectBluetoothDevice = async () => {
    try {

        ui.showBluetoothStatus('Opening device chooser...')

        const result = await connectToBLEDevice()
        console.info('BLE Connection Result', result)

        // Check to see if everything is ok
        if (!result || !result.characteristic) {
            // Failure to locate BLE Midi capability
            throw Error('No BLE MIDI characteristic found on device')
        }

        // find all characteristics...
        // const characteristics = extractCharacteristics( result.capabilities )
        // const midiCharacteristic:BluetoothRemoteGATTCharacteristic|undefined = extractMIDICharacteristic(characteristics)

        // use only MIDI capable characteristic
        bluetoothMIDICharacteristic = result.characteristic
        bluetoothDevice = result.device

        // pass this into the BLE packet sending
        startBLECharacteristicStream(bluetoothMIDICharacteristic, 10, bluetoothPacketQueue)

        // ui.addBluetoothDevice( bluetoothDevice, result.capabilities)
        ui.showBluetoothStatus(`✓ Connecting to ${bluetoothDevice.name || 'Unknown Device'}`)

        console.warn('MIDI Device was located using BLE', {
            characteristic: bluetoothMIDICharacteristic,
            uuid: bluetoothMIDICharacteristic.uuid,
            writable: bluetoothMIDICharacteristic.properties?.write || bluetoothMIDICharacteristic.properties?.writeWithoutResponse,
            properties: bluetoothMIDICharacteristic.properties
        })

        // const availableMIDIBluetoothCharacteristics = characteristics
        const availableMIDIBluetoothCharacteristics = [bluetoothMIDICharacteristic]

        // console.log("Extracted capabilities from capabilities", characteristics )

        // monitor all characteristics for incoming data (inc. MIDI)
        const unsubs = await watchCharacteristics(availableMIDIBluetoothCharacteristics, (capability, value) => {
            // capability: CapabilityCharacteristic, value: DataView
            const data = new Uint8Array(value.buffer)
            console.log('Characteristic data received', { capability, data, value })
            // check to see if it is MIDI data!
            switch (capability.uuid) {
                case BLE_SERVICE_UUID_MIDI:
                    // MIDI Data received over BLE!
                    // parse MIDI data
                    const midiData = jzz.MIDI(data)

                    console.log('MIDI Data received over BLE', { data, midiData })
                    break

                default:
                    console.log('Non-MIDI Data received over BLE', data)
            }
        })

        // Store device reference for later disconnect
        bluetoothWatchUnsubscribes = unsubs

        console.info("Bluetooth Device connected", { result }, describeDevice(bluetoothDevice))

        ui.showBluetoothStatus(`✓ Connected to ${bluetoothDevice.name || 'Unknown Device'}`)
        // Change button to disconnect mode
        ui.whenBluetoothDeviceRequested(disconnectBluetoothDevice)

        ui.setBLEManualInputVisible(true)

    } catch (error: any) {

        ui.showBluetoothStatus(`✗ BLE Error: ${error.message || 'Failed to connect'}`)
        ui.showError(`Bluetooth connection could not be established: ${error.message || 'Failed to connect'}`)
        console.error("`Bluetooth connection could not be established", error)
    }
}

const toggleBluetoothDevice = async () => {
    if (!bluetoothDevice) {
        await connectBluetoothDevice()
    } else {
        await disconnectBluetoothDevice()
    }
}

// WebMIDI =========================================================

/**
 * Turn on MIDI connection
 */
const enableMIDI = async () => {
    try {
        await WebMidi.enable()
        webMIDIEnabled = true
        ui.setWebMIDIButtonText('Disable WebMIDI')
        onMIDIDevicesAvailable(undefined as any)
    } catch (err: any) {
        // onUltimateFailure(err)
        ui.showError(`WebMIDI could not be established: ${err.message || 'Failed to connect'}`)
    }
}

/**
 * Turn off MIDI connection
 */
const disableMIDI = async () => {
    try {
        await WebMidi.disable()
        webMIDIEnabled = false
        ui.setWebMIDIButtonText('Enable WebMIDI')
        // clear any connected MIDIDevices
        MIDIDevices.length = 0
        ui.inputs.innerHTML = ''
        ui.outputs.innerHTML = ''
    } catch (err: any) {
        ui.showError(`WebMIDI connection would not disconnect: ${err.message || 'Failed to connect'}`)
    }
}

/**
 *  WebMIDI will be enabled/disabled with the UI toggle button
 *  also now monitor for MIDI inputs...
 */
const toggleWebMIDI = async () => {
    if (!webMIDIEnabled) {
        await enableMIDI()
    } else {
        await disableMIDI()
    }
}

/**
 * 
 * @param fromDevice 
 * @param noteModel 
 * @param action 
 * @param velocity 
 */
const sendMIDIActionToAllDevices = (fromDevice: String, noteModel: NoteModel, action: string = Commands.NOTE_ON, velocity: number = 127) => {
    MIDIDevices.forEach(device => {
        if (device.id !== fromDevice) {
            device[action](noteModel, audioContext.currentTime, velocity)
        }
    })
}

const importMIDIFile = async(file: File) => {
	const arrayBuffer = await file.arrayBuffer()

	// Parse MIDI using @tonejs/midi
	const midi = new Midi(arrayBuffer)

	// Convert MIDI tracks to audio events
	const commands: IAudioCommand[] = []
	let noteCount = 0

	// Process all tracks
	for (const track of midi.tracks) {
		// Process all notes in the track
		for (const note of track.notes) {
			noteCount++
			
			// Create NOTE_ON
			const noteOn = new AudioCommand()
			noteOn.type = Commands.NOTE_ON
			noteOn.number = note.midi
			noteOn.velocity = note.velocity * 127 || 100  // @tonejs/midi uses 0-1, convert to 0-127
			noteOn.startAt = note.time
			noteOn.from = file.name
			noteOn.channel = track.channel
			noteOn.patch = track.instrument.number
			commands.push(noteOn)
			console.info("note", {note}, "track", {track})
			
			// Create NOTE_OFF
			const noteOff = new AudioCommand()
			noteOff.type = Commands.NOTE_OFF
			noteOff.number = note.midi
			noteOff.velocity = note.velocity * 127 || 100
			noteOff.startAt = note.time + note.duration
			noteOff.from = file.name
			noteOff.channel = track.channel
			noteOff.patch = track.instrument.number
			commands.push(noteOff)
		}
	}

	// Sort by start time
	commands.sort((a, b) => (a.startAt || 0) - (b.startAt || 0))

	console.info("MIDI file loaded successfully", { 
		fileName: file.name, 
		noteCount, 
		duration: midi.duration,
		tracks: midi.tracks.length,
		tempo: midi.header.tempos[0]?.bpm
	})

	return {
		commands,
		noteCount
	}
}

/**
 * Universal import handler - routes to appropriate importer based on file type
 */
const importFile = async (file: File): Promise<{ commands: IAudioCommand[], noteCount: number }> => {
	const fileName = file.name.toLowerCase()
	
	// Determine file type and route to appropriate importer
	if (fileName.endsWith('.mid') || fileName.endsWith('.midi') || file.type.includes('midi')) {
		return importMIDIFile(file)
	} else if (fileName.endsWith('.musicxml') || fileName.endsWith('.xml')) {
		return importMusicXMLFile(file)
	} else if (fileName.endsWith('.dawproject')) {
		return importDawProjectFile(file)
	} else {
		throw new Error(`Unsupported file type: ${file.type || fileName}. Supported formats: MIDI (.mid, .midi), MusicXML (.musicxml, .xml), .dawProject`)
	}
}

const addCommandToFuture = (commands: IAudioCommand[], transform=false, startDelay=3): IAudioCommand[] => {
	// shift it into the future
	commands.forEach(command => {
		command.startAt += timer.now + startDelay
		// inject into the queue...
		if (!transform){
			 audioCommandQueue.push(command)
		}
	})
	if (transform)
	{
		// Transform is now async - queue the promise
		transformerManager.transform(commands, timer)
			.then((transformedAudioCommands: IAudioCommand[]) => {
				audioCommandQueue.push(...transformedAudioCommands)
			})
			.catch((error) => {
				console.error('Transform failed:', error)
				// Fallback: add untransformed commands
				audioCommandQueue.push(...commands)
			})
	}

	return commands
}

/**
 * Connect the parts of our application
 * @param onEveryTimingTick 
 * @returns 
 */
const initialiseApplication = async (onEveryTimingTick) => {

    // STATE MANAGEMENT -------------------------------
    // Get state from session and URL
    const elementMain = document.querySelector('main')
    state = State.getInstance(elementMain)
    state.addEventListener(event => {
        const bookmark = state.asURI
        console.info(bookmark, "State Changed", { event, bookmark })
    })

    //state.setDefaults(defaultOptions)
    state.loadFromLocation(DEFAULT_OPTIONS)
    state.updateLocation()

    audioContext = new AudioContext()

    const mixer: GainNode = audioContext.createGain()
    mixer.gain.value = 0.5

    const reverb = audioContext.createConvolver()
    reverb.buffer = createReverbImpulseResponse(audioContext, 1, 7)

    mixer.connect(reverb)
    reverb.connect(audioContext.destination)

    synthesizer = new PolySynth(audioContext)
    // synthesizer = new SynthOscillator( audioContext )
    synthesizer.output.connect(mixer)
    // synthesizer.addTremolo(0.5)

    // this handles the audio timing
    timer = new AudioTimer(audioContext)
    timer.BPM = state.get('tempo')

    // Front End UI -------------------------------
    ui = new UI(ALL_KEYBOARD_NOTES, onNoteOnRequestedFromKeyboard, onNoteOffRequestedFromKeyboard)
    ui.setTempo(timer.BPM)

    ui.whenRandomTimbreRequestedRun(e => synthesizer.setRandomTimbre())
    ui.whenTempoChangesRun((tempo: number) => {
        timer.BPM = tempo
        state.set('tempo', tempo)
    })
    ui.whenVolumeChangesRun((volume: number) => mixer.gain.value = (volume / 100) * 0.5)
    ui.whenBluetoothDeviceRequestedRun(connectBluetoothDevice)
    ui.whenWebMIDIToggledRun(toggleWebMIDI)
    ui.whenMIDIChannelSelectedRun((channel: number) => {
        selectedMIDIChannel = channel
        console.log(`[MIDI Channel] Selected channel ${channel}`)
    })

    ui.whenExportMenuRequestedRun(() => {
        console.info("Export menu opened")
    })
 
    ui.whenMIDIFileExportRequestedRun(async () => {
        const blob = await createMIDIFileFromAudioEventRecording(recorder, timer)
        saveBlobToLocalFileSystem(blob, recorder.name)
        console.info("Exporting Data to MIDI File", { recorder, blob })
    })
    ui.whenMIDIMarkdownExportRequestedRun(async () => {
        const markdown = createMIDIMarkdownFromAudioEventRecording(recorder, timer)
        saveMarkdownToLocalFileSystem(markdown, recorder.name)
        console.info("Exporting Data to MIDI Markdown", { recorder, markdown })
    })
    ui.whenMusicXMLExportRequestedRun(async () => {
        const blob = await createMusicXMLFromAudioEventRecording(recorder, timer)
        saveMusicXMLBlobToLocalFileSystem(blob, recorder.name)
        console.info("Exporting Data to MusicXML", { recorder, blob })
        ui.showInfoDialog("MusicXML File created and saved", "musicxml.org")
    })
    ui.whenVexFlowExportRequestedRun(async () => {
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
                ui.showInfoDialog("Musical Score", modalContainer.innerHTML)
            }
            console.info("Exporting Data to VexFlow", { recorder })
        } catch (error) {
            console.error("Error rendering VexFlow score", error)
            ui.showInfoDialog("Error", "Failed to render VexFlow score. Check console for details.")
        }
    })
	   ui.whenFileImportRequestedRun(async (file: File) => {
        try {
            const fileType = file.name.split('.').pop()?.toUpperCase() || 'file'
            ui.showExportOverlay(`Loading ${fileType} file...`)
            console.info(`Loading ${fileType} file from import:`, file.name)
            
            const { commands, noteCount } = await importFile(file)
            addCommandToFuture(commands, true)
            
            console.info(`${fileType} file loaded successfully:`, file.name, { commands, noteCount })
            ui.showInfoDialog("File Loaded", `Successfully loaded ${file.name} with ${noteCount} notes`)
        } catch (error) {
            console.error("Error loading file from import:", error)
            ui.showError("Failed to load file", error instanceof Error ? error.message : String(error))
        } finally {
            ui.hideExportOverlay()
        }
    })
    ui.whenMIDIFileDroppedRun(async (file: File) => {
        try {
            const fileType = file.name.split('.').pop()?.toUpperCase() || 'file'
            ui.showExportOverlay(`Found ${fileType} File`)
            console.info(`Loading ${fileType} file from drop:`, file.name)
			const { commands, noteCount } = await importFile(file)
			addCommandToFuture(commands, true)
			
        } catch (error) {
            console.error("Error loading file from drop:", error)
            ui.showError("Failed to load file", error instanceof Error ? error.message : String(error))
       	} finally{
			ui.hideExportOverlay()
		}
    })
    ui.whenAudioToolExportRequestedRun(async () => {
        const output = await createAudioToolProjectFromAudioEventRecording(recorder, timer)
        console.info("Exporting Data to AudioTool", { recorder, output })
        ui.setExportOverlayText("Open this project in AudioTool")
        ui.showInfoDialog("Open the file in AudioTool", "audiotool.com")
    })
    ui.whenOpenDAWExportRequestedRun(async () => {
        const script = await createOpenDAWProjectFromAudioEventRecording(recorder, timer)
        console.info("Exporting Data to OpenDAW", { recorder, script })
        ui.setExportOverlayText("Copy and paste this into openDAW script editor")
        ui.showInfoDialog("Exporting Data to OpenDAW", script)
    })
    ui.whenDawProjectExportRequestedRun(async () => {
        const blob = await createDawProjectFromAudioEventRecording(recorder, timer)
        const filename = (recorder.name ?? 'project').replace(/\s+/g, '_')
        await saveDawProjectToLocalFileSystem(blob, filename)
        console.info("Exporting Data to .dawProject", { recorder, blob })
    })
    ui.whenKillSwitchRequestedRun(async () => {
        console.info('[Kill Switch] All notes off requested', transformerManager.exportConfig())
        await allNotesOff()
    })

    ui.whenUserRequestsManualBLECodesRun((rawString: string) => {
        /* parse rawString into numbers and create Uint8Array, then send to BLE */
        // sendBLECommand(rawString)   
        console.info("BLE MANUAL SEND", rawString)
    })

    ui.whenResetRequestedRun(async () => {
      
		recorder.clear()
        timer.resetTimer()

        if (songVisualiser) {
            songVisualiser.reset()
        }
    })

    // ui.whenNewScaleIsSelected( (scaleNName:string, select:HTMLElement ) => {
    //     console.log("New scale selected:", scaleNName)
    //     // state.set( scaleNName, true )

    //     // ensure we turn all notes off before we change
    //     // otherwise any currently active notes may stick fprever

    //     intervalFormula = INTERVALS.MODAL_SCALES[TUNING_MODE_NAMES.indexOf(scaleNName) ]
    // })

    ui.whenNoteVisualiserDoubleClickedRun(() => {
        synthesizer.setRandomTimbre()
    })

    await ui.addSongVisualser(recorder.exportData())

    onscreenKeyboardMIDIDevice = new MIDIDevice(ONSCREEN_KEYBOARD_NAME)
    MIDIDevices.push(onscreenKeyboardMIDIDevice)

    // now watch for keydowns and tie into MIDI
    addKeyboardDownEvents((command: string, key: string, value: number) => {
        switch (command) {
            case Commands.PLAYBACK_TOGGLE:
                timer.toggleTimer()
                ui.setPlaying(timer.isRunning)
                break

            case Commands.PLAYBACK_START:
                timer.startTimer()
                ui.setPlaying(timer.isRunning)
                break

            case Commands.PLAYBACK_STOP:
                timer.stopTimer()
                ui.setPlaying(timer.isRunning)
                break

            case Commands.TEMPO_TAP:
                timer.tapTempo()
                ui.setTempo(timer.BPM)
                state.set('tempo', timer.BPM)
                break

            case Commands.TEMPO_INCREASE:
                timer.BPM++
                ui.setTempo(timer.BPM)
                state.set('tempo', timer.BPM)
                break

            case Commands.TEMPO_DECREASE:
                timer.BPM--
                ui.setTempo(timer.BPM)
                state.set('tempo', timer.BPM)
                break

            case Commands.PITCH_BEND:
                break

            case Commands.NOTE_ON:
                onNoteOnRequestedFromKeyboard(new NoteModel(value), LETTER_KEYBOARD_NAME)
                break

            case Commands.NOTE_OFF:
                onNoteOffRequestedFromKeyboard(new NoteModel(value), LETTER_KEYBOARD_NAME)
                break
        }
    })

    // Update UI - this will check all the inputs according to our state	
    state.updateFrontEnd()
    // state.set( value, button.checked )

    // Use worker for async transform operations (avoids blocking main thread)
    transformerManager = new TransformerManagerWorker()
    window.transformerManager = transformerManager
    createGraph('#graph')

    // start the clock going
    timer.startTimer(onEveryTimingTick)

    return state
}

// EVENTS ------------------------------------------------------------------------

/**
 * EVEMT: Note On requested from onscreen keyboard / external keyboard
 * @param noteModel
 */
const onNoteOnRequestedFromKeyboard = (noteModel: NoteModel, fromDevice: string = ONSCREEN_KEYBOARD_NAME) => {
    const audioCommand: AudioCommand = createAudioCommand(Commands.NOTE_ON, noteModel.noteNumber, timer.now, fromDevice)
    transformerManager.transform([audioCommand], timer)
        .then((transformedAudioCommands: IAudioCommand[]) => {
            audioCommandQueue.push(...transformedAudioCommands)
        })
        .catch((error) => {
            console.error('Transform failed:', error)
            audioCommandQueue.push(audioCommand)
        })
}

/**
 * EVENT : Note Off requested from onscreen keyboard / external keyboard
 * @param noteModel:NoteModel
 */
const onNoteOffRequestedFromKeyboard = (noteModel: NoteModel, fromDevice: string = ONSCREEN_KEYBOARD_NAME) => {
    const audioCommand: AudioCommand = createAudioCommand(Commands.NOTE_OFF, noteModel.noteNumber, timer.now, fromDevice)
    transformerManager.transform([audioCommand], timer)
        .then((transformedAudioCommands: IAudioCommand[]) => {
            audioCommandQueue.push(...transformedAudioCommands)
        })
        .catch((error) => {
            console.error('Transform failed:', error)
            audioCommandQueue.push(audioCommand)
        })
}

/**
 * EVENT: 
 * MIDI IS available, let us check for MIDI devices connected
 * @param event 
 */
const onMIDIDevicesAvailable = (event) => {
    // Display available MIDI input devices
    if (WebMidi.inputs.length < 1) {
        ui.showError("No MIDI devices connected", "Connect a USB or MIDI instrument", false)
    } else {
        // save a link to all connected MIDI devices
        WebMidi.inputs.forEach((device, index) => {
            // Monitor inputs from the MIDI devices attached
            const availableMIDIDevice = connectToMIDIDevice(device, index)
            MIDIDevices.push(availableMIDIDevice)
        })
    }
}

/**
 * EVENT
 * MIDI Input received - delegate to classes
 * @param event 
 */
const onMIDIEvent = (event, activeMIDIDevice, connectedMIDIDevice, index) => {
    // Now test each "Requested Event" and facilitate
    // loop through our queue of requested events...
    // document.body.innerHTML+= `${event.note.name} <br>`
    const note = event.note
    const { number } = note
    const deviceName = `${connectedMIDIDevice.manufacturer} ${connectedMIDIDevice.name}`

    switch (event.type) {
        case "noteon":
            const alreadyPlaying = activeMIDIDevice.noteOn(note)
            // ui.addCommand( command )
            if (!alreadyPlaying) {
                // Route through the transformation/scheduling pipeline
                const noteModel = new NoteModel(number)
                onNoteOnRequestedFromKeyboard(noteModel, deviceName)
                console.info("MIDI NOTE ON Event!", alreadyPlaying, { note, event, activeMIDIDevice, connectedMIDIDevice, index })
            } else {
                console.info("IGNORE MIDI NOTE ON Event!", alreadyPlaying, { note, event, activeMIDIDevice, connectedMIDIDevice, index })
            }

            break

        case "noteoff":
            console.info("MIDI NOTE OFF Event!", { event, activeMIDIDevice, connectedMIDIDevice, index })
            // Route through the transformation/scheduling pipeline
            const noteModel = new NoteModel(number)
            onNoteOffRequestedFromKeyboard(noteModel, deviceName)
            activeMIDIDevice.noteOff(note)
            break

        case "controlchange":
            console.info("MIDI CC Event!", {
                controller: event.controller.number,
                value: event.value,
                rawValue: event.rawValue,
                event,
                activeMIDIDevice,
                connectedMIDIDevice,
                index
            })
            break

        // TODO: Don't ignore stuff like pitch bend
    }
}

/**
 * EVENT:
 * Bar TICK - 24 divisions per quarter note
 * @param values 
 */
const onTick = (values) => {

    const {
        divisionsElapsed,
        bar, bars,
        barsElapsed, timePassed,
        elapsed, expected, drift, level, intervals, lag
    } = values

    // Always process the queue, with or without quantisation
    if (transformerManager.isQuantised) {
        //console.info("TICK:QUANTISED", {buffer: audioCommandQueue, divisionsElapsed, quantisationFidelity:transformerManager.quantiseFidelity})
        // When quantised, only trigger events on the grid
        const gridSize = transformerManager.quantiseFidelity
        if ((pausedQueue === 0) && (divisionsElapsed % gridSize) === 0) {
            audioCommandQueue = executeQueueAndClearComplete(audioCommandQueue)
            // if grid is set to true in options, we can only ever play one
            // note at a time on this grid point
            pausedQueue = state && state.get("grid") ? gridSize - 1 : 0
            // console.info( pausedQueue, "TICK:QUANTISED", {buffer: audioCommandQueue, divisionsElapsed, quantisationFidelity:transformerManager.quantiseFidelity})
        } else {
            // reset duplicator
            pausedQueue = Math.max(0, pausedQueue - 1)
            // console.info( pausedQueue, "TICK:IGNORED", {buffer: audioCommandQueue, divisionsElapsed, quantisationFidelity:transformerManager.quantiseFidelity})
        }
    } else {

        //console.info("TICK:IMMEDIATE", {buffer: audioCommandQueue, divisionsElapsed})

        // When not quantised, process queue immediately on every tick
        audioCommandQueue = executeQueueAndClearComplete(audioCommandQueue)
        // console.info("TICK:IMMEDIATE", {buffer: audioCommandQueue})
    }

    ui.updateClock(values, recorder.quantity)
}

/**
 * AudioContext is now available
 * This is the main initialisation routine
 * @param event 
 */
const onAudioContextAvailable = async (event) => {
    await initialiseApplication(onTick)
}

// Background data load
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