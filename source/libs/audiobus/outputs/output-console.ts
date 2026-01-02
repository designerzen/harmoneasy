import type { IAudioOutput } from "./output-interface"
import type NoteModel from "../note-model"

export default class OutputConsole extends EventTarget implements IAudioOutput{

	get name():string {
		return "OutputConsole"
	}

	constructor() {
		super()
	}

	noteOn(note:NoteModel, velocity: number): void {
		console.info("Note ON: " + note.number + " velocity: " + velocity)
	}
	noteOff(note: NoteModel): void {
		console.info("Note OFF: " + note.number )
	}
	allNotesOff(): void {
		console.info("ALL Notes OFF.")
	}
}
