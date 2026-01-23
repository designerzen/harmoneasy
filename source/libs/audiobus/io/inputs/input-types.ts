/**
 * Input type identifiers
 * Single source of truth for input IDs used throughout the application
 */

export const KEYBOARD = "keyboard" as const
export const GAMEPAD = "gamepad" as const
export const WEBMIDI = "webmidi" as const
export const BLE_MIDI = "ble-midi" as const
export const MICROPHONE_FORMANT = "microphone-formant" as const
export const LEAP_MOTION = "leap-motion" as const
export const ONSCREEN_KEYBOARD = "onscreen-keyboard" as const

export type InputId =
	| typeof KEYBOARD
	| typeof GAMEPAD
	| typeof WEBMIDI
	| typeof BLE_MIDI
	| typeof MICROPHONE_FORMANT
	| typeof LEAP_MOTION
	| typeof ONSCREEN_KEYBOARD
