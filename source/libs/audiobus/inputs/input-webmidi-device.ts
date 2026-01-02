/**
 * This is a WEB MIDI Device adapter
 * that takes MIDI events and converts them
 * into AudioCommands and dispatches them
 */

import AbstractInput from "./abstract-input"
import AudioCommand from "../audio-command"
import { CONTROL_CHANGE, NOTE_OFF, NOTE_ON } from "../../../commands"
import { WebMidi } from "webmidi"

export const WEBMIDI_INPUT_ID = "WEBMIDI_INPUT_ID"

export default class InputWebMIDIDevice extends AbstractInput {

	get name():string {
		return WEBMIDI_INPUT_ID
	}

	constructor( options={} ) { 
		super(options)
		this.connect()
	}

	async connect(){
		 try {
			await WebMidi.enable()
			// FIXME: only connect to one device!
			WebMidi.inputs.forEach((device, index) => {
				device.addListener("noteon", event => this.onMIDIEvent(event, device, connectedMIDIDevice, index), { channels: ALL_MIDI_CHANNELS })
				device.addListener("noteoff", event => this.onMIDIEvent(event, device, connectedMIDIDevice, index), { channels: ALL_MIDI_CHANNELS })
				device.addListener("controlchange", event => this.onMIDIEvent(event, device, connectedMIDIDevice, index), { channels: ALL_MIDI_CHANNELS })
				// todo: PITCHBEND AND AFTERTOUCH
			})
		} catch (error) {
			console.error('WebMIDI could not be established:', error)
		}
	}

	async disconnect() {
		await WebMidi.disable()
	}

	/**
	 * WebMIDI Device has dispatched an event
	 * Convert it into an AudioCommand and dispatch
	 * 
	 * @param event 
	 * @param device 
	 * @param connectedMIDIDevice 
	 * @param index 
	 */
	onMIDIEvent(event: any, device: any, connectedMIDIDevice: any, index: any) {
		const note = event.note
    	const { number } = note
		const deviceName = `${WEBMIDI_INPUT_ID} ${connectedMIDIDevice.manufacturer} ${connectedMIDIDevice.name}`

		const command = new AudioCommand()
		command.value = number
		command.from = deviceName
		// command.text = key

		switch (event.type) {
			case "noteon":
				const alreadyPlaying = connectedMIDIDevice.noteOn(note)
				if (!alreadyPlaying) {
					// Route through the transformation/scheduling pipeline
					// const noteModel = new NoteModel(number)
					// onNoteOnRequestedFromDevice(noteModel, deviceName)
					console.info("MIDI NOTE ON Event!", alreadyPlaying, { note, event, connectedMIDIDevice, index })
				} else {
					console.info("IGNORE MIDI NOTE ON Event!", alreadyPlaying, { note, event, connectedMIDIDevice, index })
				}

				command.type = NOTE_ON

				break

			case "noteoff":
				console.info("MIDI NOTE OFF Event!", { event, connectedMIDIDevice, index })
				// Route through the transformation/scheduling pipeline
				// const noteModel = new NoteModel(number)
				// onNoteOffRequestedFromDevice(noteModel, deviceName)
				// activeMIDIDevice.noteOff(note)
				command.type = NOTE_OFF
		
				break

			case "controlchange":
				console.info("MIDI CC Event!", {
					controller: event.controller.number,
					value: event.value,
					rawValue: event.rawValue,
					event,
					connectedMIDIDevice,
					index
				})
				command.type = CONTROL_CHANGE
				break

			// TODO: Don't ignore stuff like pitch bend
		}
		this.dispatch(command)
	}
}