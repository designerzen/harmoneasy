import './assets/style/index.scss'

import { DEFAULT_OPTIONS } from './options.ts'

import * as Commands from './commands.ts'
import * as INTERVALS from './libs/audiobus/tuning/intervals.js'

// TODO: refactor into Input / Output libs
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

import State from './libs/state.ts'

import AudioBus from './audio.ts'
import AudioEvent from './libs/audiobus/audio-event.ts'
import AudioTimer from './libs/audiobus/timing/timer.audio.js'
import MIDIDevice from './libs/audiobus/midi/midi-device.ts'
import NoteModel from './libs/audiobus/note-model.ts'
import RecorderAudioEvent from './libs/audiobus/recorder-audio-event.ts'

import { createAudioCommand } from './libs/audiobus/audio-command-factory.ts'
import { createReverbImpulseResponse } from './libs/audiobus/effects/reverb.ts'
import { createAudioToolProjectFromAudioEventRecording } from './libs/audiotool/adapter-audiotool-audio-events-recording.ts'
import { createMIDIFileFromAudioEventRecording, saveBlobToLocalFileSystem } from './libs/audiobus/midi/adapter-midi-file.ts'
import { createMIDIMarkdownFromAudioEventRecording, saveMarkdownToLocalFileSystem } from './libs/audiobus/midi/adapter-midi-markdown.ts'
import { createMusicXMLFromAudioEventRecording, saveBlobToLocalFileSystem as saveMusicXMLBlobToLocalFileSystem } from './libs/audiobus/midi/adapter-musicxml.ts'
import { renderVexFlowToContainer, createVexFlowHTMLFromAudioEventRecording, saveBlobToLocalFileSystem as saveVexFlowBlobToLocalFileSystem } from './libs/audiobus/midi/adapter-vexflow.ts'
import { createOpenDAWProjectFromAudioEventRecording } from './libs/openDAW/adapter-opendaw-audio-events-recording.ts'
import { createDawProjectFromAudioEventRecording, saveDawProjectToLocalFileSystem } from './libs/audiobus/midi/adapter-dawproject.ts'

import { importDawProjectFile } from './libs/audiobus/midi/adapter-dawproject-import.ts'
import { importMusicXMLFile } from './libs/audiobus/midi/import-musicxml-import.ts'
import { importMIDIFile } from './libs/audiobus/midi/import-midi-file.ts'

// Front End
import UI from './ui.ts'
import { createGraph } from './components/transformers-graph.tsx'
import SongVisualiser from './components/song-visualiser.ts'

// Back End
import OPFSStorage, { hasOPFS } from './libs/audiobus/storage/opfs-storage.ts'

// IAudioInputs
import IOChain from './libs/audiobus/IO-chain.ts'
import InputKeyboard from './libs/audiobus/inputs/input-keyboard.ts'
import InputGamePad from './libs/audiobus/inputs/input-gamepad.ts'
import InputWebMIDIDevice from './libs/audiobus/inputs/input-webmidi-device.ts'
import InputOnScreenKeyboard, { ONSCREEN_KEYBOARD_INPUT_ID } from './libs/audiobus/inputs/input-onscreen-keyboard.ts'
import InputBLEMIDIDevice from './libs/audiobus/inputs/input-ble-midi-device.ts'

// IAudioOutputs 
import SynthOscillator from './libs/audiobus/instruments/synth-oscillator.ts'
import PolySynth from './libs/audiobus/instruments/poly-synth.ts'
import OutputConsole from './libs/audiobus/outputs/output-console.ts'
import OutputBLEMIDIDevice from './libs/audiobus/outputs/output-ble-midi-device.ts'

import jzz from 'jzz'
import { Output, WebMidi } from 'webmidi'

import type { IAudioCommand } from './libs/audiobus/audio-command-interface.ts'
import type InputAudioEvent from './libs/audiobus/inputs/input-audio-event.ts'

// import { AudioContext, BiquadFilterNode } from "standardized-audio-context"
const ALL_MIDI_CHANNELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]

// All connected MIDI Devices
const MIDIDevices: MIDIDevice[] = []

const storage = hasOPFS() ? new OPFSStorage() : null
const recorder: RecorderAudioEvent = new RecorderAudioEvent()

// internals
let timer: AudioTimer = null
let chain: IOChain
let bus: AudioBus
let state: State

// visuals
let ui: UI
let songVisualiser: SongVisualiser | null = null

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


// For onscreen interactive keyboard
const keyboardKeys = (new Array(128)).fill("")
// Full keyboard with all notes including those we do not want the user to play
const ALL_KEYBOARD_NOTES = keyboardKeys.map((keyboardKeys, index) => new NoteModel(index))
// Grab a good sounding part (not too bassy, not too trebly)
// const KEYBOARD_NOTES = ALL_KEYBOARD_NOTES.slice(41, 94)



// Musical Commands =========================================================

/**
 * Update the front end with this note data
 * 
 * Called from Audio Input Devices and on screen keyboard and 
 * other augmented devices such as the qwerty keyboard
 * @param noteModel The Note
 * @param velocity How powerfully the note was hit
 * @param fromDevice Dpecify an id for which device created it
 */
const noteOn = (noteModel: NoteModel, velocity: number = 1, fromDevice: string = ONSCREEN_KEYBOARD_INPUT_ID) => {
    const now = timer.now

    //console.info("Key pressed - send out MIDI", e )
    // ui.noteOn(noteModel)

    // Add note to song visualiser in realtime
    if (songVisualiser) {
        songVisualiser.noteOn(noteModel.noteNumber, velocity)
    }

    //onscreenKeyboardMIDIDevice.noteOn(noteModel, now)

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
 * Visually end a playing Note
 * @param noteModel 
 * @param velocity 
 * @param fromDevice 
 */
export const noteOff = (noteModel: NoteModel, velocity: number = 1, fromDevice: string = ONSCREEN_KEYBOARD_INPUT_ID) => {
    const now = timer.now
    // ui.noteOff(noteModel)

    // Remove note from song visualiser in realtime
    if (songVisualiser) {
        songVisualiser.noteOff(noteModel.noteNumber)
    }

    //onscreenKeyboardMIDIDevice.noteOff(noteModel, now)
    if (chain) {
        //console.log("Note OFF", noteModel, velocity, {now} )
        chain.outputManager.noteOff(noteModel)
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
	chain.clearNoteCommands()

    // Turn off all actively tracked notes in all MIDI devices
    MIDIDevices.forEach(device => {
        // Clear active notes from the device's tracking
        device.activeNotes.forEach((noteEvent: NoteModel) => {
            const now = timer.now
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

	// TODO: implement
	// chain.allNotesOff()
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
    ui.whenBluetoothDeviceRequestedRun(connectBluetoothDevice)
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
            device[action](noteModel, timer.now, velocity)
        }
    })
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

/**
 * Create a IOChain that connects a series of inputs
 * through a transformerManager into an OutputManager
 * @returns 
 */
const createInputChain = (outputMixer:GainNode) => {
	
	// Create our desired inputs
	const inputKeyboard = new InputKeyboard()
	const inputGamePad = new InputGamePad()
	const inputWebMIDIDevice = new InputWebMIDIDevice()
	const inputSVGKeyboard = new InputOnScreenKeyboard()
	const inputBluetooth = new InputBLEMIDIDevice()

	const inputs = [inputBluetooth, inputKeyboard, inputGamePad, inputWebMIDIDevice, inputSVGKeyboard]

	const chain = new IOChain()
	chain.addInputs(inputs)
	
	// Now add our Outputs - these can be as simple
	// as a WebAudio AudioDestinationNode or a WebMIDI channel
	// but can also be hyper complex or none-audible such as vibrator
    const synthesizer = new PolySynth(bus.audioContext)
    // synthesizer = new SynthOscillator( audioContext )
    synthesizer.output.connect(outputMixer)
    // synthesizer.addTremolo(0.5)

	// create our Bluetooth connector too?

	// add our outputs
	chain.addOutputs( [ 
		new OutputConsole(), 
		synthesizer
	] )
	
	return chain
}

/**
 * Create the UI and front end
 * TODO: Condense and optimise
 */
const initialiseFrontEnd = async (mixer: GainNode) => {

	const initialVolume:number = mixer.gain.value * 200

    const frontEnd = new UI(ALL_KEYBOARD_NOTES, onNoteOnRequestedFromDevice, onNoteOffRequestedFromDevice)
    frontEnd.setTempo(timer.BPM)
	
	// FIXME: Random timbre button
    // ui.whenRandomTimbreRequestedRun(e => synthesizer.setRandomTimbre())
   
	frontEnd.whenTempoChangesRun((tempo: number) => {
        timer.BPM = tempo
        state.set('tempo', tempo)
    })
    frontEnd.whenVolumeChangesRun((volume: number) =>{
		mixer.gain.value = (volume / 100) * 0.5
 		state.set('volume', volume)
	})
	frontEnd.setVolume( initialVolume )

    // ui.whenBluetoothDeviceRequestedRun(connectBluetoothDevice)
	frontEnd.whenBluetoothDeviceRequestedRun(async () => {
		if (!inputBLEMIDI.isConnected) {
			await inputBLEMIDI.connect()
			frontEnd.showBluetoothStatus(`✓ Connected to ${inputBLEMIDI.device?.name}`)
			frontEnd.whenBluetoothDeviceRequested(() => inputBLEMIDI.disconnect())
		} else {
			await inputBLEMIDI.disconnect()
			frontEnd.showBluetoothStatus('✓ Disconnected from device')
			frontEnd.whenBluetoothDeviceRequestedRun(() => inputBLEMIDI.connect())
		}
	})



    frontEnd.whenWebMIDIToggledRun(toggleWebMIDI)
    frontEnd.whenMIDIChannelSelectedRun((channel: number) => {
        selectedMIDIChannel = channel
        console.log(`[MIDI Channel] Selected channel ${channel}`)
    })

    frontEnd.whenExportMenuRequestedRun(() => {
        console.info("Export menu opened")
    })
 
    frontEnd.whenMIDIFileExportRequestedRun(async () => {
        const blob = await createMIDIFileFromAudioEventRecording(recorder, timer)
        saveBlobToLocalFileSystem(blob, recorder.name)
        console.info("Exporting Data to MIDI File", { recorder, blob })
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
	frontEnd.whenFileImportRequestedRun(async (file: File) => {
        try {
            const fileType = file.name.split('.').pop()?.toUpperCase() || 'file'
            frontEnd.showExportOverlay(`Loading ${fileType} file...`)
            console.info(`Loading ${fileType} file from import:`, file.name)
            
            const { commands, noteCount } = await importFile(file)
            chain.addCommandToFuture(commands, timer, true)
            
            console.info(`${fileType} file loaded successfully:`, file.name, { commands, noteCount })
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
			chain.addCommandToFuture(commands, timer, true)
           
        } catch (error) {
            console.error("Error loading file from drop:", error)
            frontEnd.showError("Failed to load file", error instanceof Error ? error.message : String(error))
       	} finally{
			frontEnd.hideExportOverlay()
		}
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
    frontEnd.whenKillSwitchRequestedRun(async () => {
        console.info('[Kill Switch] All notes off requested')
        await allNotesOff()
    })

    frontEnd.whenUserRequestsManualBLECodesRun((rawString: string) => {
        /* parse rawString into numbers and create Uint8Array, then send to BLE */
        // sendBLECommand(rawString)   
        console.info("BLE MANUAL SEND", rawString)
    })

    frontEnd.whenResetRequestedRun(async () => {
		recorder.clear()
        timer.resetTimer()
        if (songVisualiser) {
            songVisualiser.reset()
        }
    })

	// TODO: Global scale?
    // ui.whenNewScaleIsSelected( (scaleNName:string, select:HTMLElement ) => {
    //     console.log("New scale selected:", scaleNName)
    //     // state.set( scaleNName, true )

    //     // ensure we turn all notes off before we change
    //     // otherwise any currently active notes may stick fprever

    //     intervalFormula = INTERVALS.MODAL_SCALES[TUNING_MODE_NAMES.indexOf(scaleNName) ]
    // })

    // ui.whenNoteVisualiserDoubleClickedRun(() => {
    //     synthesizer.setRandomTimbre()
    // })

    await frontEnd.addSongVisualser(recorder.exportData())

	return frontEnd
}

/**
 * Connect the parts of our application
 * @param onEveryTimingTick 
 * @returns 
 */
const initialiseApplication = async (onEveryTimingTick) => {

    // STATE MANAGEMENT -------------------------------
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

	// AUDIO ----------------------------------------------	
	const initialVolume:number = parseFloat( state.get('volume') ?? 100 ) / 50 // 0.5 is default
	bus = new AudioBus()
	bus.initialise( initialVolume )

	// TIMER ----------------------------------------------
    // this handles the audio timing
    timer = new AudioTimer( bus.audioContext )
   
	// UI ----------------------------------------------
	ui = await initialiseFrontEnd( bus.mixer )
	 
	// IO ----------------------------------------------

	// TODO: Create one chain per user chain
	const abortController = new AbortController()
	chain = createInputChain( bus.mixer )
	// add UI feedback where Inputs affect Outputs
	chain.addOutput( ui )

	// FIXME: This should only occur later
	// listen to the events dispatched from the manager
	// chain.addEventListener(Commands.OUTPUT_EVENT, (event:InputAudioEvent) => {
	chain.addEventListener(Commands.INPUT_EVENT, (event:InputAudioEvent) => {
		
		const command = event.command
		console.info( "Index:Chain updated",  command.type, Commands.INPUT_EVENT, command )
		
		switch ( command.type ) {
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
                onNoteOnRequestedFromDevice(new NoteModel(command.value), command.from )
                break

            case Commands.NOTE_OFF:
                onNoteOffRequestedFromDevice(new NoteModel(command.value), command.from )
                break
		}

	}, { signal: abortController.signal })


	// expose to global
	// NB. this will only ever work with ONE chain :(
	window.chain = chain
    createGraph('#graph')

    // start the clock going
	const tempo = parseFloat( state.get('tempo') ?? 99 )
	timer.BPM = tempo
    timer.startTimer(onEveryTimingTick)

	// Update UI - this will check all the inputs according to our state	
    state.updateFrontEnd()

    return state
}

// EVENTS ------------------------------------------------------------------------

const transformCommand = (noteModel: NoteModel, commandType:string=Commands.NOTE_ON, fromDevice: string = ONSCREEN_KEYBOARD_INPUT_ID) => {
	const audioCommand: IAudioCommand = createAudioCommand(commandType, noteModel.noteNumber, timer.now, fromDevice)
    chain.transformerManager.transform([audioCommand], timer)
        .then((transformedAudioCommands: IAudioCommand[]) => {
            chain.addCommands(transformedAudioCommands)
        })
        .catch((error) => {
            console.error('Transform failed:', error)
            chain.addCommand(audioCommand)
        })
}

/**
 * EVEMT: Note On requested from input device
 * @param noteModel
 */
const onNoteOnRequestedFromDevice = (noteModel: NoteModel, fromDevice: string = ONSCREEN_KEYBOARD_INPUT_ID) => {
	transformCommand(noteModel, Commands.NOTE_ON, fromDevice)
}

/**
 * EVENT : Note Off requested from input device
 * @param noteModel:NoteModel
 */
const onNoteOffRequestedFromDevice = (noteModel: NoteModel, fromDevice: string = ONSCREEN_KEYBOARD_INPUT_ID) => {
   transformCommand(noteModel, Commands.NOTE_OFF, fromDevice)
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
                onNoteOnRequestedFromDevice(noteModel, deviceName)
                console.info("MIDI NOTE ON Event!", alreadyPlaying, { note, event, activeMIDIDevice, connectedMIDIDevice, index })
            } else {
                console.info("IGNORE MIDI NOTE ON Event!", alreadyPlaying, { note, event, activeMIDIDevice, connectedMIDIDevice, index })
            }

            break

        case "noteoff":
            console.info("MIDI NOTE OFF Event!", { event, activeMIDIDevice, connectedMIDIDevice, index })
            // Route through the transformation/scheduling pipeline
            const noteModel = new NoteModel(number)
            onNoteOffRequestedFromDevice(noteModel, deviceName)
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
 * received from Timer.
 * Handles scheduling commands and converting to events
 * @param values 
 */
const onTick = (values:Record<string, any>) => {

    const {
        divisionsElapsed,
        bar, bars,
        barsElapsed, timePassed,
        elapsed, expected, drift, level, intervals, lag
    } = values

	const now = timer.now

	// Always process the queue, with or without quantisation
	const activeCommands:IAudioCommand[] = chain.updateTimeForCommandQueue( now, divisionsElapsed, state )

	// Act upon any command that has now been executed
	if (activeCommands && activeCommands.length > 0)
	{
		const events:AudioEvent[] = IOChain.convertAudioCommandsToAudioEvents(activeCommands, now)
		const allEvents = recorder.addEvents(events)
		const triggers = chain.triggerAudioCommandsOnDevice(events)
	}

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