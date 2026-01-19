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
	isAvailable: () => boolean
	create: () => IAudioOutput | Promise<IAudioOutput>
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
		isAvailable: () => import.meta.env.DEV,
		create: () => new OutputConsole(),
	},
	{
		id: "pink-trombone",
		name: "Pink Trombone",
		description: "Vocal synthesis engine with speech-like sounds",
		isAvailable: () => true,
		create: () => new OutputPinkTrombone(),
	},
	{
		id: "notation",
		name: "Notation",
		description: "Displays notes on a musical staff",
		isAvailable: () => true,
		create: () => new OutputNotation(),
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
