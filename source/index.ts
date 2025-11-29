import './assets/style/index.scss'

import { DEFAULT_OPTIONS } from './options.ts'

import * as Commands from './commands.ts'

import State from './libs/state.ts'
import UI from './components/ui.js'

import { WebMidi } from 'webmidi'
import {
    sendBLENoteOn, sendBLENoteOff,
    sendBLEControlChange, sendBLEProgramChange,
    sendBLEPolyphonicAftertouch, sendBLEChannelAftertouch,
    sendBLEPitchBend,
    startBLECharacteristicStream
} from './libs/midi-ble/midi-ble.ts'
import { 
    connectToBLEDevice, 
    disconnectBLEDevice, 
    listCharacteristics, extractCharacteristics, extractMIDICharacteristic, watchCharacteristics,
    describeDevice 
} from './libs/midi-ble/ble-connection.ts' // disconnectDevice may be used for cleanup

import AudioTimer from './libs/audiobus/timing/timer.audio.js'
import MIDIDevice from './libs/audiobus/midi/midi-device.ts'
import SynthOscillator from './libs/audiobus/instruments/synth-oscillator.js'
import PolySynth from './libs/audiobus/instruments/poly-synth.js'
import NoteModel from './libs/audiobus/note-model.ts'

import { parseEdoScaleMicroTuningOctave } from './libs/pitfalls/ts/index.ts'
import { addKeyboardDownEvents } from './libs/keyboard.ts'
import { BLE_SERVICE_UUID_DEVICE_INFO, BLE_SERVICE_UUID_MIDI } from './libs/midi-ble/ble-constants.ts'

import jzz from 'jzz'

import * as MODES from './libs/audiobus/tuning/chords/modal-chords.js'
import * as CHORDS from './libs/audiobus/tuning/chords/chords.js'
import {createChord} from './libs/audiobus/tuning/chords/chords.js'
import * as INTERVALS from './libs/audiobus/tuning/intervals.js'
import { convertToIntervalArray } from './libs/audiobus/tuning/chords/describe-chord.ts'
import { TUNING_MODE_NAMES } from './libs/audiobus/tuning/scales.ts'
import { TransformerManager } from './libs/audiobus/transformers/transformer-manager.ts'
import { TransformerQuantise } from './libs/audiobus/transformers/transformer-quantise.ts'
import AudioCommand from './libs/audiobus/audio-command.ts'
import type { AudioCommandInterface } from './libs/audiobus/audio-command-interface.ts'
import { createAudioCommand } from './libs/audiobus/audio-command-factory.ts'
// import { createGraph } from './components/transformers-graph.ts'
import { createGraph } from './components/transformers-graph.tsx'
import AudioEvent from './libs/audiobus/audio-event.ts'

// import { AudioContext, BiquadFilterNode } from "standardized-audio-context"
const ALL_MIDI_CHANNELS = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15, 16]

// All connected MIDI Devices
const MIDIDevices:MIDIDevice[] = []

let transformerManager:TransformerManager
let timer:AudioTimer = null
let timeLastBarBegan = 0
let audioContext:AudioContext

// BLE devices and characteristics
// TODO: Move into a MIDIDevice wrapper to allow for multiple
// MIDI devices simultaneously
let bluetoothMIDICharacteristic:BluetoothRemoteGATTCharacteristic
let bluetoothDevice:BluetoothDevice | null
let bluetoothWatchUnsubscribes: Array<() => Promise<void>> = []
let bluetoothPacketQueue:Array<number>|undefined = []

let webMIDIEnabled:boolean = false
let selectedMIDIChannel:number = 1  // User-selected MIDI output channel (1-16)

// this is just a buffer for the onscreen keyboard
let onscreenKeyboardMIDIDevice:MIDIDevice

// Feed this for X amount of BARS
let buffer = []
let currentRecordingMeasure = 0

const BARS_TO_RECORD = 1
const NOTES_IN_CHORDS = 3 // -1

// visuals
let ui:UI = null
let synth:SynthOscillator|PolySynth = null


// For onscreen interactive keyboard
const keyboardKeys = ( new Array(128) ).fill("")
// Full keyboard with all notes including those we do not want the user to play
const ALL_KEYBOARD_NOTES = keyboardKeys.map((keyboardKeys,index)=> new NoteModel( index ))
// Grab a good sounding part (not too bassy, not too trebly)
const KEYBOARD_NOTES = ALL_KEYBOARD_NOTES.slice( 41, 94 )

const ONSCREEN_KEYBOARD_NAME = "SVG Keyboard"
const LETTER_KEYBOARD_NAME = "Keyboard"

let mictrotonalPitches = parseEdoScaleMicroTuningOctave(60, 3, "LLsLLLs", 2, 1)

let state

// this should be set per user
let intervalFormula = INTERVALS.IONIAN_INTERVALS

let rootNote = 0

/**
 * EVENT
 * MIDI Input received - delegate to classes
 * @param event 
 */
const onMIDIEvent = ( event, activeMIDIDevice, connectedMIDIDevice, index ) => {    
    // Now test each "Requested Event" and facilitate
    // loop through our queue of requested events...
    // document.body.innerHTML+= `${event.note.name} <br>`
    const note = event.note
    const { name, number, occtave, release } = note

    switch(event.type)
    {
        case "noteon":  
            const alreadyPlaying = activeMIDIDevice.noteOn( note )
            // ui.addCommand( command )
            if (!alreadyPlaying)
            {
                // here we add this note to the device map
                console.info("MIDI NOTE ON Event!", alreadyPlaying, {note, event, activeMIDIDevice, connectedMIDIDevice, index} )    
            }else{
                
                console.info("IGNORE MIDI NOTE ON Event!", alreadyPlaying, {note, event, activeMIDIDevice, connectedMIDIDevice, index} )    
            }
           
            break

        case "noteoff":
            console.info("MIDI NOTE OFF Event!", {event, activeMIDIDevice, connectedMIDIDevice, index} )
            // find the 
            // ui.removeCommand( command )
            activeMIDIDevice.noteOff( note )
            break
        
        // TODO: Don't ignore stuff like pitch bend
    }
}

/**
 * Connect to ALL MIDI Devices currently connected
 */
const connectToMIDIDevice = ( connectedMIDIDevice, index:number ) => {
    const device = new MIDIDevice( `${connectedMIDIDevice.manufacturer} ${connectedMIDIDevice.name}` )
    connectedMIDIDevice.addListener("noteon", event => onMIDIEvent( event, device, connectedMIDIDevice, index ), {channels:ALL_MIDI_CHANNELS })
    connectedMIDIDevice.addListener("noteoff", event => onMIDIEvent( event, device, connectedMIDIDevice, index ), {channels:ALL_MIDI_CHANNELS })
    // todo: pITCHBEND AND AFTERTOUCH
    // connectedMIDIDevice.addListener("noteoff", event => onMIDIEvent( event, device, connectedMIDIDevice, index ), {channels:ALL_MIDI_CHANNELS })

    ui.addDevice( connectedMIDIDevice, index )

    console.info("connectToMIDIDevices", { device, connectedMIDIDevice, index})

    return device
}

/**
 * EVENT:
 * Cannot Continue!?
 * @param reason String
 */
const onUltimateFailure = (reason:String) => {
    console.error("Serious Failure" , reason )
    ui.showError( reason, true )
}

/**
 * EVENT: 
 * MIDI IS available, let us check for MIDI devices connected
 * @param event 
 */
const onMIDIDevicesAvailable = (event) => {
    // Display available MIDI input devices
    if (WebMidi.inputs.length < 1) {
        ui.showError( "No MIDI devices connected", "Connect a USB or MIDI instrument", false )
    } else {
        // save a link to all connected MIDI devices
        WebMidi.inputs.forEach((device, index) => {
            // Monitor inputs from the MIDI devices attached
            const availableMIDIDevice = connectToMIDIDevice( device, index )
            MIDIDevices.push( availableMIDIDevice )
        })
    }
}

/**
 * EVENT: Buffer is full of data... restarting LOOP!
 */
const onRecordingMusicalEventsLoopBegin = ( activeAudioEvents ) => {

    if (activeAudioEvents.length > 0)
    {
        const musicalEvents = activeAudioEvents.map( audioEvent => {
            return audioEvent.clone( timeLastBarBegan )
        })
         console.info("Active musicalEvents", musicalEvents)
    }
}

const convertAudioCommandsToAudioEvents = ( commands:AudioCommandInterface[] ):AudioEvent[] => {
    return (commands ?? []).map( (command:AudioCommandInterface) => {
       return new AudioEvent( command, timer )
    })
}

const triggerAudioCommandsOnDevice = ( commands:AudioCommandInterface[] ) => {
    commands.forEach( command => {

        switch(command.type)
        {
            case Commands.NOTE_ON:  
                console.warn("Executing Audio Command: NOTE ON", command )
                noteOn( new NoteModel( command.number ) )
                break
            
            case Commands.NOTE_OFF:
                console.warn("Executing Audio Command: NOTE OFF", command )
                noteOff( new NoteModel( command.number ) )
                break

            default:
                console.error("UNKNOWN Audio Command", command.type, Commands )
        }
    })
}

/**
 * Called from MIDI Devices and on screen keyboard
 * @param noteModel The Note
 * @param fromDevice 
 */
const noteOn = (noteModel:NoteModel, velocity:number=1, fromDevice:string=ONSCREEN_KEYBOARD_NAME) => {
    const now = timer.now
  
    //console.info("Key pressed - send out MIDI", e )
    ui.noteOn( noteModel )
    onscreenKeyboardMIDIDevice.noteOn( noteModel, timer.now )
   
    // const detune = mictrotonalPitches.freqs[noteModel.noteNumber]
    // const microntonal = noteModel.clone()
    // microntonal.detune = detune

    if (synth)
    {
        synth.noteOn( noteModel, velocity )
        // synth.noteOn( microntonal, 1 )
        // synth.detune = detune
    }

    if (MIDIDevice.length > 0)
    {
        sendMIDINoteToAllDevices( fromDevice, noteModel, Commands.NOTE_ON,  1)
    }

    if (bluetoothMIDICharacteristic)
    {
        // Send actual note from keyboard to BLE MIDI device
        sendBLENoteOn( bluetoothMIDICharacteristic, selectedMIDIChannel, noteModel.noteNumber, 127, bluetoothPacketQueue )
            .then( result => {
                console.log('Sent MIDI NOTE ON to BLE device!', { note: noteModel.noteNumber, channel: selectedMIDIChannel, result } )
            })
            .catch( err => {
                console.error('Failed to send MIDI NOTE ON to BLE device!', { 
                    note: noteModel.noteNumber, 
                    channel: selectedMIDIChannel,
                    error: err && err.message ? err.message : String(err),
                    device: bluetoothMIDICharacteristic
                })
            })
    }
    console.log("Note ON", noteModel, velocity, {now} )
}

export const noteOff = (noteModel:NoteModel, velocity:number=1, fromDevice:string=ONSCREEN_KEYBOARD_NAME) => {
    const now = timer.now
    ui.noteOff( noteModel)
    onscreenKeyboardMIDIDevice.noteOff( noteModel, now )
    if (synth)
    {
        synth.noteOff( noteModel )
    }
    
    if (MIDIDevice.length > 0)
    {
        sendMIDINoteToAllDevices(fromDevice, noteModel, Commands.NOTE_OFF,  1)
    }
        
    if (bluetoothMIDICharacteristic)
    {
        // Send actual note from keyboard to BLE MIDI device
        sendBLENoteOff( bluetoothMIDICharacteristic, selectedMIDIChannel, noteModel.noteNumber, 0, bluetoothPacketQueue )
            .then( result => {
                console.log('Sent MIDI NOTE OFF to BLE device!', { note: noteModel.noteNumber, channel: selectedMIDIChannel, result } )
            })
            .catch( err => {
                console.error('Failed to send MIDI NOTE OFF to BLE device!', { 
                    note: noteModel.noteNumber, 
                    channel: selectedMIDIChannel,
                    error: err && err.message ? err.message : String(err),
                    device: bluetoothMIDICharacteristic
                })
            })

    } 
    
    console.log("Note OFF", noteModel, velocity, {now} )
}   

/**
 * EVEMT: Note On requested from onscreen keyboard / external keyboard
 * @param noteModel 
 */
const onNoteOnRequestedFromKeyboard = (noteModel:NoteModel, fromDevice:string=ONSCREEN_KEYBOARD_NAME ) => {
   
    const audioCommand:AudioCommand = createAudioCommand( Commands.NOTE_ON, noteModel, timer )
    if ( transformerManager.isQuantised )
    {
        // wait till timing event
        buffer.push(audioCommand)
        console.error("Note On DEFER buffer", buffer, { audioCommand, transformerManager} )
    }else{
        // dispatch NOW!
        // then when the time is right, we trigger the events
        const transformed:AudioCommandInterface[] = transformerManager.transform([audioCommand])
        const events = convertAudioCommandsToAudioEvents( transformed )
        const triggers = triggerAudioCommandsOnDevice(events)
        console.error("Note ON NOW", {audioCommand, transformed, events, triggers})
    }

    /*
       
    let notes:Array<NoteModel>

    // create some chords from this root node
    if ( state && state.get("useChords") ){
        const chord = createChord( ALL_KEYBOARD_NOTES, intervalFormula, noteModel.noteNumber, 0, NOTES_IN_CHORDS, true, true )
        const chordNotes = chord.map( (c:NoteModel) => c.number)
        const intervals = convertToIntervalArray( chordNotes )
        notes = chord
        console.log("Root", noteModel.noteNumber)
        console.log("Chord",noteModel, chord, chordNotes)
        console.log("Intervals?", intervals, intervalFormula)
        console.log("Chord Ionian",noteModel, MODES.createIonianChord( ALL_KEYBOARD_NOTES, noteModel.noteNumber, 0, 3 ) )
    }else{
        notes = [noteModel]
    }
   
    // play all activated notes
    notes.forEach( noteModel => noteOn( noteModel, fromDevice ))
    console.info("onNoteOnRequestedFromKeyboard, Microtonal Pitch", noteModel, mictrotonalPitches.freqs[noteModel.noteNumber])
    */
}

/**
 * EVENT : Note Off requested from onscreen keyboard / external keyboard
 * @param noteModel:NoteModel 
 */
const onNoteOffRequestedFromKeyboard = (noteModel:NoteModel, fromDevice:string=ONSCREEN_KEYBOARD_NAME) => {

    // create an AudioCommand for this NoteModel
    const audioCommand:AudioCommand = createAudioCommand( Commands.NOTE_OFF, noteModel, timer )

    if ( transformerManager.isQuantised )    
    {
        buffer.push(audioCommand)
        console.info("AudioCommand created - waiting for next tick", audioCommand )
    }else{
        const transformed:AudioCommandInterface[] = transformerManager.transform([audioCommand])
        const events = convertAudioCommandsToAudioEvents( transformed )
        const triggers = triggerAudioCommandsOnDevice(events)
        console.info("AudioCommand triggered immediately", {audioCommand, transformerManager, events, triggers} )
    }

    /*
    let notes:Array<NoteModel>

    if ( state && state.get("useChords") ){
    // FIXME: replace zero with findRotation. -1 if is outside of the scale.
        const chord = createChord( ALL_KEYBOARD_NOTES, intervalFormula, noteModel.noteNumber, 0, NOTES_IN_CHORDS, true, true )
        const chordNotes = chord.map( (c:NoteModel) => c.number)
        const intervals = convertToIntervalArray( chordNotes )
        notes = chord
        console.log("Root", noteModel.noteNumber)
        console.log("Chord",noteModel, chord, chordNotes)
        console.log("Intervals?", intervals, intervalFormula)
        console.log("Chord Ionian",noteModel, MODES.createIonianChord( ALL_KEYBOARD_NOTES, noteModel.noteNumber, 0, 3 ) )
    }else{
        notes = [noteModel]
    }

    // play all activated notes
    notes.forEach( noteModel => noteOff( noteModel, fromDevice ))
    */
}

const executeQueueAndClear = (queue:AudioCommand[]) => {

    // act on all data in the buffer...
    queue.forEach( (audioCommand:AudioCommand, index:number) => {
        const transformed:AudioCommandInterface[] = transformerManager.transform([audioCommand])
        const events = convertAudioCommandsToAudioEvents( transformed )
        const triggers = triggerAudioCommandsOnDevice(events)
        console.info("AudioCommand triggered in time domain", {audioCommand, transformerManager, events, triggers, timer} )
    })

    // TODO: clear entire buffer
    queue.length = 0
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

    // Loop through all commands and see if they are ready to action yet
//    const updates = midiCommandRequests.map( (command, index) => {
//         const ready = command.update()
//         return ready
//     })

    ui.updateClock( values )

    // If bar is at zero point we check to see if the buffer
    // needs to be reset....
    // if ( divisionsElapsed===0 ){
    //     // ui.noteOn( )
    //     currentRecordingMeasure++

    //     if (currentRecordingMeasure > BARS_TO_RECORD)
    //     {
    //         currentRecordingMeasure = 0
    //         timeLastBarBegan = timer.now
    //         onRecordingMusicalEventsLoopBegin([...buffer])
    //         buffer = []
    //         // console.info("TICK:BUFFER RESET", values )
    //     }else{
    //         // console.info("TICK:IGNORE")
    //     }
    // }else{
    //     //  console.info("TICK:", {bar, divisionsElapsed})
    // }


    // We have got quantised data so let's run the transformers
    // 
   
    if ( transformerManager.isQuantised && buffer.length > 0 )
    {
        // then when the time is right, we trigger the events
        //const transformed = transformerManager.transform(audioCommand)
       
        if (divisionsElapsed % transformerManager.quantiseFidelity === 0)
        {
            console.info("TICK:QUANTISED", {divisionsElapsed, quantisationFidelity:transformerManager.quantiseFidelity})
            executeQueueAndClear(buffer)
        }else{
            console.info("TICK:IGNORED", {divisionsElapsed, quantisationFidelity:transformerManager.quantiseFidelity})
        }
        
    }else{
        // console.error("Metronome ignored as no events to trigger")
    }




    // let hasUpdates = false
    // // check to see if any events have happened since
    // // the last bar
    // const updates = MIDIDevices.map( (midiDevice, index) => {
    //     const deviceCommandsReadyToTrigger = midiDevice.update( timer.now, divisionsElapsed )
        
    //     if (deviceCommandsReadyToTrigger.length > 0)
    //     {
    //         hasUpdates = true
    //         // create copies of the triggers and ensure they start at same position in time
    //         buffer.push(...deviceCommandsReadyToTrigger)
    //         console.info(index, "TICK:MusicalEvents", midiDevice.name, {deviceCommandsReadyToTrigger} )
    //     }
        
    //     return deviceCommandsReadyToTrigger
    // })

    // console.info("TICK:MIDIDevices", MIDIDevices )

    // Do we have any events that we need to trigger in this period?
    // if (hasUpdates)
    // {
    //     console.info("TICK:hasUpdates", {buffer, updates, MIDIDevices} )
    //     // UPDATE UI with all midi events
    //     // that are going to be triggered at this stage
    // }else{
    //     // console.info("TICK:NO UPDATES", updates )
    // }

    // save all new musical events in the buffer
    // buffer.push()

    // now action the updates
    // console.info("TICK", values )
}


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
    bluetoothWatchUnsubscribes = []
    
    // Disconnect the GATT server
    if (bluetoothDevice) {
        disconnectBLEDevice(bluetoothDevice)
    }
    
    // Clear references
    bluetoothMIDICharacteristic = undefined as any
    bluetoothDevice = null
    
    // Update UI
    ui.showBluetoothStatus('✓ Disconnected from device')
    ui.whenBluetoothDeviceRequested(handleBluetoothConnect)
}

/**
 * Connect to BLE device and set up MIDI
 */
const handleBluetoothConnect = async () => {
    try {

        ui.showBluetoothStatus('Opening device chooser...')
       
        const result = await connectToBLEDevice()

        console.info('BLE Connection Result', result  )

        // Check to see if everything is ok
        if (!result || !result.characteristic) 
        {
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
        startBLECharacteristicStream( bluetoothMIDICharacteristic, 10, bluetoothPacketQueue )

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
        const unsubs = await watchCharacteristics(availableMIDIBluetoothCharacteristics, (capability, value)=>{
            // capability: CapabilityCharacteristic, value: DataView
            const data = new Uint8Array(value.buffer)
            console.log('Characteristic data received', { capability, data, value })
            // check to see if it is MIDI data!
            switch (capability.uuid)
            {
                case BLE_SERVICE_UUID_MIDI:
                    // MIDI Data received over BLE!
                    // parse MIDI data
                    const midiData = jzz.MIDI(data)

                    console.log('MIDI Data received over BLE', {data, midiData} )
                    break

                default:
                    console.log('Non-MIDI Data received over BLE', data )
            }
        })

        // Store device reference for later disconnect
        bluetoothWatchUnsubscribes = unsubs

        console.info("Bluetooth Device connected",{ result}, describeDevice( bluetoothDevice ) )

        ui.showBluetoothStatus(`✓ Connected to ${bluetoothDevice.name || 'Unknown Device'}`)
        // Change button to disconnect mode
        ui.whenBluetoothDeviceRequested(disconnectBluetoothDevice)

        ui.setBLEManualInputVisible(true)

    } catch (error: any) {

        ui.showBluetoothStatus(`✗ BLE Error: ${error.message || 'Failed to connect'}`)
        ui.showError( `Bluetooth connection could not be established: ${error.message || 'Failed to connect'}` )
        console.error("`Bluetooth connection could not be established",error )
    }
}

// also now monitor for MIDI inputs...
// WebMIDI will be enabled/disabled with the UI toggle button
const toggleWebMIDI = async () => {
    if (!webMIDIEnabled) {
        try {
            await WebMidi.enable()
            webMIDIEnabled = true
            ui.setWebMIDIButtonText('Disable WebMIDI')
            onMIDIDevicesAvailable(undefined as any)
        } catch (err:any) {
            onUltimateFailure(err)
        }
    } else {
        try {
            WebMidi.disable()
            webMIDIEnabled = false
            ui.setWebMIDIButtonText('Enable WebMIDI')
            // clear any connected MIDIDevices
            MIDIDevices.length = 0
            ui.inputs.innerHTML = ''
            ui.outputs.innerHTML = ''
        } catch (err:any) {
            console.warn('Failed to disable WebMIDI', err)
        }
    }
}
const parseToUint8 = (s) => {
    if (!s) return new Uint8Array()
    const nums = s.split(',').map(x=>x.trim()).filter(x=>x.length>0).map(x=>Number(x))
    const bytes = nums.map(n => ((n|0) & 0xFF))
    return new Uint8Array(bytes)
}

/**
 * AudioContext is now available
 * @param event 
 */
const onAudioContextAvailable = async (event) => {

    audioContext = new AudioContext() 
    synth = new PolySynth( audioContext )
    // synth = new SynthOscillator( audioContext )
    synth.output.connect( audioContext.destination )
    // synth.addTremolo(0.5)

    // this handles the audio timing
    timer = new AudioTimer( audioContext )

    // Front End UI -------------------------------
    ui = new UI( ALL_KEYBOARD_NOTES, onNoteOnRequestedFromKeyboard, onNoteOffRequestedFromKeyboard )
    ui.setTempo( timer.BPM )
    ui.whenTempoChangesRun( (tempo:number) => timer.BPM = tempo )
    ui.whenBluetoothDeviceRequested( handleBluetoothConnect ) 
    ui.whenWebMIDIToggled(toggleWebMIDI)
    ui.whenMIDIChannelSelected((channel:number) => {
        selectedMIDIChannel = channel
        console.log(`[MIDI Channel] Selected channel ${channel}`)
    })

    ui.whenUserRequestsManualBLECodes((rawString:string) => { 
        /* parse rawString into numbers and create Uint8Array, then send to BLE */ 
       const t = parseToUint8(rawString)
       console.info("BLE MANUAL SEND", t)
    })

    // ui.whenNewScaleIsSelected( (scaleNName:string, select:HTMLElement ) => {
    //     console.log("New scale selected:", scaleNName)
    //     // state.set( scaleNName, true )

    //     // ensure we turn all notes off before we change
    //     // otherwise any currently active notes may stick fprever

    //     intervalFormula = INTERVALS.MODAL_SCALES[TUNING_MODE_NAMES.indexOf(scaleNName) ]
    // })

    // ui.whenNewRootIsSelected( (root: number, select: HTMLElement) => {
    //     console.log("New root selected:", root)
    //     rootNote = root
    // })

    ui.onDoubleClick( () => {
        synth.setRandomTimbre()
    })

    onscreenKeyboardMIDIDevice = new MIDIDevice(ONSCREEN_KEYBOARD_NAME)
    
    MIDIDevices.push( onscreenKeyboardMIDIDevice )

    // now watch for keydowns and tie into MIDI
    addKeyboardDownEvents( (command:string, key:string, value:Number ) => {
        switch(command)
        {
            case Commands.PLAYBACK_TOGGLE:
                timer.toggleTimer()
                ui.setPlaying( timer.isRunning )
                break

            case Commands.PLAYBACK_START:
                timer.startTimer()
                ui.setPlaying( timer.isRunning )
                break

            case Commands.PLAYBACK_STOP:
                timer.stopTimer()
                ui.setPlaying( timer.isRunning )
                break
            
            case Commands.TEMPO_TAP:
                timer.tapTempo()
                ui.setTempo( timer.BPM )
                break
            
            case Commands.TEMPO_INCREASE:
                timer.BPM++
                ui.setTempo( timer.BPM )
                break

            case Commands.TEMPO_DECREASE:
                timer.BPM--
                ui.setTempo( timer.BPM )
                break
            
            case Commands.PITCH_BEND:
                break
            
            case Commands.NOTE_ON:
                onNoteOnRequestedFromKeyboard( new NoteModel( value ), LETTER_KEYBOARD_NAME )
                break

            case Commands.NOTE_OFF:
                onNoteOffRequestedFromKeyboard( new NoteModel( value ), LETTER_KEYBOARD_NAME )
                break
        }
    })
    
    // STATE MANAGEMENT -------------------------------
    // Get state from session and URL
    const elementMain = document.querySelector('main')
    state = State.getInstance(elementMain)
    state.addEventListener( event => {
        const bookmark = state.asURI
        console.info(bookmark, "State Changed", event ) 
    })

    //state.setDefaults(defaultOptions)
    state.loadFromLocation( DEFAULT_OPTIONS )

    // updates the URL with the current state (true - encoded)
    state.updateLocation()
    
    // Update UI - this will check all the inputs according to our state	
    state.updateFrontEnd()
    

    // state.set( value, button.checked )

    // This loads the AudioTool stuff
    const isPreviousUser = false // loadSavedValues()

    if (isPreviousUser)
    {
        // WELCOME BACK!
        // await handleAutoConnect()
    }

    // connect to audioTool and start a new project
    // await handleConnectWithPAT( (document.getElementById('pat-input') as HTMLInputElement).value.trim() )

    // Hackday hack!
    transformerManager = new TransformerManager()
    window.transformerManager = transformerManager

    createGraph('#graph')

    // start the clock going
    timer.startTimer( onTick )
}

const sendMIDINoteToAllDevices = (fromDevice:String, noteModel:NoteModel , action="noteOn", velocity=1) => {
    MIDIDevices.forEach( device => {

        if ( device.id !== fromDevice )
        {
            device[action]( noteModel, audioContext.currentTime, velocity) 
        }
    })
}

// Wait for user to initiate an action so that we can use AudioContext
document.addEventListener("mousedown", onAudioContextAvailable, {once:true} )

// load and complete some tests!
// import { parseEdoScaleMicroTuningOctave } from "index.ts"
// console.warn( "TEST", mictrotonalPitches, 60, 3, "LLsLLLs", 2, 1 )