/**
 * This is a BLE MIDI Device output adapter
 * that takes audio commands and converts them
 * into BLE MIDI messages and sends them to a connected device
 */
import {
	sendBLENoteOn, sendBLENoteOff,
	sendBLEControlChange, sendBLEProgramChange,
	sendBLEPolyphonicAftertouch, sendBLEChannelAftertouch,
	sendBLEPitchBend, sendBLEAllNoteOff
} from "../../midi-ble/midi-ble.ts"

import type { IAudioOutput } from "./output-interface.ts"
import type NoteModel from "../note-model.ts"

export const BLE_OUTPUT_ID = "BLE"

export default class OutputBLEMIDIDevice extends EventTarget implements IAudioOutput {
	
	#characteristic: BluetoothRemoteGATTCharacteristic | undefined
	#selectedMIDIChannel: number = 1
	#packetQueue: Array<number> = []
	#activeNotes: Set<number> = new Set()

	get name(): string {
		return BLE_OUTPUT_ID
	}

	get isConnected(): boolean {
		return this.#characteristic !== undefined
	}

	constructor(characteristic?: BluetoothRemoteGATTCharacteristic, channel: number = 1) {
		super()
		if (characteristic)
		{
			this.setCharacteristic(characteristic)
		}else{
			console.error("[BLE Output] No characteristic provided")
		}
		this.#selectedMIDIChannel = channel
	}

	/**
	 * Set the BLE characteristic for sending MIDI data
	 */
	setCharacteristic(characteristic: BluetoothRemoteGATTCharacteristic): void {
		this.#characteristic = characteristic
	}

	/**
	 * Set the MIDI channel for outgoing messages (1-16)
	 */
	setChannel(channel: number): void {
		if (channel >= 1 && channel <= 16) {
			this.#selectedMIDIChannel = channel
		}else{
			throw Error("Invalid MIDI channel number")
		}
	}

	/**
	 * FIXME: Get the set of currently active note numbers
	 */
	getActiveNotes(): Set<number> {
		return new Set(this.#activeNotes)
	}


	/**
	 * Send Note On message to BLE MIDI device
	 */
	noteOn(note: NoteModel, velocity: number = 127): void {
		if (!this.#characteristic) {
			console.warn("[BLE Output] No characteristic available for Note On")
			return
		}

		const noteNumber = note.noteNumber
		this.#activeNotes.add(noteNumber)

		sendBLENoteOn(
			this.#characteristic,
			this.#selectedMIDIChannel,
			noteNumber,
			velocity,
			this.#packetQueue
		)
		.then((result) => {
			console.info("[BLE Output] Note On sent", {
				note: noteNumber,
				velocity,
				channel: this.#selectedMIDIChannel,
				result
			})
		})
		.catch((err) => {
			console.error("[BLE Output] Failed to send Note On", {
				note: noteNumber,
				velocity,
				channel: this.#selectedMIDIChannel,
				error: err && err.message ? err.message : String(err)
			})
		})
	}

	/**
	 * Send Note Off message to BLE MIDI device
	 */
	noteOff(note: NoteModel): void {
		if (!this.#characteristic) {
			console.warn("[BLE Output] No characteristic available for Note Off")
			return
		}

		const noteNumber = note.noteNumber
		this.#activeNotes.delete(noteNumber)

		sendBLENoteOff(
			this.#characteristic,
			this.#selectedMIDIChannel,
			noteNumber,
			0,
			this.#packetQueue
		)
		.then((result) => {
			console.info("[BLE Output] Note Off sent", {
				note: noteNumber,
				channel: this.#selectedMIDIChannel,
				result
			})
		})
		.catch((err) => {
			console.error("[BLE Output] Failed to send Note Off", {
				note: noteNumber,
				channel: this.#selectedMIDIChannel,
				error: err && err.message ? err.message : String(err)
			})
		})
	}

	/**
	 * Send All Notes Off (CC#123) to clear all active notes
	 */
	allNotesOff(): void {
		if (!this.#characteristic) {
			console.warn("[BLE Output] No characteristic available for All Notes Off")
			return
		}

		sendBLEAllNoteOff(
			this.#characteristic,
			this.#selectedMIDIChannel,
			123,
			0,
			this.#packetQueue
		)
		.then((result) => {
			console.info("[BLE Output] All Notes Off sent", {
				channel: this.#selectedMIDIChannel,
				result
			})
			this.#activeNotes.clear()
		})
		.catch((err) => {
			console.error("[BLE Output] Failed to send All Notes Off", {
				channel: this.#selectedMIDIChannel,
				error: err && err.message ? err.message : String(err)
			})
		})
	}

	/**
	 * Send Control Change message
	 */
	sendControlChange(controlNumber: number, value: number): void {
		if (!this.#characteristic) {
			console.warn("[BLE Output] No characteristic available for Control Change")
			return
		}

		sendBLEControlChange(
			this.#characteristic,
			this.#selectedMIDIChannel,
			controlNumber,
			value,
			this.#packetQueue
		)
		.then((result) => {
			console.info("[BLE Output] Control Change sent", {
				controlNumber,
				value,
				channel: this.#selectedMIDIChannel,
				result
			})
		})
		.catch((err) => {
			console.error("[BLE Output] Failed to send Control Change", {
				controlNumber,
				value,
				channel: this.#selectedMIDIChannel,
				error: err && err.message ? err.message : String(err)
			})
		})
	}

	/**
	 * Send Program Change message
	 */
	sendProgramChange(program: number): void {
		if (!this.#characteristic) {
			console.warn("[BLE Output] No characteristic available for Program Change")
			return
		}

		sendBLEProgramChange(
			this.#characteristic,
			this.#selectedMIDIChannel,
			program,
			this.#packetQueue
		)
		.then((result) => {
			console.info("[BLE Output] Program Change sent", {
				program,
				channel: this.#selectedMIDIChannel,
				result
			})
		})
		.catch((err) => {
			console.error("[BLE Output] Failed to send Program Change", {
				program,
				channel: this.#selectedMIDIChannel,
				error: err && err.message ? err.message : String(err)
			})
		})
	}

	/**
	 * Send Polyphonic Aftertouch (Key Pressure)
	 */
	sendPolyphonicAftertouch(note: number, pressure: number): void {
		if (!this.#characteristic) {
			console.warn("[BLE Output] No characteristic available for Polyphonic Aftertouch")
			return
		}

		sendBLEPolyphonicAftertouch(
			this.#characteristic,
			this.#selectedMIDIChannel,
			note,
			pressure,
			this.#packetQueue
		)
		.then((result) => {
			console.info("[BLE Output] Polyphonic Aftertouch sent", {
				note,
				pressure,
				channel: this.#selectedMIDIChannel,
				result
			})
		})
		.catch((err) => {
			console.error("[BLE Output] Failed to send Polyphonic Aftertouch", {
				note,
				pressure,
				channel: this.#selectedMIDIChannel,
				error: err && err.message ? err.message : String(err)
			})
		})
	}

	/**
	 * Send Channel Aftertouch (Channel Pressure)
	 */
	sendChannelAftertouch(pressure: number): void {
		if (!this.#characteristic) {
			console.warn("[BLE Output] No characteristic available for Channel Aftertouch")
			return
		}

		sendBLEChannelAftertouch(
			this.#characteristic,
			this.#selectedMIDIChannel,
			pressure,
			this.#packetQueue
		)
		.then((result) => {
			console.info("[BLE Output] Channel Aftertouch sent", {
				pressure,
				channel: this.#selectedMIDIChannel,
				result
			})
		})
		.catch((err) => {
			console.error("[BLE Output] Failed to send Channel Aftertouch", {
				pressure,
				channel: this.#selectedMIDIChannel,
				error: err && err.message ? err.message : String(err)
			})
		})
	}

	/**
	 * Send Pitch Bend message
	 */
	sendPitchBend(lsb: number, msb: number): void {
		if (!this.#characteristic) {
			console.warn("[BLE Output] No characteristic available for Pitch Bend")
			return
		}

		sendBLEPitchBend(
			this.#characteristic,
			this.#selectedMIDIChannel,
			lsb,
			msb,
			this.#packetQueue
		)
		.then((result) => {
			console.info("[BLE Output] Pitch Bend sent", {
				lsb,
				msb,
				channel: this.#selectedMIDIChannel,
				result
			})
		})
		.catch((err) => {
			console.error("[BLE Output] Failed to send Pitch Bend", {
				lsb,
				msb,
				channel: this.#selectedMIDIChannel,
				error: err && err.message ? err.message : String(err)
			})
		})
	}

	/**
	 * Clear all active notes tracking
	 */
	clearActiveNotes(): void {
		this.#activeNotes.clear()
	}

	/**
	 * Disconnect and cleanup
	 */
	destroy(): void {
		this.allNotesOff()
		this.#characteristic = undefined
		this.#activeNotes.clear()
	}
}
