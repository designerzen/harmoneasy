import type { IAudioOutput } from "./output-interface"

export default class OutputConsole extends EventTarget implements IAudioOutput{

	static ID:number = 0

	#uuid:string

	get uuid(): string {
		return this.#uuid
	}

	get name():string {
		return "Console"
	}

	get description():string {
		return "Outputs notes to the console"
	}

	get isConnected(): boolean {
		return true
	}

	constructor() {
		super()
		this.#uuid = "Output-Console-"+(OutputConsole.ID++)
	}

	noteOn(noteNumber:number, velocity: number): void {
		console.info( this.uuid, "Note ON: " + noteNumber + " velocity: " + velocity)
	}
	noteOff(noteNumber: number): void {
		console.info( this.uuid, "Note OFF: " + noteNumber )
	}
	allNotesOff(): void {
		console.info( this.uuid, "ALL Notes OFF.")
	}
}
