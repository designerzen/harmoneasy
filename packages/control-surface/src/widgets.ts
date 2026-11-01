import { denormalize, dialOptions, validDialOptions } from "./model"
import type { ControlDescriptor, DialOptions } from "./types"
import { musicOptions, musicValues } from "./music"
import { relativeOptions } from "./relative-keys"
import { strumOptions } from "./strum"

export type DialControlOptions = Omit<
	ControlDescriptor,
	"widget" | "choices" | "defaultValue" | "dial"
> & {
	defaultValue?: number
	dial?: DialOptions
}

/** Developer-facing constructors produce descriptors for the shared GPU widget. */
export function createDialControl(options: DialControlOptions): ControlDescriptor {
	if (!validDialOptions(options.dial ?? {})) {
		throw new RangeError("Invalid procedural dial options")
	}
	return {
		min: 0,
		max: 1,
		step: 0,
		defaultValue: 0,
		...options,
		widget: "dial",
		dial: dialOptions(options.dial)
	}
}

export function createPanControl(options: DialControlOptions): ControlDescriptor {
	const min = options.min ?? -1,
		max = options.max ?? 1
	const center = denormalize({ ...options, widget: "dial", min, max }, 0.5)
	return createDialControl({
		...options,
		min,
		max,
		step: options.step ?? 0.01,
		defaultValue: options.defaultValue ?? center,
		dial: { ...options.dial, mode: "pan" }
	})
}

export function createRotationControl(options: DialControlOptions): ControlDescriptor {
	const min = options.min ?? 0,
		max = options.max ?? 360
	return {
		...createDialControl({
			...options,
			min,
			max,
			step: options.step ?? (max - min) / 360,
			unit: options.unit ?? (max - min === 360 ? "°" : undefined),
			defaultValue: options.defaultValue ?? min,
			dial: { ...options.dial, mode: "rotation" }
		}),
		widget: "dial"
	}
}

export function createPianoRollControl(
	options: Omit<ControlDescriptor, "widget">
): ControlDescriptor {
	musicOptions("piano-roll", options.music)
	const descriptor: ControlDescriptor = { ...options, widget: "piano-roll" }
	return { ...descriptor, defaultValue: musicValues(descriptor, options.defaultValue) }
}
export function createGuitarTabControl(
	options: Omit<ControlDescriptor, "widget">
): ControlDescriptor {
	musicOptions("guitar-tab", options.music)
	const descriptor: ControlDescriptor = { ...options, widget: "guitar-tab" }
	return { ...descriptor, defaultValue: musicValues(descriptor, options.defaultValue) }
}

export function createRelativeKeysControl(
	options: Omit<ControlDescriptor, "widget" | "defaultValue">
): ControlDescriptor {
	relativeOptions(options.relativeKeys)
	return { ...options, widget: "relative-keys", defaultValue: [] }
}

export function createStrumControl(
	options: Omit<ControlDescriptor, "widget" | "defaultValue">
): ControlDescriptor {
	strumOptions(options.strum)
	return { ...options, widget: "strum", defaultValue: [] }
}