/**
 * This is a WebMIDI Device output adapter
 * that takes audio commands and converts them
 * into WebMIDI messages and sends them to a connected device
 */

import { ALL_MIDI_CHANNELS } from "../midi/midi-channels.ts"
import { Output, WebMidi } from "webmidi"
import type { IAudioOutput } from "./output-interface.ts"

export const WEBMIDI_OUTPUT_ID = "WebMIDI_Output"

const DEFAULT_OPTIONS = {
	midiOutput: Output, 
	channels:ALL_MIDI_CHANNELS
}

export default class OutputWebMIDIDevice extends EventTarget implements IAudioOutput {
	
	static ID:number = 0

	#uuid: string
	#midiOutput: Output | undefined
	#activeNotes: Set<number> = new Set()

	#options

	get uuid(): string {
		return this.#uuid
	}

	get name(): string {
		return WEBMIDI_OUTPUT_ID
	}

	get description(): string {
		return "Sends MIDI messages to a connected WebMIDI device"
	}

	get isConnected(): boolean {
		return this.#midiOutput !== undefined
	}

	get output(): Output | undefined {
		return this.#midiOutput
	}

	constructor(options=DEFAULT_OPTIONS) {
		super()
		this.#uuid = "Output-WebMIDI-"+(OutputWebMIDIDevice.ID++)
		this.#options = {...DEFAULT_OPTIONS, ...options}
	}

	/**
	 * Enable WebMIDI and connect to all available devices
	 */
	async connect(): Promise<void> {
		try {
			await WebMidi.enable()
			WebMidi.outputs.forEach((device, index) => {
				// FIXME: Check config and only enable devices that
				// we are looking for rather than every single one
			
			})
			
		} catch (error: any) {
			console.error("[WebMIDI Output] Failed to enable WebMIDI", error)
			throw error
		}
	}

	/**
	 * 
	 */
	async disconnect(): Promise<void> {
	
		
	}



	/**
	 * Get the set of currently active note numbers
	 */
	getActiveNotes(): Set<number> {
		return new Set(this.#activeNotes)
	}

	/**
	 * Clear all active notes tracking
	 */
	clearActiveNotes(): void {
		this.#activeNotes.clear()
	}

	/**
	 * Set the MIDI channel for outgoing messages (1-16)
	 */
	setChannel(channel: number|number[]): void {
		this.#options.channels = channel
	}

	/**
	 * Send Note On message to WebMIDI device
	 */
	noteOn(noteNumber: number, velocity: number = 127): void {
		if (!this.#midiOutput) {
			console.warn("[WebMIDI Output] No output device available for Note On")
			return
		}

		this.#activeNotes.add(noteNumber)

		try {
			this.#midiOutput.sendNoteOn(
				noteNumber,
				{ 
					attack:velocity / 127, 
					channels:this.#options.channels 
				}
			)
			console.info("[WebMIDI Output] Note On sent", {
				note: noteNumber,
				velocity,
				channel: this.#options.channels
			})
		} catch (err) {
			console.error("[WebMIDI Output] Failed to send Note On", {
				note: noteNumber,
				velocity,
				channel: this.#options.channels,
				error: err && err instanceof Error ? err.message : String(err)
			})
		}
	}

	/**
	 * Send Note Off message to WebMIDI device
	 */
	noteOff(noteNumber: number): void {
		if (!this.#midiOutput) {
			console.warn("[WebMIDI Output] No output device available for Note Off")
			return
		}

		this.#activeNotes.delete(noteNumber)

		try {
			this.#midiOutput.sendNoteOff(
				noteNumber,
				{ channels:this.#options.channels }
			)
			console.info("[WebMIDI Output] Note Off sent", {
				note: noteNumber,
				channel: this.#options.channels
			})
		} catch (err) {
			console.error("[WebMIDI Output] Failed to send Note Off", {
				note: noteNumber,
				channel: this.#options.channels,
				error: err && err instanceof Error ? err.message : String(err)
			})
		}
	}

	/**
	 * Send All Notes Off (CC#123) to clear all active notes
	 */
	allNotesOff(): void {
		if (!this.#midiOutput) {
			console.warn("[WebMIDI Output] No output device available for All Notes Off")
			return
		}

		try {
			this.#midiOutput.sendAllNotesOff(
				{ channels:this.#options.channels }
			)
			console.info("[WebMIDI Output] All Notes Off sent", {
				channel: this.#options.channels
			})
			this.#activeNotes.clear()
		} catch (err) {
			console.error("[WebMIDI Output] Failed to send All Notes Off", {
				channel: this.#options.channels,
				error: err && err instanceof Error ? err.message : String(err)
			})
		}
	}

	/**
	 * Send Control Change message
	 */
	sendControlChange(controlNumber: number, value: number): void {
		if (!this.#midiOutput) {
			console.warn("[WebMIDI Output] No output device available for Control Change")
			return
		}

		try {
			this.#midiOutput.sendControlChange(
				controlNumber,
				Math.round((value / 127) * 127),
				{ channels:this.#options.channels}
			)
			console.info("[WebMIDI Output] Control Change sent", {
				controlNumber,
				value,
				channel: this.#options.channels
			})
		} catch (err) {
			console.error("[WebMIDI Output] Failed to send Control Change", {
				controlNumber,
				value,
				channel: this.#options.channels,
				error: err && err instanceof Error ? err.message : String(err)
			})
		}
	}

	/**
	 * Send Program Change message
	 */
	sendProgramChange(program: number): void {
		if (!this.#midiOutput) {
			console.warn("[WebMIDI Output] No output device available for Program Change")
			return
		}

		try {
			this.#midiOutput.sendProgramChange(
				program,
				{ channels:this.#options.channels}
			)
			console.info("[WebMIDI Output] Program Change sent", {
				program,
				channel: this.#options.channels
			})
		} catch (err) {
			console.error("[WebMIDI Output] Failed to send Program Change", {
				program,
				channel: this.#options.channels,
				error: err && err instanceof Error ? err.message : String(err)
			})
		}
	}

	/**
	 * Send Polyphonic Aftertouch (Key Pressure)
	 */
	sendPolyphonicAftertouch(note: number, pressure: number): void {
		if (!this.#midiOutput) {
			console.warn("[WebMIDI Output] No output device available for Polyphonic Aftertouch")
			return
		}

		try {
			this.#midiOutput.sendKeyAftertouch(
				note,
				pressure / 127,
				{ channels:this.#options.channels}
			)
			console.info("[WebMIDI Output] Polyphonic Aftertouch sent", {
				note,
				pressure,
				channel: this.#options.channels
			})
		} catch (err) {
			console.error("[WebMIDI Output] Failed to send Polyphonic Aftertouch", {
				note,
				pressure,
				channel: this.#options.channels,
				error: err && err instanceof Error ? err.message : String(err)
			})
		}
	}

	/**
	 * Send Channel Aftertouch (Channel Pressure)
	 */
	sendChannelAftertouch(pressure: number): void {
		if (!this.#midiOutput) {
			console.warn("[WebMIDI Output] No output device available for Channel Aftertouch")
			return
		}

		try {
			this.#midiOutput.sendChannelAftertouch(
				pressure / 127,
				{ channels:this.#options.channels}
			)
			console.info("[WebMIDI Output] Channel Aftertouch sent", {
				pressure,
				channel: this.#options.channels
			})
		} catch (err) {
			console.error("[WebMIDI Output] Failed to send Channel Aftertouch", {
				pressure,
				channel: this.#options.channels,
				error: err && err instanceof Error ? err.message : String(err)
			})
		}
	}

	/**
	 * Send Pitch Bend message
	 */
	sendPitchBend(value: number): void {
		if (!this.#midiOutput) {
			console.warn("[WebMIDI Output] No output device available for Pitch Bend")
			return
		}

		try {
			this.#midiOutput.sendPitchBend(
				value / 8192 - 1,
				{ channels:this.#options.channels}
			)
			console.info("[WebMIDI Output] Pitch Bend sent", {
				value,
				channel: this.#options.channels
			})
		} catch (err) {
			console.error("[WebMIDI Output] Failed to send Pitch Bend", {
				value,
				channel: this.#options.channels,
				error: err && err instanceof Error ? err.message : String(err)
			})
		}
	}

	/**
	 * Disconnect and cleanup
	 */
	destroy(): void {
		this.allNotesOff()
		this.#midiOutput = undefined
		this.#activeNotes.clear()
	}
}
