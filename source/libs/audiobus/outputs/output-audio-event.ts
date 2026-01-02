import { OUTPUT_EVENT } from "../../../commands.ts"
import type { IAudioCommand } from "../audio-command-interface.ts"

export default class OutputAudioEvent extends CustomEvent {
	
	command:IAudioCommand
	
	constructor( audioCommand:IAudioCommand ) {
		super( OUTPUT_EVENT, { detail: audioCommand } )
		this.command = audioCommand
	}

	clone():OutputAudioEvent {
		return new OutputAudioEvent( this.command )
	}
}
