import { OUTPUT_EVENT, NOTE_OFF, NOTE_ON } from "../../../commands.ts"
import NoteModel from "../note-model.ts"
import OutputAudioEvent from "./output-audio-event.ts"

import type { IAudioOutput } from "./output-interface.ts"
import type { IAudioCommand } from "../audio-command-interface.ts"

export default class OutputManager extends EventTarget implements IAudioOutput{
	
	#outputs:IAudioOutput[] = []

	get outputs():IAudioOutput[] {
		return this.#outputs
	}
	
	constructor(){
		super()
	}

	/**
	 * After creating an instance of an input device
	 * add it here to monitor it's outputs via the event dispatcher
	 * @param output 
	 */
	add(output:IAudioOutput){
		this.#outputs.push(output)
	}

	/**
	 * Remove input device
	 * @param output 
	 */
	remove(output:IAudioOutput){
		this.#outputs = this.#outputs.filter(i => i !== output)
	}

	// Commands for all connected Outputs ---------------------------

	/**
	 * Note ON
	 * @param note 
	 * @param velocity 
	 */
	noteOn(note: NoteModel, velocity: number): void{
		//console.log("noteOn", note, velocity, this.outputs)
		this.#outputs.forEach(output => output.noteOn(note, velocity))
		this.dispatchEvent(new OutputAudioEvent({ number: note.number, velocity }))
	}

	/**
	 * Note OFF
	 * @param note 
	 */
	noteOff(note: NoteModel): void{
		//console.log("noteOff", note, velocity, this.outputs)
		this.#outputs.forEach(output => output.noteOff(note))
		this.dispatchEvent(new OutputAudioEvent({ number: note.number }))
	}

	/**
	 * All Notes OFF
	 */
	allNotesOff():void{
		this.#outputs.forEach(output => output.allNotesOff())
	}

	/**
	 * Trigger an audio event from an audio command
	 * @param command 
	 * @param output 
	 * @returns 
	 */
	triggerAudioCommandOnDevice(command:IAudioCommand, output:IAudioOutput):IAudioCommand{
		//console.info("OutputManager", {command, output})
		switch (command.type) {
			case NOTE_ON:
				this.noteOn(new NoteModel(command.number), command.velocity)
				break

			case NOTE_OFF:
				this.noteOff(new NoteModel(command.number), command.velocity)
				break

			default:
				console.info("NOT IMPLEMENTED: Audio Command", command.type, Commands)
		}
		return command
	}

	/**
	 * Triggers any audioCommands and sends' their
	 * command to all registered output devices
	 * @param commands 
	 * @returns 
	 */
	triggerAudioCommandsOnOutputs(commands: IAudioCommand[]){
		
		this.#outputs.forEach( output => {
			commands.forEach( command => this.triggerAudioCommandOnDevice( command, output ) )
		})
		
		return commands
	}
	
	/**
	 * Kill all output devices
	 * and prevent any further actions
	 */
	destroy(): void {
		this.#outputs = []
	}
}