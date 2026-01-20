/**
 * MIDI Output - Send notes to connected MIDI devices
 * Uses the Web MIDI API to connect to hardware/software MIDI instruments
 */

import type { IAudioOutput } from "./output-interface.ts"
import type { IAudioCommand } from "../audio-command.ts"
import AudioCommand from "../audio-command.ts"

export default class OutputMIDI implements IAudioOutput {
	private midiAccess: MIDIAccess | null = null
	private selectedOutput: MIDIOutput | null = null
	private activeNotes: Set<number> = new Set()

	constructor() {
		this.initializeMIDI()
	}

	private async initializeMIDI(): Promise<void> {
		try {
			this.midiAccess = await (navigator as any).requestMIDIAccess()
			console.log("MIDI Access initialized")

			// Auto-select first available output if any
			const outputs = Array.from(this.midiAccess.outputs.values())
			if (outputs.length > 0) {
				this.selectedOutput = outputs[0]
				console.log(`Selected MIDI output: ${this.selectedOutput.name}`)
			}

			// Listen for device connections/disconnections
			this.midiAccess.addEventListener("statechange", this.handleMIDIStateChange.bind(this))
		} catch (error) {
			console.error("MIDI access denied or not available:", error)
		}
	}

	private handleMIDIStateChange(event: MIDIConnectionEvent): void {
		const port = event.port
		console.log(`MIDI ${port.type} ${port.state}: ${port.name}`)

		// Auto-select output if current one disconnected
		if (port.type === "output" && port.state === "disconnected" && this.selectedOutput === port) {
			const outputs = Array.from(this.midiAccess?.outputs.values() || [])
			this.selectedOutput = outputs.length > 0 ? outputs[0] : null
			if (this.selectedOutput) {
				console.log(`Switched to MIDI output: ${this.selectedOutput.name}`)
			}
		}
	}

	async transform(commands: IAudioCommand[]): Promise<IAudioCommand[]> {
		if (!this.selectedOutput) {
			return commands
		}

		for (const command of commands) {
			if (command.type === "note-on") {
				this.noteOn(command.note, command.velocity ?? 100)
				this.activeNotes.add(command.note)
			} else if (command.type === "note-off") {
				this.noteOff(command.note)
				this.activeNotes.delete(command.note)
			} else if (command.type === "control-change") {
				this.sendControlChange(command.controller, command.value ?? 0)
			}
		}

		return commands
	}

	private noteOn(note: number, velocity: number): void {
		if (!this.selectedOutput) return

		// MIDI Note On: 0x90 (status) + channel (0-15)
		const status = 0x90 // Note On, channel 0
		const data = [status, Math.min(127, Math.max(0, note)), Math.min(127, Math.max(0, velocity))]
		this.selectedOutput.send(data)
	}

	private noteOff(note: number): void {
		if (!this.selectedOutput) return

		// MIDI Note Off: 0x80 (status) + channel (0-15)
		const status = 0x80 // Note Off, channel 0
		const data = [status, Math.min(127, Math.max(0, note)), 0]
		this.selectedOutput.send(data)
	}

	private sendControlChange(controller: number, value: number): void {
		if (!this.selectedOutput) return

		// MIDI Control Change: 0xB0 (status) + channel (0-15)
		const status = 0xb0 // CC, channel 0
		const data = [status, Math.min(127, Math.max(0, controller)), Math.min(127, Math.max(0, value))]
		this.selectedOutput.send(data)
	}

	getInfo(): object {
		return {
			type: "MIDI Output",
			device: this.selectedOutput?.name || "No device selected",
			activeNotes: Array.from(this.activeNotes),
		}
	}

	getAvailableDevices(): string[] {
		if (!this.midiAccess) return []
		return Array.from(this.midiAccess.outputs.values()).map((output) => output.name || "Unknown")
	}

	selectDevice(deviceName: string): void {
		if (!this.midiAccess) {
			console.warn("MIDI not initialized")
			return
		}

		const output = Array.from(this.midiAccess.outputs.values()).find((o) => o.name === deviceName)
		if (output) {
			this.selectedOutput = output
			console.log(`Selected MIDI output: ${output.name}`)
		} else {
			console.warn(`MIDI output not found: ${deviceName}`)
		}
	}
}
