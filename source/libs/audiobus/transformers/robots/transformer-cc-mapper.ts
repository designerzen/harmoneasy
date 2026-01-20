/**
 * CC Mapper Transformer - Adds MIDI Control Change codes based on JSON descriptor
 * Maps note numbers or velocity ranges to control change values
 */
import { Transformer, type TransformerConfig } from "./abstract-transformer.ts"
import AudioCommand from "../../audio-command.ts"

import type { IAudioCommand } from "../../audio-command-interface.ts"
import type Timer from "../../timing/timer.ts"
import type { FieldConfig, ITransformer } from "./interface-transformer.ts"

export const ID_CC_MAPPER = "cc-mapper"

/**
 * Descriptor format for CC mapping
 * Maps either note ranges or velocity ranges to CC values
 */
export interface CCMapDescriptor {
	// CC number (0-127)
	controller: number
	// CC value to send (0-127)
	value: number
	// Optional: trigger on note range [min, max]
	noteRange?: [number, number]
	// Optional: trigger on velocity range [min, max]
	velocityRange?: [number, number]
	// Optional: trigger on specific command type
	commandType?: string
}

export interface CCMapperConfig extends TransformerConfig {
	descriptor: CCMapDescriptor[]
	insertCC: boolean // Whether to insert CC commands into the stream
	passthrough: boolean // Whether to pass original commands through
	preset: string // Selected preset name
}

const DEFAULT_CONFIG: CCMapperConfig = {
	available: true,
	enabled: true,
	descriptor: [],
	insertCC: true,
	passthrough: true,
	preset: "none",
}

export class TransformerCCMapper extends Transformer<CCMapperConfig> implements ITransformer {
	protected type = ID_CC_MAPPER
	private descriptor: CCMapDescriptor[] = []

	constructor(config: Partial<CCMapperConfig> = {}) {
		super({ ...DEFAULT_CONFIG, ...config })
		this.descriptor = this.config.descriptor || []
	}

	/**
	 * Override setConfig to handle preset selection
	 */
	setConfig(key: string, value: unknown): void {
		super.setConfig(key, value)

		// Load preset descriptor when preset changes
		if (key === "preset" && typeof value === "string") {
			const presetKey = value as keyof typeof EXAMPLE_DESCRIPTORS
			if (presetKey !== "none" && EXAMPLE_DESCRIPTORS[presetKey]) {
				this.loadDescriptor(EXAMPLE_DESCRIPTORS[presetKey])
				this.config.preset = value
			}
		}
	}

	get name(): string {
		return "CC Mapper"
	}

	get description(): string {
		return "Maps note/velocity ranges to MIDI Control Change messages"
	}

	get fields(): FieldConfig[] {
		const presetOptions = [
			{ name: "None", value: "none" },
			{ name: "Volume Control", value: "volumeControl" },
			{ name: "Velocity to Modulation", value: "velocityToModulation" },
			{ name: "Note Range Expression", value: "noteRangeExpression" },
			{ name: "Sustain Pedal", value: "sustainPedal" },
		]

		return [
			{
				name: "preset",
				type: "select",
				enabled: true,
				values: presetOptions,
				default: this.config.preset,
			},
			{
				name: "insertCC",
				type: "boolean",
				enabled: true,
				values: ["true", "false"],
				default: this.config.insertCC,
			},
			{
				name: "passthrough",
				type: "boolean",
				enabled: true,
				values: ["true", "false"],
				default: this.config.passthrough,
			},
		]
	}

	/**
	 * Load descriptor from JSON string or object
	 */
	loadDescriptor(descriptor: CCMapDescriptor[] | string): void {
		if (typeof descriptor === "string") {
			try {
				this.descriptor = JSON.parse(descriptor)
			} catch (error) {
				console.error("Failed to parse CC descriptor:", error)
				this.descriptor = []
			}
		} else {
			this.descriptor = descriptor
		}
		this.config.descriptor = this.descriptor
	}

	/**
	 * Get current descriptor
	 */
	getDescriptor(): CCMapDescriptor[] {
		return this.descriptor
	}

	/**
	 * Check if a command matches the mapping criteria
	 */
	private matchesDescriptor(command: IAudioCommand, mapping: CCMapDescriptor): boolean {
		// Check command type
		if (mapping.commandType && command.type !== mapping.commandType) {
			return false
		}

		// Check note range
		if (mapping.noteRange) {
			const note = command.number || 0
			if (note < mapping.noteRange[0] || note > mapping.noteRange[1]) {
				return false
			}
		}

		// Check velocity range
		if (mapping.velocityRange) {
			const velocity = command.velocity || 0
			if (velocity < mapping.velocityRange[0] || velocity > mapping.velocityRange[1]) {
				return false
			}
		}

		return true
	}

	/**
	 * Create a CC command
	 */
	private createAudioCommand(controller: number, value: number, sourceCommand: IAudioCommand): IAudioCommand {
		const cc = new AudioCommand()
		cc.type = "control-change"
		cc.value = value
		cc.time = sourceCommand.time
		cc.from = "CC Mapper"
		cc.channel = sourceCommand.channel
		return cc
	}

	transform(commands: IAudioCommand[], timer: Timer): IAudioCommand[] {
		const result: IAudioCommand[] = []

		for (const command of commands) {
			// Add original command if passthrough is enabled
			if (this.config.passthrough) {
				result.push(command)
			}

			// Check all mappings for this command
			if (this.config.insertCC) {
				for (const mapping of this.descriptor) {
					if (this.matchesDescriptor(command, mapping)) {
						const ccCommand = this.createAudioCommand(mapping.controller, mapping.value, command)
						result.push(ccCommand)
					}
				}
			}
		}

		return result
	}

	reset(): void {
		// No state to reset
	}

	destroy(): void {
		this.descriptor = []
	}

}

/**
 * Helper function to create CC mapper from descriptor
 */
export function createCCMapperFromDescriptor(descriptor: CCMapDescriptor[]): TransformerCCMapper {
	const mapper = new TransformerCCMapper()
	mapper.loadDescriptor(descriptor)
	return mapper
}


/**
 * Example descriptors for common use cases
 */
export const EXAMPLE_DESCRIPTORS = {
	/**
	 * Send CC 7 (volume) at full value when any note is played
	 */
	volumeControl: [
		{
			controller: 7,
			value: 127,
			commandType: "note-on"
		}
	],

	/**
	 * Send different CC values based on velocity
	 */
	velocityToModulation: [
		{
			controller: 1, // Modulation Wheel
			value: 127,
			velocityRange: [100, 127]
		},
		{
			controller: 1,
			value: 64,
			velocityRange: [64, 99]
		},
		{
			controller: 1,
			value: 32,
			velocityRange: [0, 63]
		}
	],

	/**
	 * Send expression control based on note range (low notes = soft, high notes = loud)
	 */
	noteRangeExpression: [
		{
			controller: 11, // Expression
			value: 50,
			noteRange: [36, 48] // Low notes
		},
		{
			controller: 11,
			value: 85,
			noteRange: [49, 60] // Mid notes
		},
		{
			controller: 11,
			value: 127,
			noteRange: [61, 127] // High notes
		}
	],

	/**
	 * Sustain pedal for held notes
	 */
	sustainPedal: [
		{
			controller: 64, // Sustain Pedal
			value: 127,
			commandType: "note-on"
		}
	],
}
