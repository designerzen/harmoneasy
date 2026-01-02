/**
 * 
 */
import InputAudioEvent from "./input-audio-event.ts"
import type { IAudioInput } from "./input-interface.ts"
import type { IAudioCommand } from "../audio-command-interface.ts"

export default abstract class AbstractInput extends EventTarget implements IAudioInput{
	
	#options:Record<string, any>

	get name():string {
		return "InputDevice"
	}

	get options():Record<string, any> {
		return this.#options
	}

	constructor(options:Record<string, any>) {
		super()
		this.#options = options
	}

	dispatch(command:IAudioCommand):void {
		const event:InputAudioEvent = new InputAudioEvent( command )
		this.dispatchEvent( event )
	}

	destroy():void{
		throw new Error("AbstractInput::destroy() must be implemented in subclasses.")
	}
}
