/**
 * Factory for creating audio input instances
 * Handles instantiation of available input types
 */
import type { IAudioInput } from "./inputs/input-interface.ts"
// import InputKeyboard from "./inputs/input-keyboard.ts"
// import InputGamepad from "./inputs/input-gamepad.ts"
// import InputWebMIDIDevice from "./inputs/input-webmidi-device.ts"
// import InputBLEMIDIDevice from "./inputs/input-ble-midi-device.ts"
// import InputMicrophoneFormant from "./inputs/input-microphone-formant.ts"
// import InputMicrophoneExample from "./inputs/input-microphone-example.ts"
// import InputLeapMotion from "./inputs/input-leap-motion.ts"
// import InputOnScreenKeyboard from "./inputs/input-onscreen-keyboard.ts"

import * as INPUT_TYPES from "./inputs/input-types.ts"

export interface InputFactory {
	id: string
	name: string
	description: string
	isAvailable: () => boolean
	create: (options?: Record<string, any>) => IAudioInput | Promise<IAudioInput>
}

const loadedLibraries = new Map<string, INPUT_TYPES.InputId>()

const loadSupportingLibrary = async (type: string) => {
	// Create and return instance based on type
	switch (type) {
		case INPUT_TYPES.KEYBOARD:
			return await import("./inputs/input-keyboard.ts")
		case INPUT_TYPES.GAMEPAD:
			return await import("./inputs/input-gamepad.ts")
		case INPUT_TYPES.WEBMIDI:
			return await import("./inputs/input-webmidi-device.ts")
		case INPUT_TYPES.BLE_MIDI:
			return await import("./inputs/input-ble-midi-device.ts")
		case INPUT_TYPES.MICROPHONE_FORMANT:
			return await import("./inputs/input-microphone-formant.ts")
		case INPUT_TYPES.LEAP_MOTION:
			return await import("./inputs/input-leap-motion.ts")
		case INPUT_TYPES.ONSCREEN_KEYBOARD: 
			return await import("./inputs/input-onscreen-keyboard.ts")
		default:
			throw new Error(`Unknown input type: ${type}`)
	}
}

/**
 * Load and instantiate an input for a given type
 * Tracks loaded libraries for future optimization
 * @param type Input type identifier
 * @returns A new instance of the requested input type
 * @throws Error if the input type is unknown
 */
const loadSupportingLibraries = async (type: string): Promise<any> => {

	if (!loadedLibraries.has(type)) {
		return loadedLibraries.get(type)
	}

	// Mark library as loaded
	const libWrapper = await loadSupportingLibrary(type)
	const lib = libWrapper.default
	loadedLibraries.set( type, lib )
	return lib
}

	// switch (type) {
	// 	case INPUT_TYPES.KEYBOARD:
	// 		return new InputKeyboard()
	// 	case INPUT_TYPES.GAMEPAD:
	// 		return new InputGamepad()
	// 	case INPUT_TYPES.WEBMIDI:
	// 		return new InputWebMIDIDevice()
	// 	case INPUT_TYPES.BLE_MIDI:
	// 		return new InputBLEMIDIDevice()
	// 	case INPUT_TYPES.MICROPHONE_FORMANT:
	// 		return new InputMicrophoneFormant()
	// 	case INPUT_TYPES.LEAP_MOTION:
	// 		return new InputLeapMotion()
	// 	case INPUT_TYPES.ONSCREEN_KEYBOARD: {
	// 		// OnScreenKeyboard requires special handling as it may need parameters
	// 		return new InputOnScreenKeyboard()
	// 	}
	// 	default:
	// 		throw new Error(`Unknown input type: ${type}`)
	// }

const createInput = async (type: string, options={} ): Promise<IAudioInput> => {
	const Class = await loadSupportingLibraries(type)
	return new Class(options)
}

/**
 * Available input factories
 * Add new inputs here as they become available
 * This lets us lazily load them as required
 * then uses the loaded imports in future requests
 */
export const INPUT_FACTORIES: InputFactory[] = [
	{
		id: INPUT_TYPES.KEYBOARD,
		name: "Keyboard",
		description: "QWERTY keyboard input for playing notes",
		isAvailable: () => true,
		create: (options) => createInput(INPUT_TYPES.KEYBOARD, options)
	},
	{
		id: INPUT_TYPES.GAMEPAD,
		name: "Gamepad",
		description: "Game controller / joystick input",
		isAvailable: () => typeof navigator !== "undefined" && !!navigator.getGamepads,
		create: (options) => createInput(INPUT_TYPES.GAMEPAD, options)
	},
	{
		id: INPUT_TYPES.WEBMIDI,
		name: "WebMIDI Device",
		description: "MIDI input from external devices via WebMIDI API",
		isAvailable: () => typeof navigator !== "undefined" && !!(navigator as any).requestMIDIAccess,
		create: (options) => createInput(INPUT_TYPES.WEBMIDI, options)
	},
	{
		id: INPUT_TYPES.BLE_MIDI,
		name: "BLE MIDI",
		description: "Bluetooth MIDI input",
		isAvailable: () => typeof navigator !== "undefined" && !!navigator.bluetooth,
		create: (options) => createInput(INPUT_TYPES.BLE_MIDI, options),
	},
	{
		id: INPUT_TYPES.MICROPHONE_FORMANT,
		name: "Microphone Formant",
		description: "Microphone input for formant analysis",
		isAvailable: () => typeof navigator !== "undefined" && !!navigator.mediaDevices,
		create: (options) => createInput(INPUT_TYPES.MICROPHONE_FORMANT, options),
	},
	{
		id: INPUT_TYPES.LEAP_MOTION,
		name: "Leap Motion",
		description: "Hand gesture tracking via Leap Motion device",
		isAvailable: () => typeof window !== "undefined" && !!(window as any).Leap,
		create: (options) => createInput(INPUT_TYPES.LEAP_MOTION, options),
	},
	{
		id: INPUT_TYPES.ONSCREEN_KEYBOARD,
		name: "Onscreen Keyboard",
		description: "Mouse-based virtual keyboard input",
		isAvailable: () => true,
		create: (options) => createInput(INPUT_TYPES.ONSCREEN_KEYBOARD, options),
	},
]

/**
 * Get all available input factories
 */
export function getAvailableInputFactories(): InputFactory[] {
	return INPUT_FACTORIES.filter((factory) => factory.isAvailable())
}

/**
 * Create an input instance by factory ID
 */
export async function createInputById(id: string): Promise<IAudioInput> {
	const factory = INPUT_FACTORIES.find((f) => f.id === id)
	if (!factory) {
		throw new Error(`Input factory not found: ${id}`)
	}
	if (!factory.isAvailable()) {
		throw new Error(`Input is not available: ${factory.name}`)
	}
	return factory.create()
}
