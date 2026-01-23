import type { IAudioOutput } from "./output-interface.ts"
import { NOTE_ON } from "../../commands.ts"
/**
 * Web Audio Modules 2 (WAM2) Audio Output
 * 
 * Enables integration with WAM2 audio plugins as synthesizers and instruments.
 * WAM2 plugins are Web Audio API nodes that can be connected to the audio graph
 * and controlled via MIDI-like messages (noteOn, noteOff).
 * 
 * @example
 * const wam = new OutputWAM2(audioContext, pluginUrl)
 * await wam.initialize()
 * wam.noteOn(note, 127)
 * wam.noteOff(note)
 */
export default class OutputWAM2 implements IAudioOutput {
	
	static ID :number= 0

	#uuid: string
	#name: string = "WAM2 Output"
	#audioContext: AudioContext
	#pluginUrl: string
	#pluginNode: any = null
	#isConnected: boolean = false
	#activeNotes: Map<number, number> = new Map()
	#pluginInfo: any = null

	get uuid():string{
		return this.#uuid
	}

	get name(): string {
		return this.#name
	}

	get description(): string {
		return "Manages the WAM2 Audio Engine"
	}

	get isConnected(): boolean {
		return this.#isConnected
	}

	get isHidden(): boolean {
		return false
	}

	get pluginNode(): any {
		return this.#pluginNode
	}

	get output(): AudioNode {
		return this.#pluginNode || this.#audioContext.createGain()
	}

	/**
	 * Create a new WAM2 output
	 * @param audioContext - The Web Audio API context
	 * @param pluginUrl - URL to the WAM2 plugin
	 * @param name - Optional display name for this output
	 */
	constructor(audioContext: AudioContext, pluginUrl: string, name?: string) {
		this.#audioContext = audioContext
		this.#pluginUrl = pluginUrl
		this.#uuid = "Output-WAM2-"+(OutputWAM2.ID++)

		if (name) {
			this.#name = name
		}
	}

	hasMidiOutput(): boolean {
		return false
	}
	hasAudioOutput(): boolean {
		return true
	}
	hasAutomationOutput(): boolean {
		return false
	}
	hasMpeOutput(): boolean {
		return false
	}
	hasOscOutput(): boolean {
		return false
	}
	hasSysexOutput(): boolean {
		return false
	}

	/**
	 * Initialize the WAM2 plugin
	 * Must be called before using noteOn/noteOff
	 */
	async connect(): Promise<void> {
		try {
			// Load WAM2 plugin using the standardized API
			if (!window.WAM) {
				throw new Error("WAM2 host not available. Ensure WAM2 polyfill is loaded.")
			}

			const { default: plugin } = await import(this.#pluginUrl)
			
			if (!plugin || typeof plugin.createInstance !== "function") {
				throw new Error("Invalid WAM2 plugin: missing createInstance method")
			}

			// Create plugin instance
			this.#pluginNode = await plugin.createInstance(this.#audioContext, {
				moduleId: this.#pluginUrl,
			})

			// Store plugin metadata
			this.#pluginInfo = {
				name: plugin.name || "Unknown WAM2 Plugin",
				version: plugin.version || "1.0.0",
				vendor: plugin.vendor || "Unknown Vendor",
			}

			// Update display name with plugin info
			this.#name = `${this.#pluginInfo.name} (WAM2)`

			this.#isConnected = true
			console.info(`WAM2 plugin initialized: ${this.#name}`)
		} catch (error) {
			console.error("Failed to initialize WAM2 plugin:", error)
			throw new Error(
				`WAM2 initialization failed for ${this.#pluginUrl}: ${error instanceof Error ? error.message : String(error)}`
			)
		}
	}

	/**
	 * Play a note on the WAM2 instrument
	 * @param noteNumber - The note to play
	 * @param velocity - MIDI velocity (0-127)
	 */
	noteOn(noteNumber: number, velocity: number = 127): void {
		if (!this.#isConnected || !this.#pluginNode) {
			console.warn("WAM2 output not initialized")
			return
		}

		// Clamp velocity to 0-127 range
		const midiVelocity = Math.max(0, Math.min(127, Math.round(velocity * 127)))
		const midiNote = Math.round(noteNumber)

		try {
			// Send MIDI note on message to the WAM2 plugin
			// Standard WAM2 API uses processMidi or midiBuffer interface
			if (typeof this.#pluginNode.processMidi === "function") {
				// Message format: [status, data1, data2]
				// 0x90 = Note On, data1 = note number, data2 = velocity
				this.#pluginNode.processMidi([NOTE_ON, midiNote, midiVelocity])
			} else if (this.#pluginNode.midiBuffer) {
				// Alternative: use midiBuffer (for some WAM2 implementations)
				this.#pluginNode.midiBuffer.push([NOTE_ON, midiNote, midiVelocity])
			} else {
				console.warn("WAM2 plugin does not support MIDI input")
			}

			// Track active note
			this.#activeNotes.set(midiNote, noteNumber)
		} catch (error) {
			console.error("WAM2 noteOn failed:", error)
		}
	}

	/**
	 * Stop playing a note on the WAM2 instrument
	 * @param note - The note to stop
	 */
	noteOff(noteNumber:number): void {
		if (!this.#isConnected || !this.#pluginNode) {
			console.warn("WAM2 output not initialized")
			return
		}

		const midiNote = Math.round(noteNumber)

		try {
			// Send MIDI note off message
			// 0x80 = Note Off, data1 = note number, data2 = velocity (usually 0)
			if (typeof this.#pluginNode.processMidi === "function") {
				this.#pluginNode.processMidi([0x80, midiNote, 0])
			} else if (this.#pluginNode.midiBuffer) {
				this.#pluginNode.midiBuffer.push([0x80, midiNote, 0])
			}

			// Untrack note
			this.#activeNotes.delete(midiNote)
		} catch (error) {
			console.error("WAM2 noteOff failed:", error)
		}
	}

	/**
	 * Stop all notes currently playing on the WAM2 instrument
	 */
	allNotesOff(): void {
		if (!this.#isConnected || !this.#pluginNode) {
			return
		}

		try {
			// Send all notes off control change message
			// CC 123 = All Notes Off
			if (typeof this.#pluginNode.processMidi === "function") {
				this.#pluginNode.processMidi([0xb0, 123, 0])
			} else if (this.#pluginNode.midiBuffer) {
				this.#pluginNode.midiBuffer.push([0xb0, 123, 0])
			}

			this.#activeNotes.clear()
		} catch (error) {
			console.error("WAM2 allNotesOff failed:", error)
		}
	}

	/**
	 * Send a generic MIDI message to the WAM2 plugin
	 * @param midiMessage - Array of [status, data1, data2] bytes
	 */
	processMidi(midiMessage: [number, number, number]): void {
		if (!this.#isConnected || !this.#pluginNode) {
			console.warn("WAM2 output not initialized")
			return
		}

		try {
			if (typeof this.#pluginNode.processMidi === "function") {
				this.#pluginNode.processMidi(midiMessage)
			} else if (this.#pluginNode.midiBuffer) {
				this.#pluginNode.midiBuffer.push(midiMessage)
			}
		} catch (error) {
			console.error("WAM2 processMidi failed:", error)
		}
	}

	/**
	 * Send a CC (Control Change) message to the plugin
	 * @param controller - CC number (0-127)
	 * @param value - CC value (0-127)
	 * @param channel - MIDI channel (0-15)
	 */
	sendControlChange(controller: number, value: number, channel: number = 0): void {
		const status = 0xb0 + channel // 0xBn = CC message
		const ccValue = Math.max(0, Math.min(127, Math.round(value)))
		this.processMidi([status, controller, ccValue])
	}

	/**
	 * Get the number of active notes
	 */
	getActiveNoteCount(): number {
		return this.#activeNotes.size
	}

	/**
	 * Get plugin information
	 */
	getPluginInfo(): any {
		return this.#pluginInfo
	}

	/**
	 * Cleanup and disconnect the WAM2 plugin
	 */
	async disconnect(): Promise<void> {
		try {
			this.allNotesOff()
			
			if (this.#pluginNode && typeof this.#pluginNode.disconnect === "function") {
				await this.#pluginNode.disconnect()
			}

			this.#pluginNode = null
			this.#isConnected = false
			console.info("WAM2 plugin disconnected")
		} catch (error) {
			console.error("Error disconnecting WAM2 plugin:", error)
		}
	}
}
