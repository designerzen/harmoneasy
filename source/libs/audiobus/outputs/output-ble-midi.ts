/**
 * BLE MIDI Output - Send MIDI to Bluetooth Low Energy devices
 * Implements the standard MIDI over Bluetooth Low Energy protocol
 */

import type { IAudioOutput } from "./output-interface.ts"
import type { IAudioCommand } from "../audio-command.ts"

// BLE MIDI Service and Characteristic UUIDs
const BLE_MIDI_SERVICE_UUID = "03b80e5a-ede8-4b33-a751-6ce34ec4c700"
const BLE_MIDI_CHARACTERISTIC_UUID = "7772e5db-3868-4112-a1a9-f2669d106d8c"

export default class OutputBLEMIDI implements IAudioOutput {
	private device: BluetoothDevice | null = null
	private server: BluetoothRemoteGATTServer | null = null
	private characteristic: BluetoothRemoteGATTCharacteristic | null = null
	private activeNotes: Set<number> = new Set()
	private timestampBytes: number = 0 // For BLE MIDI timestamp header

	async connect(): Promise<void> {
		try {
			// Request Bluetooth device with MIDI service
			this.device = await (navigator as any).bluetooth.requestDevice({
				filters: [{ services: [BLE_MIDI_SERVICE_UUID] }],
				optionalServices: [],
			})

			console.log(`Connected to BLE device: ${this.device.name}`)

			// Connect to GATT server
			this.server = await this.device.gatt?.connect()
			if (!this.server) throw new Error("Failed to connect to GATT server")

			// Get MIDI service
			const service = await this.server.getPrimaryService(BLE_MIDI_SERVICE_UUID)
			this.characteristic = await service.getCharacteristic(BLE_MIDI_CHARACTERISTIC_UUID)

			console.log("Connected to BLE MIDI service")
		} catch (error) {
			console.error("Failed to connect to BLE MIDI device:", error)
			throw error
		}
	}

	disconnect(): void {
		if (this.device?.gatt?.connected) {
			this.device.gatt.disconnect()
		}
		this.characteristic = null
		this.server = null
		this.device = null
		this.activeNotes.clear()
		console.log("Disconnected from BLE MIDI device")
	}

	async transform(commands: IAudioCommand[]): Promise<IAudioCommand[]> {
		if (!this.characteristic) {
			return commands
		}

		for (const command of commands) {
			try {
				if (command.type === "note-on") {
					await this.noteOn(command.note, command.velocity ?? 100)
					this.activeNotes.add(command.note)
				} else if (command.type === "note-off") {
					await this.noteOff(command.note)
					this.activeNotes.delete(command.note)
				} else if (command.type === "control-change") {
					await this.sendControlChange(command.controller, command.value ?? 0)
				}
			} catch (error) {
				console.error("Error sending BLE MIDI message:", error)
			}
		}

		return commands
	}

	private async noteOn(note: number, velocity: number): Promise<void> {
		if (!this.characteristic) return

		const data = this.createBleMidiMessage([
			0x90, // Note On, channel 0
			Math.min(127, Math.max(0, note)),
			Math.min(127, Math.max(0, velocity)),
		])

		await this.characteristic.writeValue(data)
	}

	private async noteOff(note: number): Promise<void> {
		if (!this.characteristic) return

		const data = this.createBleMidiMessage([
			0x80, // Note Off, channel 0
			Math.min(127, Math.max(0, note)),
			0,
		])

		await this.characteristic.writeValue(data)
	}

	private async sendControlChange(controller: number, value: number): Promise<void> {
		if (!this.characteristic) return

		const data = this.createBleMidiMessage([
			0xb0, // Control Change, channel 0
			Math.min(127, Math.max(0, controller)),
			Math.min(127, Math.max(0, value)),
		])

		await this.characteristic.writeValue(data)
	}

	/**
	 * Create a BLE MIDI message with timestamp header
	 * BLE MIDI format: [timestamp_header, status_byte, data_byte1, data_byte2, ...]
	 * Timestamp header: high bit = 1, bits 14-0 = timestamp in milliseconds
	 */
	private createBleMidiMessage(midiMessage: number[]): Uint8Array {
		// Increment timestamp for each message
		this.timestampBytes = (this.timestampBytes + 1) & 0x1fff // Keep in 13-bit range

		// Create timestamp header with high bit set
		const timestampHeader = 0x8000 | this.timestampBytes

		// Combine timestamp header and MIDI message
		const data = new Uint8Array(midiMessage.length + 1)
		data[0] = (timestampHeader >> 8) & 0xff
		data[1] = timestampHeader & 0xff

		// Add MIDI message bytes
		for (let i = 0; i < midiMessage.length; i++) {
			data[i + 1] = midiMessage[i]
		}

		return data.subarray(0, midiMessage.length + 1) // Return correct size
	}

	getInfo(): object {
		return {
			type: "BLE MIDI Output",
			device: this.device?.name || "Not connected",
			connected: !!this.characteristic,
			activeNotes: Array.from(this.activeNotes),
		}
	}
}
