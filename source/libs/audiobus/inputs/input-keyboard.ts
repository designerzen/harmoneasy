/**
 * This is a keyboard adapter
 * that takes key presses and releases
 * and dispatches events with the AudioCommand
 * as the VO that gets passed through the system
 * and one AudioCommand can be created here
 * then piped into the TransformManager for example
 */


import AudioCommand from "../audio-command.ts"
import AbstractInput from "./abstract-input.ts"
import { addKeyboardDownEvents } from "../hardware/keyboard/keyboard"

export const KEYBOARD_INPUT_ID = "Keyboard"

export default class InputKeyboard extends AbstractInput {

	destroyKeyboardListener:Function
	
	get name():string {
		return KEYBOARD_INPUT_ID
	}

	constructor(options:Record<string, any> ={}) { 
		super(options)
		this.onKeyEvent = this.onKeyEvent.bind(this)
		this.destroyKeyboardListener = addKeyboardDownEvents( this.onKeyEvent )
	}

	override destroy(): void {
		this.destroyKeyboardListener()
	}

	protected onKeyEvent( commandType:string, key:string, value:number,  event:KeyboardEvent ) {
		const command = new AudioCommand()
		command.type = commandType
		command.value = value
		command.from = KEYBOARD_INPUT_ID
		command.text = key
		this.dispatch( command )
		// console.error(key, {commandType, event, value})
	}
}