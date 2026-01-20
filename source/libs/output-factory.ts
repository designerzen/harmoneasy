/**
 * Factory for creating audio output instances
 * Handles instantiation of available output types
 */

import type { IAudioOutput } from "./audiobus/outputs/output-interface.ts"
import OutputConsole from "./audiobus/outputs/output-console.ts"
import OutputPinkTrombone from "./audiobus/outputs/output-pink-trombone.ts"
import OutputNotation from "./audiobus/outputs/output-notation.ts"

export interface OutputFactory {
	id: string
	name: string
	description: string
	icon: string // Unicode emoji or icon symbol
	isAvailable: () => boolean
	create: () => IAudioOutput | Promise<IAudioOutput>
}

/**
 * Check if Web MIDI API is available
 */
function isMIDIAvailable(): boolean {
	return "requestMIDIAccess" in navigator
}

/**
 * Check if Web Bluetooth API is available
 */
function isBluetoothAvailable(): boolean {
	return "bluetooth" in navigator
}

/**
 * Available output factories
 * Add new outputs here as they become available
 */
export const OUTPUT_FACTORIES: OutputFactory[] = [
	{
		id: "console",
		name: "Console",
		description: "Logs MIDI events to browser console (dev mode only)",
		icon: "🖥️",
		isAvailable: () => import.meta.env.DEV,
		create: () => new OutputConsole(),
	},
	{
		id: "pink-trombone",
		name: "Pink Trombone",
		description: "Vocal synthesis engine with speech-like sounds",
		icon: "🎤",
		isAvailable: () => true,
		create: () => new OutputPinkTrombone(),
	},
	{
		id: "notation",
		name: "Notation",
		description: "Displays notes on a musical staff",
		icon: "🎼",
		isAvailable: () => true,
		create: () => new OutputNotation(),
	},
	{
		id: "midi",
		name: "MIDI",
		description: "Send MIDI to connected devices via USB/MIDI interface",
		icon: "🎹",
		isAvailable: () => isMIDIAvailable(),
		create: async () => {
			// Dynamic import to avoid loading if MIDI not available
			const { default: OutputMIDI } = await import("./audiobus/outputs/output-midi.ts")
			return new OutputMIDI()
		},
	},
	{
		id: "ble-midi",
		name: "BLE MIDI",
		description: "Send MIDI to Bluetooth Low Energy MIDI devices",
		icon: "📱",
		isAvailable: () => isBluetoothAvailable(),
		create: async () => {
			// Dynamic import to avoid loading if Bluetooth not available
			const { default: OutputBLEMIDI } = await import("./audiobus/outputs/output-ble-midi.ts")
			return new OutputBLEMIDI()
		},
	},
]

/**
 * Get all available output factories
 */
export function getAvailableOutputFactories(): OutputFactory[] {
	return OUTPUT_FACTORIES.filter((factory) => factory.isAvailable())
}

/**
 * Create an output instance by factory ID
 */
export async function createOutputById(id: string): Promise<IAudioOutput> {
	const factory = OUTPUT_FACTORIES.find((f) => f.id === id)
	if (!factory) {
		throw new Error(`Output factory not found: ${id}`)
	}
	if (!factory.isAvailable()) {
		throw new Error(`Output is not available: ${factory.name}`)
	}
	return factory.create()
}
