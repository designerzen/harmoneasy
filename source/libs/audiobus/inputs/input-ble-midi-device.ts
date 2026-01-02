/**
 * This is a BLE MIDI Device adapter
 * that takes BLE MIDI events and converts them
 * into AudioCommands and dispatches them
 */

import AbstractInput from "./abstract-input.ts"
import NoteModel from "../note-model.ts"
import { createAudioCommand } from "../audio-command-factory.ts"
import type { IAudioCommand } from "../audio-command-interface.ts"
import { NOTE_OFF, NOTE_ON } from "../../../commands"

import {
    connectToBLEDevice, disconnectBLEDevice,
    watchCharacteristics, describeDevice
} from "../../midi-ble/ble-connection.ts"

import { BLE_SERVICE_UUID_DEVICE_INFO, BLE_SERVICE_UUID_MIDI } from "../../midi-ble/ble-constants.ts"

export const BLE_INPUT_ID = "BLE"

export default class InputBLEMIDIDevice extends AbstractInput {

    #bluetoothDevice: BluetoothDevice | null = null
    #bluetoothMIDICharacteristic: BluetoothRemoteGATTCharacteristic | undefined
    #bluetoothWatchUnsubscribes: Array<() => Promise<void>> = []
    #selectedMIDIChannel: number = 1

    get name(): string {
        return BLE_INPUT_ID
    }

    get isConnected(): boolean {
        return ((this.#bluetoothDevice !== null ) && this.#bluetoothDevice.gatt?.connected) ?? false
    }

    get device(): BluetoothDevice | null {
        return this.#bluetoothDevice
    }

	get channel():number{
		return this.#selectedMIDIChannel
	}

    constructor(options: Record<string, any> = {}) {
        super(options)
    }

    /**
     * Connect to a BLE MIDI device
     */
    async connect(): Promise<void> {
        try {
            const result = await connectToBLEDevice()

            if (!result || !result.characteristic) {
                throw new Error("No BLE MIDI characteristic found on device")
            }

            this.#bluetoothMIDICharacteristic = result.characteristic
            this.#bluetoothDevice = result.device

            console.info("[BLE Input] Device connected", describeDevice(this.#bluetoothDevice))

            // Watch for incoming MIDI data
            const availableMIDIBluetoothCharacteristics = [
                {
                    uuid: this.#bluetoothMIDICharacteristic.uuid,
                    properties: this.#bluetoothMIDICharacteristic.properties,
                    characteristicRef: this.#bluetoothMIDICharacteristic
                }
            ]

            const unsubs = await watchCharacteristics(
                availableMIDIBluetoothCharacteristics,
                (capability, value) => {
                    this.onBLEMIDIDataReceived(value)
                }
            )

            this.#bluetoothWatchUnsubscribes = unsubs

        } catch (error: any) {
            console.error("[BLE Input] Connection failed", error)
            throw error
        }
    }

    /**
     * Disconnect from the BLE MIDI device
     */
    async disconnect(): Promise<void> {
        console.info("[BLE Input] Disconnecting from device...", {
            device: this.#bluetoothDevice?.name
        })

        // Unsubscribe from all characteristic watches
        for (const unsub of this.#bluetoothWatchUnsubscribes) {
            try {
                await unsub()
            } catch (err: any) {
                console.warn("[BLE Input] Error unsubscribing from characteristic:", err)
            }
        }

        // Disconnect the GATT server
        if (this.#bluetoothDevice) {
            disconnectBLEDevice(this.#bluetoothDevice)
        }

        // Clear references
        this.#bluetoothWatchUnsubscribes = []
        this.#bluetoothMIDICharacteristic = undefined
        this.#bluetoothDevice = null
    }

    /**
     * Set the MIDI channel for outgoing messages
     */
    setChannel(channel: number): void {
        if (channel >= 1 && channel <= 16) {
            this.#selectedMIDIChannel = channel
        }else{
			throw new Error("Invalid MIDI channel #" + channel)
		}
    }

    /**
     * Handle incoming MIDI data from BLE characteristic
     */
    onBLEMIDIDataReceived(value: DataView): void {
        const data = new Uint8Array(value.buffer)
       
		console.log("[BLE Input] MIDI Data received", { data })

        // Parse MIDI data according to BLE MIDI spec
        // Format: [header][timestamp][status][data1][data2]...
        if (data.length < 3) {
            return
        }

        const status: number = data[2]
        const channel: number = (status & 0xf) + 1
        const type: number = status >> 4

        const data1: number = data[3] ?? 0
        const data2: number = data[4] ?? 0

        // Handle different MIDI message types
        switch (type) {
            case 0x9: // Note On
                if (data2 > 0) {
                    this.onNoteOn(data1, data2, channel)
                } else {
                    // Note On with velocity 0 is treated as Note Off
                    this.onNoteOff(data1, channel)
                }
                break

            case 0x8: // Note Off
                this.onNoteOff(data1, channel)
                break

            case 0xb: // Control Change
                this.onControlChange(data1, data2, channel)
                break

            case 0xc: // Program Change
                this.onProgramChange(data1, channel)
                break

            case 0xa: // Polyphonic Key Pressure
                // TODO: Implement if needed
                break

            case 0xd: // Channel Pressure
                // TODO: Implement if needed
                break

            case 0xe: // Pitch Bend
                // TODO: Implement if needed
                break

            default:
                console.warn("[BLE Input] Unknown MIDI message type", { type, status })
        }
    }

    /**
     * Handle Note On event
     */
    onNoteOn(noteNumber: number, velocity: number, channel: number): void {
        const command: IAudioCommand = createAudioCommand(
            NOTE_ON,
            noteNumber,
            Date.now(),
            this.name
        )

        console.info("[BLE Input] Note On", { note: noteNumber, velocity, channel })
        this.dispatch(command)
    }

    /**
     * Handle Note Off event
     */
    onNoteOff(noteNumber: number, channel: number): void {
        const command: IAudioCommand = createAudioCommand(
            NOTE_OFF,
            noteNumber,
            Date.now(),
            this.name
        )

        console.info("[BLE Input] Note Off", { note: noteNumber, channel })
        this.dispatch(command)
    }

    /**
     * Handle Control Change event
     */
    onControlChange(controlNumber: number, value: number, channel: number): void {
        console.info("[BLE Input] Control Change", { controlNumber, value, channel })
        // TODO: Implement CC handling if needed
    }

    /**
     * Handle Program Change event
     */
    onProgramChange(program: number, channel: number): void {
        console.info("[BLE Input] Program Change", { program, channel })
        // TODO: Implement PC handling if needed
    }

    /**
     * Cleanup when destroying the input
     */
    async destroy(): Promise<void> {
        if (this.isConnected) {
            await this.disconnect()
        }
    }
}